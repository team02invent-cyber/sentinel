/**
 * SENTINEL — Telemetry Simulator + Fault-Injection + Prediction State Machine
 * ===========================================================================
 * Emits TelemetryFrame v1.0 at 1 sim-Hz, injects one of three fault classes
 * (plus benign transients), and runs the prediction lifecycle:
 *
 *   healthy -> (fault injected) -> degrading[prediction emitted] ->
 *   imminent -> { remediated -> recovering -> healthy }
 *                { not remediated -> failed -> recovering -> healthy }
 *
 *   healthy -> (benign transient) -> degrading[low-confidence] ->
 *   escalate -> auto-clear[false alarm]
 *
 * During the recovering window the deep-space pass LSP is switched onto its
 * protect path (PROTECT_LSP_PATH) and the degraded element taper-heals back
 * to nominal — the visible "acted before impact" payoff.
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
const RECOVERY_S = 9 // visible post-remediation recovery window (sim-seconds)
const BENIGN_RESOLVE = 0.72 // benign transients auto-clear at this ramp fraction
const BENIGN_CONF_CAP = 0.53 // below the 0.55 grounding floor -> escalation

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
  /** Benign transient: a glitch the detector should NOT confidently ground. */
  benign: boolean
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
  /** Ramp progress captured at the moment recovery began (for taper-heal). */
  progressAtEnd: number
  /** Carried through for the resolved event-log row. */
  leadTimeS: number
  confidence: number
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
  recovery: RecoveryState | null = null

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

  /** The pass path that is live right now (protect path during a reroute). */
  private activePassPath(): string[] {
    return this.recovery?.rerouted ? PROTECT_LSP_PATH : PRIMARY_LSP_PATH
  }

  /** Throughput a node carries given pass state and its role on the path. */
  private nodeLoadMbps(id: string): number {
    const onPath = this.activePassPath().includes(id)
    const base = BASE_MBPS + noise(15)
    if (this.passActive && onPath) return base + PASS_MBPS + noise(40)
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
    const path = this.activePassPath()
    const onPath = path.includes(link.a) && path.includes(link.b)
    const util = (this.passActive && onPath ? 78 : this.passActive ? 35 : 22) + noise(5)
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

  private recoveryProgress(): number {
    if (!this.recovery) return 1
    return clamp((this.t - this.recovery.startT) / this.recovery.durationS, 0, 1)
  }

  /**
   * Effective fault intensity to apply to a node, considering both the active
   * ramp and the taper-heal during a recovery window. Returns null if the node
   * is unaffected.
   */
  private nodeFaultContext(
    id: string,
  ): { cls: FaultClass; intensity: number; benign: boolean } | null {
    const f = this.active
    if (f && f.kind === "node" && f.element === id) {
      let intensity = clamp(this.faultProgress(), 0, 1.6)
      if (f.benign) intensity = Math.min(intensity, 0.7) * 0.4 // mild, never impacts
      return { cls: f.faultClass, intensity, benign: f.benign }
    }
    const r = this.recovery
    if (r && r.kind === "node" && r.element === id) {
      return { cls: r.faultClass, intensity: r.progressAtEnd * (1 - this.recoveryProgress()), benign: false }
    }
    return null
  }

  private linkFaultContext(id: string): { cls: FaultClass; intensity: number } | null {
    const f = this.active
    if (f && f.kind === "link" && f.element === id && !f.benign) {
      return { cls: f.faultClass, intensity: clamp(this.faultProgress(), 0, 1.6) }
    }
    const r = this.recovery
    if (r && r.kind === "link" && r.element === id) {
      return { cls: r.faultClass, intensity: r.progressAtEnd * (1 - this.recoveryProgress()) }
    }
    return null
  }

  private applyFaultToNode(id: string, m: NodeMetrics) {
    const ctx = this.nodeFaultContext(id)
    if (!ctx) return
    const p = ctx.intensity
    if (ctx.cls === "ldp_instability") {
      m.labelChurnPerS = clamp(0.3 + p * 120 + noise(8), 0, 400)
      m.jitterMs = clamp(1.2 + p * 60 + noise(4), 0, 300)
      m.cpuPct = clamp(m.cpuPct + p * 45, 0, 100)
      if (p >= 1) {
        m.ldpUp = Math.random() < 0.6 ? 0 : 1 // flapping
        m.lspUp = m.ldpUp
      }
    } else if (ctx.cls === "congestion") {
      m.queueDepthPct = clamp(m.queueDepthPct + p * 78 + noise(5), 0, 100)
      m.outMbps = clamp(m.outMbps + p * 150, 0, 1000)
      if (p >= 1) {
        m.ifDiscardsPerS = clamp(40 + noise(20), 0, 500)
        m.lspUp = 1 // congested but up; loss via discards
      }
    }
  }

  private applyFaultToLink(id: string, lm: LinkMetrics) {
    const ctx = this.linkFaultContext(id)
    if (!ctx || ctx.cls !== "link_flap") return
    const p = ctx.intensity
    lm.errorRatePct = clamp(0.02 + p * p * 4.5 + noise(0.1), 0, 100)
    if (p >= 1) {
      lm.up = 0
      lm.utilizationPct = 0
    }
  }

  /** Run the prediction state machine after a frame is built. */
  private runPrediction(frame: TelemetryFrame) {
    // A recovery window owns the event surface until it completes.
    if (this.recovery) {
      this.stepRecovery(frame)
      return
    }

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
      if (!f.benign) {
        const leadTimeS = Math.max(0, +(ttiTotal * (1 - p)).toFixed(1))
        this.metrics.truePositives += 1
        this.metrics.leadTimesS.push(leadTimeS)
        this.recomputeMetrics()
      }
    }

    if (!f.detected) {
      this.event = null
      return
    }

    // Benign transient: low confidence, never reaches impact, auto-clears
    // as a false alarm (the Copilot escalates instead of advising).
    if (f.benign) {
      const confidence = clamp(0.4 + p * 0.12, 0, BENIGN_CONF_CAP)
      this.event = {
        schemaVersion: PREDICTION_SCHEMA_VERSION,
        modelVersion: MODEL_VERSION,
        id: f.eventId,
        element: f.element,
        elementKind: f.kind,
        faultClass: f.faultClass,
        probabilities: this.buildProbabilities(f.faultClass, p, true),
        timeToImpactS: Math.max(timeToImpactS, 0),
        leadTimeS: this.event?.leadTimeS ?? timeToImpactS,
        confidence,
        phase: "degrading",
        evidence: this.buildEvidence(f.faultClass, frame, f.element),
        createdAt: this.event?.createdAt ?? frame.ts,
      }
      if (p >= BENIGN_RESOLVE) this.resolveFalseAlarm()
      return
    }

    const confidence = clamp(0.5 + p * 0.55, 0, 0.99)
    const probabilities = this.buildProbabilities(f.faultClass, p, false)
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

    // Un-remediated fault: protect-path automatically kicks in after impact.
    if (f.impacted && p >= 1.4) {
      this.beginRecovery(false)
    }
  }

  /** Drive the recovering event surface and finalize when the window closes. */
  private stepRecovery(frame: TelemetryFrame) {
    const r = this.recovery!
    const recProg = this.recoveryProgress()
    const evidence = this.buildEvidence(r.faultClass, frame, r.element).map((e) => ({
      ...e,
      trend: "falling" as const,
    }))

    this.event = {
      schemaVersion: PREDICTION_SCHEMA_VERSION,
      modelVersion: MODEL_VERSION,
      id: r.eventId,
      element: r.element,
      elementKind: r.kind,
      faultClass: r.faultClass,
      probabilities: this.buildProbabilities(r.faultClass, 1 - recProg, false),
      timeToImpactS: 0,
      leadTimeS: r.leadTimeS,
      confidence: r.confidence,
      phase: "recovering",
      evidence,
      createdAt: frame.ts,
      remediatedAt: Date.now(),
      outcome: r.prevented ? "prevented" : "impacted",
    }

    if (recProg >= 1) {
      this.pushResolved(r)
      this.recovery = null
      this.event = null
      this.recomputeMetrics()
    }
  }

  private buildProbabilities(cls: FaultClass, p: number, benign: boolean): Record<FaultClass, number> {
    if (benign) {
      // No clear winner — this is what "insufficient grounding" looks like.
      const jitter = () => 0.33 + noise(0.05)
      const base: Record<FaultClass, number> = {
        link_flap: jitter(),
        ldp_instability: jitter(),
        congestion: jitter(),
      }
      const sum = base.link_flap + base.ldp_instability + base.congestion
      base.link_flap /= sum
      base.ldp_instability /= sum
      base.congestion /= sum
      return base
    }
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
    if (this.active || this.recovery) return // one scenario at a time in the demo
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
      benign: false,
    }
    this.metrics.injectedFaults += 1
    this.recomputeMetrics()
  }

  /**
   * Inject a benign transient: a brief glitch that trips detection at low
   * confidence. The Copilot escalates (no grounded advice), it self-clears
   * without impact, and it counts as a false alarm. Exercises the FAR metric
   * and the anti-hallucination escalation path.
   */
  injectTransient() {
    if (this.active || this.recovery) return
    this.active = {
      faultClass: "ldp_instability",
      element: "P2",
      kind: "node",
      startT: this.t,
      leadTimeS: 30 + Math.round(Math.random() * 15),
      detected: false,
      impacted: false,
      eventId: `EVT-${Date.now().toString(36).toUpperCase()}`,
      benign: true,
    }
    // NOTE: not counted in injectedFaults — there is no real fault to detect.
  }

  /** Operator applies the recommended remediation before impact. */
  remediate() {
    const f = this.active
    if (!f || f.benign || !this.event) return
    this.beginRecovery(!f.impacted)
  }

  /** Estimate packets of loss avoided over the exposure window. */
  private estimatePrevented(): number {
    const exposureS = Math.max(this.event?.timeToImpactS ?? 0, 5)
    const pps = ((this.passActive ? PASS_MBPS : BASE_MBPS) * 1e6) / (1500 * 8)
    return Math.round(pps * exposureS)
  }

  /** Transition the active fault into a visible recovery window. */
  private beginRecovery(prevented: boolean) {
    const f = this.active
    if (!f) return
    const packetsPrevented = prevented ? this.estimatePrevented() : 0
    if (prevented) this.metrics.packetsLossPrevented += packetsPrevented

    this.recovery = {
      eventId: f.eventId,
      element: f.element,
      kind: f.kind,
      faultClass: f.faultClass,
      startT: this.t,
      durationS: RECOVERY_S,
      packetsPrevented,
      prevented,
      // Congestion is mitigated in place via QoS; the others reroute traffic.
      rerouted: f.faultClass !== "congestion",
      progressAtEnd: clamp(this.faultProgress(), 0, 1.6),
      leadTimeS: this.event?.leadTimeS ?? 0,
      confidence: this.event?.confidence ?? 0,
    }
    this.active = null
    this.recomputeMetrics()
  }

  /** Benign transient self-clears as a false alarm. */
  private resolveFalseAlarm() {
    const f = this.active
    if (!f) return
    this.metrics.falseAlarms += 1
    this.eventLog.unshift({
      schemaVersion: PREDICTION_SCHEMA_VERSION,
      modelVersion: MODEL_VERSION,
      id: f.eventId,
      element: f.element,
      elementKind: f.kind,
      faultClass: f.faultClass,
      probabilities: this.buildProbabilities(f.faultClass, 0, true),
      timeToImpactS: 0,
      leadTimeS: 0,
      confidence: BENIGN_CONF_CAP,
      phase: "healthy",
      evidence: [],
      createdAt: Date.now(),
      remediatedAt: Date.now(),
      outcome: "false_alarm",
    })
    if (this.eventLog.length > 8) this.eventLog.pop()
    this.active = null
    this.event = null
    this.recomputeMetrics()
  }

  private pushResolved(r: RecoveryState) {
    this.eventLog.unshift({
      schemaVersion: PREDICTION_SCHEMA_VERSION,
      modelVersion: MODEL_VERSION,
      id: r.eventId,
      element: r.element,
      elementKind: r.kind,
      faultClass: r.faultClass,
      probabilities: this.buildProbabilities(r.faultClass, 1, false),
      timeToImpactS: 0,
      leadTimeS: r.leadTimeS,
      confidence: r.confidence,
      phase: "recovering",
      evidence: [],
      createdAt: Date.now(),
      remediatedAt: Date.now(),
      outcome: r.prevented ? "prevented" : "impacted",
    })
    if (this.eventLog.length > 8) this.eventLog.pop()
  }

  setPass(on: boolean) {
    this.passActive = on
  }
  setAirGapped(on: boolean) {
    this.airGapped = on
  }

  /**
   * Reset the engine to a clean nominal state — no active fault, no recovery,
   * cleared event log and session metrics. The sim clock continues.
   */
  reset() {
    this.active = null
    this.event = null
    this.recovery = null
    this.eventLog = []
    this.metrics = {
      injectedFaults: 0,
      truePositives: 0,
      falseAlarms: 0,
      tpr: 0,
      farPer10Min: 0,
      leadTimesS: [],
      medianLeadTimeS: 0,
      packetsLossPrevented: 0,
      reactiveMttdS: 180,
      reactiveMttrS: 1500,
    }
    for (const n of NODES) this.nodeHist[n.id] = []
    for (const l of LINKS) this.linkHist[l.id] = []
    this.tHist = []
    this.t = 0
  }

  /**
   * Run the scripted 4-minute demo sequence automatically:
   * T+0   : start the pass
   * T+5   : inject link flap
   * T+~10 : detection fires -> Copilot panel activates (engine-driven)
   * T+20  : operator applies remediation (called from here)
   * T+45  : inject LDP churn
   * T+~50 : detection fires
   * T+65  : operator applies remediation
   * T+90  : inject congestion
   * Returns a cancel function.
   */
  runDemoScript(onStep: (step: string) => void): () => void {
    const timers: ReturnType<typeof setTimeout>[] = []
    const s = (ms: number, fn: () => void, label: string) => {
      timers.push(
        setTimeout(() => {
          fn()
          onStep(label)
        }, ms),
      )
    }

    s(500, () => { this.setPass(true) }, "Pass activated")
    s(3000, () => { this.injectFault("link_flap") }, "Injecting link flap…")
    s(8000, () => { this.remediate() }, "Applying remediation (link flap)")
    s(22000, () => { this.injectFault("ldp_instability") }, "Injecting LDP churn…")
    s(30000, () => { this.remediate() }, "Applying remediation (LDP churn)")
    s(44000, () => { this.injectFault("congestion") }, "Injecting congestion…")
    s(52000, () => { this.remediate() }, "Applying remediation (congestion)")

    return () => timers.forEach(clearTimeout)
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
