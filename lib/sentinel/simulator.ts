/**
 * SENTINEL — Telemetry Simulator + Fault-Injection + Prediction State Machine
 * ===========================================================================
 * Emits TelemetryFrame v1.0 at 1 sim-Hz, injects one of three fault classes,
 * and runs the prediction lifecycle:
 *
 *   healthy -> (fault injected) -> degrading[prediction emitted] ->
 *   imminent -> { remediated -> recovering -> healthy }
 *                { not remediated -> failed -> recovering -> healthy }
 *
 * ARCHITECTURAL LAW: this module is the "ML predicts" plane. It produces a
 * PredictionEvent. The Copilot (LLM) only explains that event.
 *
 * The feed source is swappable: replace tick()'s metric synthesis with a
 * real FRR/gNMI exporter that emits the same TelemetryFrame schema and the
 * rest of the system is unchanged.
 */

import {
  FAULT_LABELS,
  MODEL_VERSION,
  PREDICTION_SCHEMA_VERSION,
  TELEMETRY_SCHEMA_VERSION,
  type EvidenceRow,
  type FaultClass,
  type LinkMetrics,
  type NodeMetrics,
  type PredictionEvent,
  type SessionMetrics,
  type TelemetryFrame,
} from "./schema"
import { LINKS, NODES, PRIMARY_LSP_PATH, PROTECT_LSP_PATH } from "./topology"

const HISTORY = 120 // seconds of rolling history
const PASS_MBPS = 800
const BASE_MBPS = 200
const DETECT_FRACTION = 0.18 // prediction fires this far into the ramp

/** Which element each fault class targets in the demo. */
const FAULT_TARGET: Record<FaultClass, { element: string; kind: "node" | "link" }> = {
  link_flap: { element: "P1-P3", kind: "link" },
  ldp_instability: { element: "P3", kind: "node" },
  congestion: { element: "PE2", kind: "node" },
}

interface ActiveFault {
  faultClass: FaultClass
  element: string
  kind: "node" | "link"
  startT: number
  leadTimeS: number
  detected: boolean
  impacted: boolean
  eventId: string
}

/** Visible post-remediation recovery window (the "money-shot"). */
export interface RecoveryState {
  eventId: string
  element: string
  kind: "node" | "link"
  faultClass: FaultClass
  startT: number
  durationS: number
  /** Packets that would have dropped, avoided by acting before impact. */
  packetsPrevented: number
  /** True if remediation landed before any packet loss. */
  prevented: boolean
  /** True if the pass LSP was switched onto the protect path. */
  rerouted: boolean
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
function noise(amp: number) {
  return (Math.random() - 0.5) * 2 * amp
}

export class SentinelEngine {
  t = 0
  passActive = false
  airGapped = false

  private nodeHist: Record<string, NodeMetrics[]> = {}
  private linkHist: Record<string, LinkMetrics[]> = {}
  private tHist: number[] = []

  private active: ActiveFault | null = null
  event: PredictionEvent | null = null
  eventLog: PredictionEvent[] = []

  metrics: SessionMetrics = {
    injectedFaults: 0,
    truePositives: 0,
    falseAlarms: 0,
    tpr: 0,
    farPer10Min: 0,
    leadTimesS: [],
    medianLeadTimeS: 0,
    packetsLossPrevented: 0,
    reactiveMttdS: 180, // design-target reference (representative)
    reactiveMttrS: 1500, // design-target reference (representative)
  }

  constructor() {
    for (const n of NODES) this.nodeHist[n.id] = []
    for (const l of LINKS) this.linkHist[l.id] = []
  }

  /** Throughput a node carries given pass state and its role on the path. */
  private nodeLoadMbps(id: string): number {
    const onPrimary = PRIMARY_LSP_PATH.includes(id)
    const base = BASE_MBPS + noise(15)
    if (this.passActive && onPrimary) return base + PASS_MBPS + noise(40)
    if (this.passActive) return base + 120 + noise(30)
    return base
  }

  private buildNodeMetrics(id: string): NodeMetrics {
    const load = this.nodeLoadMbps(id)
    const m: NodeMetrics = {
      inMbps: clamp(load + noise(10), 0, 1000),
      outMbps: clamp(load * 0.98 + noise(10), 0, 1000),
      ifErrorsPerS: clamp(noise(0.05), 0, 100),
      ifDiscardsPerS: clamp(noise(0.05), 0, 100),
      queueDepthPct: clamp(12 + (load / 1000) * 20 + noise(4), 0, 100),
      cpuPct: clamp(20 + (load / 1000) * 18 + noise(5), 0, 100),
      ldpUp: 1,
      ospfUp: 1,
      lspUp: 1,
      labelChurnPerS: clamp(noise(0.4) + 0.3, 0, 200),
      rttMs: clamp(12 + noise(2), 0, 1000),
      jitterMs: clamp(1.2 + noise(0.6), 0, 200),
    }
    this.applyFaultToNode(id, m)
    return m
  }

  private buildLinkMetrics(id: string): LinkMetrics {
    const link = LINKS.find((l) => l.id === id)!
    const onPrimary =
      PRIMARY_LSP_PATH.includes(link.a) && PRIMARY_LSP_PATH.includes(link.b)
    let util = (this.passActive && onPrimary ? 78 : this.passActive ? 35 : 22) + noise(5)
    const lm: LinkMetrics = {
      utilizationPct: clamp(util, 0, 100),
      up: 1,
      errorRatePct: clamp(noise(0.02), 0, 100),
    }
    this.applyFaultToLink(id, lm)
    return lm
  }

  /** Ramp progress of the active fault, 0..(>1 after impact). */
  private faultProgress(): number {
    if (!this.active) return 0
    return (this.t - this.active.startT) / this.active.leadTimeS
  }

  private applyFaultToNode(id: string, m: NodeMetrics) {
    const f = this.active
    if (!f || f.kind !== "node" || f.element !== id) return
    const p = clamp(this.faultProgress(), 0, 1.6)
    if (f.faultClass === "ldp_instability") {
      m.labelChurnPerS = clamp(0.3 + p * 120 + noise(8), 0, 400)
      m.jitterMs = clamp(1.2 + p * 60 + noise(4), 0, 300)
      m.cpuPct = clamp(m.cpuPct + p * 45, 0, 100)
      if (p >= 1) {
        m.ldpUp = Math.random() < 0.6 ? 0 : 1 // flapping
        m.lspUp = m.ldpUp
      }
    } else if (f.faultClass === "congestion") {
      m.queueDepthPct = clamp(m.queueDepthPct + p * 78 + noise(5), 0, 100)
      m.outMbps = clamp(m.outMbps + p * 150, 0, 1000)
      if (p >= 1) {
        m.ifDiscardsPerS = clamp(40 + noise(20), 0, 500)
        m.lspUp = 1 // congested but up; loss via discards
      }
    }
  }

  private applyFaultToLink(id: string, lm: LinkMetrics) {
    const f = this.active
    if (!f || f.kind !== "link" || f.element !== id) return
    const p = clamp(this.faultProgress(), 0, 1.6)
    if (f.faultClass === "link_flap") {
      lm.errorRatePct = clamp(0.02 + p * p * 4.5 + noise(0.1), 0, 100)
      if (p >= 1) {
        lm.up = 0
        lm.utilizationPct = 0
      }
    }
  }

  /** Run the prediction state machine after a frame is built. */
  private runPrediction(frame: TelemetryFrame) {
    const f = this.active
    if (!f) {
      this.event = null
      return
    }
    const p = this.faultProgress()
    const ttiTotal = f.leadTimeS
    const timeToImpactS = +(ttiTotal * (1 - p)).toFixed(1)

    // Detection: fire once the ramp crosses the detection fraction.
    if (!f.detected && p >= DETECT_FRACTION) {
      f.detected = true
      const leadTimeS = Math.max(0, +(ttiTotal * (1 - p)).toFixed(1))
      this.metrics.truePositives += 1
      this.metrics.leadTimesS.push(leadTimeS)
      this.recomputeMetrics()
    }

    if (!f.detected) {
      this.event = null
      return
    }

    const confidence = clamp(0.5 + p * 0.55, 0, 0.99)
    const probabilities = this.buildProbabilities(f.faultClass, p)
    let phase: PredictionEvent["phase"] = "degrading"
    if (p >= 1) {
      phase = "failed"
      f.impacted = true
    } else if (timeToImpactS <= 15) {
      phase = "imminent"
    }

    const leadTimeS = this.event?.leadTimeS ?? Math.max(0, +(ttiTotal * (1 - DETECT_FRACTION)).toFixed(1))

    this.event = {
      schemaVersion: PREDICTION_SCHEMA_VERSION,
      modelVersion: MODEL_VERSION,
      id: f.eventId,
      element: f.element,
      elementKind: f.kind,
      faultClass: f.faultClass,
      probabilities,
      timeToImpactS: Math.max(timeToImpactS, phase === "failed" ? timeToImpactS : 0),
      leadTimeS,
      confidence,
      phase,
      evidence: this.buildEvidence(f.faultClass, frame, f.element),
      createdAt: this.event?.createdAt ?? frame.ts,
    }

    // Auto-resolve a failed (un-remediated) fault after protect-path kicks in.
    if (f.impacted && p >= 1.5) {
      this.finishFault(false)
    }
  }

  private buildProbabilities(cls: FaultClass, p: number): Record<FaultClass, number> {
    const hi = clamp(0.45 + p * 0.5, 0, 0.98)
    const rest = (1 - hi) / 2
    const base: Record<FaultClass, number> = {
      link_flap: rest,
      ldp_instability: rest,
      congestion: rest,
    }
    base[cls] = hi
    return base
  }

  private buildEvidence(cls: FaultClass, frame: TelemetryFrame, element: string): EvidenceRow[] {
    if (cls === "link_flap") {
      const lm = frame.links[element]
      return [
        { label: "Link error rate", value: `${lm.errorRatePct.toFixed(2)} %/s`, trend: "rising" },
        { label: "Optical Tx power", value: "nominal", trend: "flat" },
        { label: "Carrier-loss margin", value: "narrowing", trend: "falling" },
      ]
    }
    if (cls === "ldp_instability") {
      const nm = frame.nodes[element]
      return [
        { label: "Label churn", value: `${nm.labelChurnPerS.toFixed(0)} /s`, trend: "rising" },
        { label: "Session jitter", value: `${nm.jitterMs.toFixed(0)} ms`, trend: "rising" },
        { label: "Control-plane CPU", value: `${nm.cpuPct.toFixed(0)} %`, trend: "rising" },
      ]
    }
    const nm = frame.nodes[element]
    return [
      { label: "Egress queue depth", value: `${nm.queueDepthPct.toFixed(0)} %`, trend: "rising" },
      { label: "Egress throughput", value: `${nm.outMbps.toFixed(0)} Mbps`, trend: "rising" },
      { label: "Tail-drop margin", value: "narrowing", trend: "falling" },
    ]
  }

  private recomputeMetrics() {
    const m = this.metrics
    m.tpr = m.injectedFaults ? m.truePositives / m.injectedFaults : 0
    const minutes = Math.max(this.t / 60, 1 / 60)
    m.farPer10Min = +(m.falseAlarms / (minutes / 10)).toFixed(2)
    const sorted = [...m.leadTimesS].sort((a, b) => a - b)
    m.medianLeadTimeS = sorted.length
      ? +(sorted[Math.floor(sorted.length / 2)]).toFixed(1)
      : 0
  }

  /** Advance one simulated second and emit a frame. */
  tick(): TelemetryFrame {
    this.t += 1
    const nodes: Record<string, NodeMetrics> = {}
    const links: Record<string, LinkMetrics> = {}
    for (const n of NODES) nodes[n.id] = this.buildNodeMetrics(n.id)
    for (const l of LINKS) links[l.id] = this.buildLinkMetrics(l.id)

    const frame: TelemetryFrame = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      t: this.t,
      ts: Date.now(),
      nodes,
      links,
    }

    // push history
    this.tHist.push(this.t)
    if (this.tHist.length > HISTORY) this.tHist.shift()
    for (const n of NODES) {
      const h = this.nodeHist[n.id]
      h.push(nodes[n.id])
      if (h.length > HISTORY) h.shift()
    }
    for (const l of LINKS) {
      const h = this.linkHist[l.id]
      h.push(links[l.id])
      if (h.length > HISTORY) h.shift()
    }

    this.runPrediction(frame)
    return frame
  }

  injectFault(faultClass: FaultClass) {
    if (this.active) return // one fault at a time in the demo
    const target = FAULT_TARGET[faultClass]
    this.active = {
      faultClass,
      element: target.element,
      kind: target.kind,
      startT: this.t,
      leadTimeS: 40 + Math.round(Math.random() * 35), // 40..75s
      detected: false,
      impacted: false,
      eventId: `EVT-${Date.now().toString(36).toUpperCase()}`,
    }
    this.metrics.injectedFaults += 1
    this.recomputeMetrics()
  }

  /** Operator applies the recommended remediation before impact. */
  remediate() {
    const f = this.active
    if (!f || !this.event) return
    if (!f.impacted) {
      // prevented: estimate packets saved over the avoided exposure window
      const exposureS = Math.max(this.event.timeToImpactS, 5)
      const pps = (this.passActive ? PASS_MBPS : BASE_MBPS) * 1e6 / (1500 * 8)
      this.metrics.packetsLossPrevented += Math.round(pps * exposureS)
    }
    this.finishFault(true)
  }

  private finishFault(prevented: boolean) {
    if (this.event) {
      const resolved: PredictionEvent = {
        ...this.event,
        phase: "recovering",
        remediatedAt: Date.now(),
      }
      this.eventLog.unshift(resolved)
      if (this.eventLog.length > 8) this.eventLog.pop()
    }
    this.active = null
    this.event = null
    this.recomputeMetrics()
  }

  setPass(on: boolean) {
    this.passActive = on
  }
  setAirGapped(on: boolean) {
    this.airGapped = on
  }

  /** Series for charts: a single numeric metric over history for an element. */
  nodeSeries(id: string, key: keyof NodeMetrics): number[] {
    return this.nodeHist[id]?.map((m) => m[key] as number) ?? []
  }
  linkSeries(id: string, key: keyof LinkMetrics): number[] {
    return this.linkHist[id]?.map((m) => m[key] as number) ?? []
  }
  times(): number[] {
    return [...this.tHist]
  }

  faultLabel(cls: FaultClass) {
    return FAULT_LABELS[cls]
  }
}
