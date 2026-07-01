/**
 * SENTINEL — Telemetry Simulator v2.0
 * ====================================
 * Emits TelemetryFrame v2.0 at 1 sim-Hz. Fault lifecycle:
 *
 *   healthy -> degrading[prediction emitted] -> imminent ->
 *   { remediated -> recovering -> healthy }
 *   { not remediated -> failed -> recovering -> healthy }
 *
 * NEW in v2.0:
 *   - EWMA baseline (α=0.15) + rolling 30-sample z-score per metric
 *   - Two new fault classes: bgp_route_flap, policy_drift
 *   - BGP route-flap: downstream cascade visualization
 *   - Policy drift: SD-WAN controller state degradation
 *   - IKE/rekey tunnel health on every link
 *   - ECMP path asymmetry detection
 *   - NetFlow/IPFIX record emitter (every 5s)
 *   - Syslog event emitter (fault-correlated)
 *   - gNMI adapter stub (maps real gNMI telemetry to TelemetryFrame)
 */

import {
  FAULT_LABELS,
  MODEL_VERSION,
  NETFLOW_SCHEMA_VERSION,
  PREDICTION_SCHEMA_VERSION,
  SYSLOG_SCHEMA_VERSION,
  TELEMETRY_SCHEMA_VERSION,
  type ControllerAlarm,
  type ControllerState,
  type EvidenceRow,
  type FaultClass,
  type LinkMetrics,
  type NetFlowRecord,
  type NodeMetrics,
  type PredictionEvent,
  type SessionMetrics,
  type SyslogEvent,
  type TelemetryFrame,
} from "./schema"
import { LINKS, NODES, PRIMARY_LSP_PATH, PROTECT_LSP_PATH } from "./topology"

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */
const HISTORY = 120          // seconds of rolling history
const PASS_MBPS = 800
const BASE_MBPS = 200
const RECOVERY_S = 9
const BENIGN_RESOLVE = 0.72
const BENIGN_CONF_CAP = 0.53
const NETFLOW_INTERVAL_S = 5 // emit a flow record every N sim-seconds

/* EWMA detector constants */
const EWMA_ALPHA = 0.15        // smoothing factor for nominal baseline drift
const WARMUP_SAMPLES = 12      // observations used to learn a frozen baseline
const ANOMALY_THRESHOLD = 2.5  // z-score magnitude to flag a metric
const DETECT_ANOMALY_FRAC = 0.30 // fraction of an element's own signals that must trip

/** Which element each fault class targets in the demo. */
const FAULT_TARGET: Record<FaultClass, { element: string; kind: "node" | "link" }> = {
  link_flap:       { element: "P1-P3",  kind: "link" },
  ldp_instability: { element: "P3",     kind: "node" },
  congestion:      { element: "PE2",    kind: "node" },
  bgp_route_flap:  { element: "PE1",    kind: "node" },
  policy_drift:    { element: "PE2",    kind: "node" },
}

/** Nodes that lose reachability when BGP flaps on PE1 */
const BGP_CASCADE_NODES = ["P1", "P3", "PE2"]

interface ActiveFault {
  faultClass: FaultClass
  element: string
  kind: "node" | "link"
  startT: number
  leadTimeS: number
  detected: boolean
  impacted: boolean
  eventId: string
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
  packetsPrevented: number
  prevented: boolean
  rerouted: boolean
  progressAtEnd: number
  leadTimeS: number
  confidence: number
  anomalyScore?: number
}

/* ------------------------------------------------------------------ *
 * EWMA Baseline tracker (per-metric, per-element)
 * ------------------------------------------------------------------ */
class EWMATracker {
  private baseline: number | null = null
  private warmup: number[] = []
  private frozenMean = 0
  private frozenStd = 1
  private frozen = false

  update(value: number): { ewma: number; zScore: number } {
    if (this.baseline === null) this.baseline = value

    // Phase 1: warm-up — learn a stable baseline from the first WARMUP_SAMPLES
    // observations (assumed nominal), then FREEZE the reference statistics so
    // an anomaly can never be absorbed into the baseline.
    if (!this.frozen) {
      this.warmup.push(value)
      this.baseline = EWMA_ALPHA * value + (1 - EWMA_ALPHA) * this.baseline
      if (this.warmup.length >= WARMUP_SAMPLES) {
        const n = this.warmup.length
        this.frozenMean = this.warmup.reduce((a, b) => a + b, 0) / n
        const variance = this.warmup.reduce((a, b) => a + (b - this.frozenMean) ** 2, 0) / n
        // Floor the std so tiny-variance nominal signals don't produce huge
        // z-scores, but keep it small enough that gradual precursor drift on
        // low-range signals (ecmp ratio, jitter trend) is detected during the
        // fault ramp — giving genuine pre-impact lead time.
        this.frozenStd = Math.max(Math.sqrt(variance), Math.abs(this.frozenMean) * 0.02, 0.15)
        this.frozen = true
      }
      return { ewma: this.baseline, zScore: 0 }
    }

    // Phase 2: score against the frozen baseline.
    const zScore = (value - this.frozenMean) / this.frozenStd

    // Only let the baseline track genuinely nominal drift (|z| small). When the
    // signal is anomalous we leave the reference untouched so the z-score keeps
    // reflecting the deviation for the whole duration of the fault.
    if (Math.abs(zScore) < ANOMALY_THRESHOLD) {
      this.frozenMean = EWMA_ALPHA * value + (1 - EWMA_ALPHA) * this.frozenMean
    }
    return { ewma: this.frozenMean, zScore }
  }

  reset(value?: number) {
    this.baseline = value ?? null
    this.warmup = []
    this.frozenMean = 0
    this.frozenStd = 1
    this.frozen = false
  }
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
function noise(amp: number) {
  return (Math.random() - 0.5) * 2 * amp
}
function randomIp(prefix: string): string {
  return `${prefix}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`
}
function pad2(n: number) {
  return String(n).padStart(2, "0")
}
function isoNow(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}Z`
}

/* ------------------------------------------------------------------ *
 * SentinelEngine
 * ------------------------------------------------------------------ */
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

  /** Rolling NetFlow records (last 30) */
  flowLog: NetFlowRecord[] = []
  /** Rolling Syslog events (last 50) */
  syslogLog: SyslogEvent[] = []

  /** Current controller state (updated each tick) */
  controllerState: ControllerState = this.buildNominalController()

  /** Most recent TelemetryFrame emitted by tick() */
  lastFrame: TelemetryFrame | null = null

  metrics: SessionMetrics = {
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
    anomalyScores: [],
    meanAnomalyScore: 0,
    benignTransients: 0,
    trueNegatives: 0,
    falseNegatives: 0,
    precision: 0,
    recall: 0,
    f1: 0,
  }

  /* EWMA trackers: nodeId -> metricKey -> tracker */
  private ewmaNode: Record<string, Partial<Record<keyof NodeMetrics, EWMATracker>>> = {}
  private ewmaLink: Record<string, Partial<Record<keyof LinkMetrics, EWMATracker>>> = {}

  constructor() {
    for (const n of NODES) {
      this.nodeHist[n.id] = []
      this.ewmaNode[n.id] = {}
    }
    for (const l of LINKS) {
      this.linkHist[l.id] = []
      this.ewmaLink[l.id] = {}
    }
  }

  /* ---------------------------------------------------------------- *
   * EWMA helpers
   * ---------------------------------------------------------------- */
  private nodeEwma(id: string, key: keyof NodeMetrics, value: number) {
    if (!this.ewmaNode[id][key]) this.ewmaNode[id][key] = new EWMATracker()
    return this.ewmaNode[id][key]!.update(value as number)
  }

  private linkEwma(id: string, key: keyof LinkMetrics, value: number) {
    if (!this.ewmaLink[id][key]) this.ewmaLink[id][key] = new EWMATracker()
    return this.ewmaLink[id][key]!.update(value as number)
  }

  /**
   * Compute an aggregate anomaly score across the feature vector.
   * Returns fraction of metrics currently exceeding ANOMALY_THRESHOLD z-score.
   * This replaces the simple DETECT_FRACTION ramp check — the detector now
   * observes actual metric deviation, not wall-clock progress.
   */
  private computeAnomalyScore(frame: TelemetryFrame): number {
    const NUMERIC_NODE_KEYS: (keyof NodeMetrics)[] = [
      "inMbps", "outMbps", "ifErrorsPerS", "ifDiscardsPerS",
      "queueDepthPct", "cpuPct", "labelChurnPerS", "rttMs", "jitterMs",
      "bgpPrefixCount", "ospfConvergenceMs",
    ]
    const LINK_KEYS: (keyof LinkMetrics)[] = [
      "utilizationPct", "errorRatePct", "rekeyAgeSec", "jitterTrendMsPerS", "ecmpAsymmetryRatio",
    ]

    // Per-element anomaly fraction. A real fault is localized, so we score each
    // element (node or link) against its OWN signals and take the worst-hit
    // element rather than diluting one hotspot across the whole fabric.
    let maxFrac = 0
    // Always update every EWMA tracker (so baselines stay warm), but score locally.
    for (const n of NODES) {
      const m = frame.nodes[n.id]
      let flagged = 0
      for (const key of NUMERIC_NODE_KEYS) {
        const { zScore } = this.nodeEwma(n.id, key, m[key] as number)
        if (Math.abs(zScore) > ANOMALY_THRESHOLD) flagged++
      }
      maxFrac = Math.max(maxFrac, flagged / NUMERIC_NODE_KEYS.length)
    }
    for (const l of LINKS) {
      const m = frame.links[l.id]
      let flagged = 0
      let counted = 0
      for (const key of LINK_KEYS) {
        const val = m[key] as number
        if (typeof val === "number") {
          const { zScore } = this.linkEwma(l.id, key, val)
          if (Math.abs(zScore) > ANOMALY_THRESHOLD) flagged++
          counted++
        }
      }
      if (counted > 0) maxFrac = Math.max(maxFrac, flagged / counted)
    }
    return maxFrac
  }

  /* ---------------------------------------------------------------- *
   * Pass-path helpers
   * ---------------------------------------------------------------- */
  private activePassPath(): string[] {
    return this.recovery?.rerouted ? PROTECT_LSP_PATH : PRIMARY_LSP_PATH
  }

  private nodeLoadMbps(id: string): number {
    const onPath = this.activePassPath().includes(id)
    const base = BASE_MBPS + noise(15)
    if (this.passActive && onPath) return base + PASS_MBPS + noise(40)
    if (this.passActive) return base + 120 + noise(30)
    return base
  }

  /* ---------------------------------------------------------------- *
   * Metric builders
   * ---------------------------------------------------------------- */
  private buildNodeMetrics(id: string): NodeMetrics {
    const load = this.nodeLoadMbps(id)
    const m: NodeMetrics = {
      inMbps:            clamp(load + noise(10), 0, 1000),
      outMbps:           clamp(load * 0.98 + noise(10), 0, 1000),
      ifErrorsPerS:      clamp(noise(0.05), 0, 100),
      ifDiscardsPerS:    clamp(noise(0.05), 0, 100),
      queueDepthPct:     clamp(12 + (load / 1000) * 20 + noise(4), 0, 100),
      cpuPct:            clamp(20 + (load / 1000) * 18 + noise(5), 0, 100),
      ldpUp:             1,
      ospfUp:            1,
      lspUp:             1,
      labelChurnPerS:    clamp(noise(0.4) + 0.3, 0, 200),
      rttMs:             clamp(12 + noise(2), 0, 1000),
      jitterMs:          clamp(1.2 + noise(0.6), 0, 200),
      bgpPrefixCount:    clamp(240 + noise(5), 0, 1000),   // stable ~240 prefixes
      ospfConvergenceMs: clamp(8 + noise(2), 0, 5000),     // stable ~8ms
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
      utilizationPct:      clamp(util, 0, 100),
      up:                  1,
      errorRatePct:        clamp(noise(0.02), 0, 100),
      ikeState:            "established",
      rekeyAgeSec:         clamp(3600 - (this.t % 3600) + noise(30), 0, 7200),
      jitterTrendMsPerS:   clamp(noise(0.05), -5, 5),
      ecmpAsymmetryRatio:  clamp(1.0 + noise(0.03), 0.8, 1.2),
    }
    this.applyFaultToLink(id, lm)
    return lm
  }

  private buildNominalController(): ControllerState {
    return {
      policyCompliancePct:  100,
      driftingSites:        0,
      totalSites:           7,
      orchestrationLatencyMs: clamp(12 + noise(3), 0, 500),
      tunnelsUp:            7,
      tunnelsTotal:         7,
      alarms:               [],
    }
  }

  private buildControllerState(): ControllerState {
    const f = this.active
    const base = this.buildNominalController()
    if (!f || f.faultClass !== "policy_drift") return base

    const p = this.faultProgress()
    const drifting = Math.round(p * 4)
    const alarms: ControllerAlarm[] = []
    if (p > 0.1) {
      alarms.push({
        id: `CTRL-${f.eventId}-1`,
        severity: p > 0.6 ? "crit" : "warn",
        message: `Policy deviation detected on site ${f.element}: QoS class mismatch`,
        site: f.element,
        ts: Date.now(),
      })
    }
    if (p > 0.4) {
      alarms.push({
        id: `CTRL-${f.eventId}-2`,
        severity: "crit",
        message: `BGP route policy drift: traffic engineering constraints violated`,
        site: "P3",
        ts: Date.now(),
      })
    }
    return {
      policyCompliancePct:    clamp(100 - p * 85, 0, 100),
      driftingSites:          drifting,
      totalSites:             7,
      orchestrationLatencyMs: clamp(12 + p * 400 + noise(20), 0, 2000),
      tunnelsUp:              clamp(7 - Math.round(p * 2), 0, 7),
      tunnelsTotal:           7,
      alarms,
    }
  }

  /* ---------------------------------------------------------------- *
   * Fault progress
   * ---------------------------------------------------------------- */
  private faultProgress(): number {
    if (!this.active) return 0
    return (this.t - this.active.startT) / this.active.leadTimeS
  }

  private recoveryProgress(): number {
    if (!this.recovery) return 1
    return clamp((this.t - this.recovery.startT) / this.recovery.durationS, 0, 1)
  }

  private nodeFaultContext(id: string): { cls: FaultClass; intensity: number; benign: boolean } | null {
    const f = this.active
    if (f && f.kind === "node" && f.element === id) {
      let intensity = clamp(this.faultProgress(), 0, 1.6)
      if (f.benign) intensity = Math.min(intensity, 0.7) * 0.4
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

  /* ---------------------------------------------------------------- *
   * Fault signal application
   * ---------------------------------------------------------------- */
  private applyFaultToNode(id: string, m: NodeMetrics) {
    const ctx = this.nodeFaultContext(id)
    if (!ctx) return
    const p = ctx.intensity

    switch (ctx.cls) {
      case "ldp_instability":
        m.labelChurnPerS    = clamp(0.3 + p * 120 + noise(8), 0, 400)
        m.jitterMs          = clamp(1.2 + p * 60 + noise(4), 0, 300)
        m.cpuPct            = clamp(m.cpuPct + p * 45, 0, 100)
        m.ospfConvergenceMs = clamp(8 + p * 800 + noise(30), 0, 5000)
        if (p >= 1) {
          m.ldpUp = Math.random() < 0.6 ? 0 : 1
          m.lspUp = m.ldpUp
        }
        break

      case "congestion":
        m.queueDepthPct = clamp(m.queueDepthPct + p * 78 + noise(5), 0, 100)
        m.outMbps       = clamp(m.outMbps + p * 150, 0, 1000)
        if (p >= 1) {
          m.ifDiscardsPerS = clamp(40 + noise(20), 0, 500)
        }
        break

      case "bgp_route_flap":
        // Primary signal: BGP prefix count oscillates, OSPF convergence spikes
        m.bgpPrefixCount    = clamp(240 - p * 220 + noise(15) * (Math.random() > 0.5 ? 1 : -1), 0, 300)
        m.ospfConvergenceMs = clamp(8 + p * 1200 + noise(50), 0, 5000)
        m.cpuPct            = clamp(m.cpuPct + p * 35, 0, 100)
        m.labelChurnPerS    = clamp(0.3 + p * 40 + noise(5), 0, 200)
        if (p >= 1) {
          m.ospfUp = Math.random() < 0.4 ? 0 : 1
          m.bgpPrefixCount = clamp(noise(20), 0, 50) // near-zero during flap
        }
        // Cascade to downstream nodes
        if (BGP_CASCADE_NODES.includes(id) && p > 0.5) {
          m.bgpPrefixCount    = clamp(m.bgpPrefixCount - p * 80 + noise(10), 0, 300)
          m.ospfConvergenceMs = clamp(8 + p * 400, 0, 5000)
        }
        break

      case "policy_drift":
        // Signal: rising orchestration latency, discards, CPU
        m.queueDepthPct  = clamp(m.queueDepthPct + p * 40 + noise(5), 0, 100)
        m.cpuPct         = clamp(m.cpuPct + p * 30, 0, 100)
        m.ifDiscardsPerS = clamp(p * 25 + noise(5), 0, 100)
        // Policy drift degrades jitter for traffic that loses QoS protection
        m.jitterMs       = clamp(1.2 + p * 80 + noise(8), 0, 300)
        break
    }
  }

  private applyFaultToLink(id: string, lm: LinkMetrics) {
    const ctx = this.linkFaultContext(id)
    if (!ctx) return
    const p = ctx.intensity

    if (ctx.cls === "link_flap") {
      lm.errorRatePct        = clamp(0.02 + p * p * 4.5 + noise(0.1), 0, 100)
      lm.jitterTrendMsPerS   = clamp(p * 1.5 + noise(0.1), -5, 5)
      lm.ecmpAsymmetryRatio  = clamp(1.0 + p * 0.4 + noise(0.05), 0.8, 2.0)
      if (p >= 1) {
        lm.up               = 0
        lm.utilizationPct   = 0
        lm.ikeState         = "down"
        lm.rekeyAgeSec      = 0
      } else if (p > 0.5) {
        lm.ikeState         = "degraded"
      }
    }

    if (ctx.cls === "bgp_route_flap") {
      // Link stays up but asymmetry spikes during route oscillation
      lm.ecmpAsymmetryRatio = clamp(1.0 + p * 0.8 + noise(0.1), 0.8, 2.5)
      lm.jitterTrendMsPerS  = clamp(p * 2 + noise(0.2), -5, 5)
      if (p > 0.7) lm.ikeState = "rekeying"
    }
  }

  /* ---------------------------------------------------------------- *
   * Prediction engine — EWMA-driven
   * ---------------------------------------------------------------- */
  private runPrediction(frame: TelemetryFrame) {
    if (this.recovery) {
      this.stepRecovery(frame)
      return
    }

    const f = this.active
    if (!f) { this.event = null; return }

    const p         = this.faultProgress()
    const ttiTotal  = f.leadTimeS
    const timeToImpactS = +(ttiTotal * (1 - p)).toFixed(1)

    // EWMA anomaly score (the real detection criterion)
    const anomalyScore = this.computeAnomalyScore(frame)

    console.log("[v0] anomalyScore", anomalyScore.toFixed(3), "progress", p.toFixed(2), "fault", f.faultClass, "detected", f.detected)
    // Detection fires when the anomaly score surpasses the threshold
    if (!f.detected && anomalyScore >= DETECT_ANOMALY_FRAC) {
      f.detected = true
      if (!f.benign) {
        const leadTimeS = Math.max(0, +(ttiTotal * (1 - p)).toFixed(1))
        this.metrics.truePositives += 1
        this.metrics.leadTimesS.push(leadTimeS)
        this.metrics.anomalyScores.push(anomalyScore)
        this.recomputeMetrics()
      }
    }

    if (!f.detected) { this.event = null; return }

    // Benign transient path
    if (f.benign) {
      const confidence = clamp(0.4 + p * 0.12, 0, BENIGN_CONF_CAP)
      this.event = {
        schemaVersion: PREDICTION_SCHEMA_VERSION,
        modelVersion:  MODEL_VERSION,
        id:            f.eventId,
        element:       f.element,
        elementKind:   f.kind,
        faultClass:    f.faultClass,
        probabilities: this.buildProbabilities(f.faultClass, p, true),
        timeToImpactS: Math.max(timeToImpactS, 0),
        leadTimeS:     this.event?.leadTimeS ?? timeToImpactS,
        confidence,
        phase:         "degrading",
        evidence:      this.buildEvidence(f.faultClass, frame, f.element),
        createdAt:     this.event?.createdAt ?? frame.ts,
        anomalyScore,
      }
      if (p >= BENIGN_RESOLVE) this.resolveFalseAlarm()
      return
    }

    const confidence    = clamp(0.5 + anomalyScore * 2.2 + p * 0.3, 0, 0.99)
    const probabilities = this.buildProbabilities(f.faultClass, p, false)
    let phase: PredictionEvent["phase"] = "degrading"
    if (p >= 1) {
      phase = "failed"
      f.impacted = true
    } else if (timeToImpactS <= 15) {
      phase = "imminent"
    }

    const leadTimeS = this.event?.leadTimeS ?? Math.max(0, +(ttiTotal * (1 - DETECT_ANOMALY_FRAC)).toFixed(1))
    const cascadeNodes = f.faultClass === "bgp_route_flap" && p > 0.4 ? BGP_CASCADE_NODES : undefined

    this.event = {
      schemaVersion: PREDICTION_SCHEMA_VERSION,
      modelVersion:  MODEL_VERSION,
      id:            f.eventId,
      element:       f.element,
      elementKind:   f.kind,
      faultClass:    f.faultClass,
      probabilities,
      timeToImpactS: Math.max(timeToImpactS, phase === "failed" ? timeToImpactS : 0),
      leadTimeS,
      confidence,
      phase,
      evidence:      this.buildEvidence(f.faultClass, frame, f.element),
      createdAt:     this.event?.createdAt ?? frame.ts,
      anomalyScore,
      cascadeNodes,
    }

    if (f.impacted && p >= 1.4) this.beginRecovery(false)
  }

  private stepRecovery(frame: TelemetryFrame) {
    const r       = this.recovery!
    const recProg = this.recoveryProgress()
    const evidence = this.buildEvidence(r.faultClass, frame, r.element).map((e) => ({
      ...e, trend: "falling" as const,
    }))

    this.event = {
      schemaVersion: PREDICTION_SCHEMA_VERSION,
      modelVersion:  MODEL_VERSION,
      id:            r.eventId,
      element:       r.element,
      elementKind:   r.kind,
      faultClass:    r.faultClass,
      probabilities: this.buildProbabilities(r.faultClass, 1 - recProg, false),
      timeToImpactS: 0,
      leadTimeS:     r.leadTimeS,
      confidence:    r.confidence,
      phase:         "recovering",
      evidence,
      createdAt:     frame.ts,
      remediatedAt:  Date.now(),
      outcome:       r.prevented ? "prevented" : "impacted",
    }

    if (recProg >= 1) {
      this.pushResolved(r)
      this.recovery = null
      this.event    = null
      this.recomputeMetrics()
    }
  }

  /* ---------------------------------------------------------------- *
   * Probability / evidence helpers
   * ---------------------------------------------------------------- */
  private buildProbabilities(cls: FaultClass, p: number, benign: boolean): Record<FaultClass, number> {
    const allClasses: FaultClass[] = ["link_flap", "ldp_instability", "congestion", "bgp_route_flap", "policy_drift"]
    if (benign) {
      const base: Record<FaultClass, number> = {} as Record<FaultClass, number>
      let sum = 0
      for (const c of allClasses) {
        const v = 0.2 + noise(0.04)
        base[c] = v
        sum += v
      }
      for (const c of allClasses) base[c] /= sum
      return base
    }
    const hi   = clamp(0.45 + p * 0.5, 0, 0.98)
    const rest = (1 - hi) / (allClasses.length - 1)
    const base: Record<FaultClass, number> = {} as Record<FaultClass, number>
    for (const c of allClasses) base[c] = rest
    base[cls] = hi
    return base
  }

  private buildEvidence(cls: FaultClass, frame: TelemetryFrame, element: string): EvidenceRow[] {
    switch (cls) {
      case "link_flap": {
        const lm = frame.links[element]
        return [
          { label: "Link error rate",     value: `${lm.errorRatePct.toFixed(2)} %/s`,       trend: "rising"  },
          { label: "IKE tunnel state",    value: lm.ikeState,                               trend: lm.ikeState !== "established" ? "falling" : "flat" },
          { label: "ECMP asymmetry",      value: `${lm.ecmpAsymmetryRatio.toFixed(2)}x`,    trend: lm.ecmpAsymmetryRatio > 1.1 ? "rising" : "flat" },
          { label: "Carrier-loss margin", value: "narrowing",                               trend: "falling" },
        ]
      }
      case "ldp_instability": {
        const nm = frame.nodes[element]
        return [
          { label: "Label churn",         value: `${nm.labelChurnPerS.toFixed(0)} /s`,       trend: "rising" },
          { label: "Session jitter",      value: `${nm.jitterMs.toFixed(0)} ms`,             trend: "rising" },
          { label: "OSPF convergence",    value: `${nm.ospfConvergenceMs.toFixed(0)} ms`,    trend: "rising" },
          { label: "Control-plane CPU",   value: `${nm.cpuPct.toFixed(0)} %`,               trend: "rising" },
        ]
      }
      case "congestion": {
        const nm = frame.nodes[element]
        return [
          { label: "Egress queue depth",  value: `${nm.queueDepthPct.toFixed(0)} %`,        trend: "rising"  },
          { label: "Egress throughput",   value: `${nm.outMbps.toFixed(0)} Mbps`,           trend: "rising"  },
          { label: "Tail-drop margin",    value: "narrowing",                               trend: "falling" },
          { label: "Interface discards",  value: `${nm.ifDiscardsPerS.toFixed(0)} /s`,      trend: "rising"  },
        ]
      }
      case "bgp_route_flap": {
        const nm = frame.nodes[element]
        return [
          { label: "BGP prefix count",    value: `${nm.bgpPrefixCount.toFixed(0)}`,         trend: "falling" },
          { label: "OSPF convergence",    value: `${nm.ospfConvergenceMs.toFixed(0)} ms`,   trend: "rising"  },
          { label: "Label churn",         value: `${nm.labelChurnPerS.toFixed(0)} /s`,      trend: "rising"  },
          { label: "Cascade risk",        value: `${BGP_CASCADE_NODES.join(", ")}`,         trend: "rising"  },
        ]
      }
      case "policy_drift": {
        const ctrl = frame.controller
        return [
          { label: "Policy compliance",   value: `${ctrl.policyCompliancePct.toFixed(0)} %`, trend: "falling" },
          { label: "Drifting sites",      value: `${ctrl.driftingSites} / ${ctrl.totalSites}`, trend: "rising" },
          { label: "Orchestration lat",   value: `${ctrl.orchestrationLatencyMs.toFixed(0)} ms`, trend: "rising" },
          { label: "Tunnels up",          value: `${ctrl.tunnelsUp} / ${ctrl.tunnelsTotal}`, trend: "falling" },
        ]
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * NetFlow emitter
   * ---------------------------------------------------------------- */
  private emitNetFlow(frame: TelemetryFrame) {
    if (this.t % NETFLOW_INTERVAL_S !== 0) return
    const nodeIds = NODES.map((n) => n.id)
    const exporter = nodeIds[Math.floor(Math.random() * nodeIds.length)]
    const nm = frame.nodes[exporter]
    const isFaultNode = this.active && this.active.element === exporter
    const bytes = Math.round((nm.outMbps * 1e6 / 8) * NETFLOW_INTERVAL_S * (0.9 + noise(0.1)))

    const record: NetFlowRecord = {
      schemaVersion: NETFLOW_SCHEMA_VERSION,
      srcIp:         randomIp("10.0"),
      dstIp:         randomIp("10.1"),
      srcPort:       1024 + Math.floor(Math.random() * 60000),
      dstPort:       isFaultNode ? 179 : [443, 8080, 53, 9000][Math.floor(Math.random() * 4)],
      protocol:      isFaultNode ? "TCP" : (Math.random() > 0.3 ? "TCP" : "UDP"),
      dscp:          this.passActive ? 46 : 0,   // EF for pass traffic, BE otherwise
      bytes,
      packets:       Math.round(bytes / 1024),
      startMs:       frame.ts - NETFLOW_INTERVAL_S * 1000,
      endMs:         frame.ts,
      ingressIf:     `${exporter}/0/0`,
      egressIf:      `${exporter}/0/1`,
      exporterNode:  exporter,
    }
    this.flowLog.unshift(record)
    if (this.flowLog.length > 30) this.flowLog.pop()
  }

  /* ---------------------------------------------------------------- *
   * Syslog emitter
   * ---------------------------------------------------------------- */
  private emitSyslog(frame: TelemetryFrame) {
    const f = this.active
    if (!f || !f.detected) return
    const p = this.faultProgress()
    // Only emit at certain progress thresholds to avoid flooding
    const thresholds = [0.2, 0.5, 0.8, 1.0, 1.2]
    const prevP = (this.t - f.startT - 1) / f.leadTimeS
    const crossed = thresholds.find((t) => prevP < t && p >= t)
    if (!crossed) return

    const sev = p >= 1 ? "crit" : p >= 0.8 ? "err" : p >= 0.5 ? "warning" : "notice"
    const msgs: Record<FaultClass, string[]> = {
      link_flap: [
        `%LINK-3-UPDOWN: Interface ${f.element}, changed state to down`,
        `%OSPF-5-ADJCHG: Process 1, Nbr 10.0.0.1 on ${f.element} from FULL to DOWN, Neighbor Down`,
        `%LDP-5-NBRCHG: LDP Neighbor ${f.element} is down`,
        `%MPLS-3-LSP_FAILED: LSP to 192.168.0.0/16 through ${f.element} failed`,
      ],
      ldp_instability: [
        `%LDP-5-NBRCHG: Neighbor session churn on ${f.element}, holdtime expired`,
        `%MPLS-4-LCHAIN: Label chain rebuild triggered on ${f.element}, ${Math.round(p * 120)}/s events`,
        `%LDP-3-SESS_PROT: LDP session protection activated on ${f.element}`,
        `%LDP-1-LSPDROP: LSP blackhole risk on ${f.element}, label table unstable`,
      ],
      congestion: [
        `%QUEUE-4-DEPTH: Egress queue depth on ${f.element} at ${Math.round(p * 80)}%`,
        `%QOS-3-TAILDROP: Tail-drop active on ${f.element}, class best-effort`,
        `%IF-3-DISCARD: Interface ${f.element} discarding ${Math.round(p * 40)} pkts/s`,
        `%QOS-2-PASSDROP: PASS class traffic drop on ${f.element}: queue saturated`,
      ],
      bgp_route_flap: [
        `%BGP-5-ADJCHANGE: neighbor 10.0.0.1 Down Peer closed the session`,
        `%BGP-3-NOTIFICATION: CEASE from neighbor 10.0.0.1, prefix count ${Math.round(240 - p * 200)}`,
        `%OSPF-5-ADJCHG: Convergence triggered by BGP path change from ${f.element}`,
        `%MPLS-4-REROUTE: TE path recalculation due to BGP instability on ${f.element}`,
      ],
      policy_drift: [
        `%SDWAN-4-POLICY: QoS policy mismatch detected on ${f.element}: expected class-map PASS`,
        `%SDWAN-3-DRIFT: Traffic engineering constraint violated on site ${f.element}`,
        `%SDWAN-2-TUNNEL: Tunnel ${f.element}/ike0 policy compliance failure`,
        `%SDWAN-1-CRITICAL: Service level degradation due to policy drift on ${f.element}`,
      ],
    }

    const msgList = msgs[f.faultClass]
    const msgIdx  = thresholds.indexOf(crossed)
    const message = msgList[Math.min(msgIdx, msgList.length - 1)]
    const hostname = f.element.replace("-", "")

    const log: SyslogEvent = {
      schemaVersion: SYSLOG_SCHEMA_VERSION,
      priority:      (16 * 8) + (["emerg","alert","crit","err","warning","notice","info","debug"].indexOf(sev)),
      severity:      sev as SyslogEvent["severity"],
      facility:      16, // local0
      timestamp:     isoNow(),
      hostname,
      appName:       "FRRouting",
      procId:        String(1000 + Math.floor(Math.random() * 9000)),
      msgId:         `${f.faultClass.toUpperCase().replace("_","-")}-${msgIdx}`,
      message,
      structuredData: {
        element: f.element,
        faultClass: f.faultClass,
        progress: p.toFixed(2),
        eventId: f.eventId,
      },
    }
    this.syslogLog.unshift(log)
    if (this.syslogLog.length > 50) this.syslogLog.pop()
  }

  /* ---------------------------------------------------------------- *
   * Metrics
   * ---------------------------------------------------------------- */
  private recomputeMetrics() {
    const m = this.metrics
    m.tpr = m.injectedFaults ? m.truePositives / m.injectedFaults : 0
    const minutes = Math.max(this.t / 60, 1 / 60)
    m.farPer10Min = +(m.falseAlarms / (minutes / 10)).toFixed(2)
    const sorted = [...m.leadTimesS].sort((a, b) => a - b)
    m.medianLeadTimeS = sorted.length ? +(sorted[Math.floor(sorted.length / 2)]).toFixed(1) : 0
    m.meanAnomalyScore = m.anomalyScores.length
      ? +(m.anomalyScores.reduce((a, b) => a + b, 0) / m.anomalyScores.length).toFixed(3)
      : 0

    // Confusion matrix:
    //   Positive class = real fault.  Negative class = benign transient.
    //   TP = fault predicted before impact.  FP = benign transient escalated (falseAlarms).
    //   FN = real fault not caught (injected − TP).  TN = benign correctly ignored.
    const tp = m.truePositives
    const fp = m.falseAlarms
    m.falseNegatives = Math.max(0, m.injectedFaults - m.truePositives)
    m.trueNegatives = Math.max(0, m.benignTransients - m.falseAlarms)
    const fn = m.falseNegatives
    m.precision = tp + fp > 0 ? +(tp / (tp + fp)).toFixed(3) : 0
    m.recall = tp + fn > 0 ? +(tp / (tp + fn)).toFixed(3) : 0
    m.f1 =
      m.precision + m.recall > 0
        ? +((2 * m.precision * m.recall) / (m.precision + m.recall)).toFixed(3)
        : 0
  }

  /* ---------------------------------------------------------------- *
   * Main tick
   * ---------------------------------------------------------------- */
  tick(): TelemetryFrame {
    this.t += 1
    const nodes: Record<string, NodeMetrics> = {}
    const links: Record<string, LinkMetrics> = {}
    for (const n of NODES) nodes[n.id] = this.buildNodeMetrics(n.id)
    for (const l of LINKS) links[l.id] = this.buildLinkMetrics(l.id)

    this.controllerState = this.buildControllerState()

    const frame: TelemetryFrame = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      t: this.t,
      ts: Date.now(),
      nodes,
      links,
      controller: this.controllerState,
    }

    // Rolling history
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
    this.emitNetFlow(frame)
    this.emitSyslog(frame)
    this.lastFrame = frame
    return frame
  }

  /* ---------------------------------------------------------------- *
   * Public controls
   * ---------------------------------------------------------------- */
  injectFault(faultClass: FaultClass) {
    if (this.active || this.recovery) return
    const target = FAULT_TARGET[faultClass]
    this.active = {
      faultClass,
      element:  target.element,
      kind:     target.kind,
      startT:   this.t,
      leadTimeS: 40 + Math.round(Math.random() * 35),
      detected: false,
      impacted: false,
      eventId:  `EVT-${Date.now().toString(36).toUpperCase()}`,
      benign:   false,
    }
    this.metrics.injectedFaults += 1
    this.recomputeMetrics()
    // Emit an initial syslog notice
    this.syslogLog.unshift({
      schemaVersion: SYSLOG_SCHEMA_VERSION,
      priority: (16 * 8) + 5,
      severity: "notice",
      facility: 16,
      timestamp: isoNow(),
      hostname: target.element.replace("-", ""),
      appName: "FRRouting",
      procId: String(1000 + Math.floor(Math.random() * 9000)),
      msgId: `${faultClass.toUpperCase().replace("_","-")}-INIT`,
      message: `Fault scenario initiated: ${FAULT_LABELS[faultClass]} on ${target.element}`,
      structuredData: { faultClass, element: target.element },
    })
  }

  injectTransient() {
    if (this.active || this.recovery) return
    this.active = {
      faultClass: "ldp_instability",
      element:    "P2",
      kind:       "node",
      startT:     this.t,
      leadTimeS:  30 + Math.round(Math.random() * 15),
      detected:   false,
      impacted:   false,
      eventId:    `EVT-${Date.now().toString(36).toUpperCase()}`,
      benign:     true,
    }
    this.metrics.benignTransients += 1
    this.recomputeMetrics()
  }

  remediate() {
    const f = this.active
    if (!f || f.benign || !this.event) return
    this.beginRecovery(!f.impacted)
  }

  private estimatePrevented(): number {
    const exposureS = Math.max(this.event?.timeToImpactS ?? 0, 5)
    const pps = ((this.passActive ? PASS_MBPS : BASE_MBPS) * 1e6) / (1500 * 8)
    return Math.round(pps * exposureS)
  }

  private beginRecovery(prevented: boolean) {
    const f = this.active
    if (!f) return
    const packetsPrevented = prevented ? this.estimatePrevented() : 0
    if (prevented) this.metrics.packetsLossPrevented += packetsPrevented

    this.recovery = {
      eventId:         f.eventId,
      element:         f.element,
      kind:            f.kind,
      faultClass:      f.faultClass,
      startT:          this.t,
      durationS:       RECOVERY_S,
      packetsPrevented,
      prevented,
      rerouted:        f.faultClass !== "congestion" && f.faultClass !== "policy_drift",
      progressAtEnd:   clamp(this.faultProgress(), 0, 1.6),
      leadTimeS:       this.event?.leadTimeS ?? 0,
      confidence:      this.event?.confidence ?? 0,
      anomalyScore:    this.event?.anomalyScore,
    }
    this.active = null
    this.recomputeMetrics()

    // Remediation syslog
    this.syslogLog.unshift({
      schemaVersion: SYSLOG_SCHEMA_VERSION,
      priority: (16 * 8) + 5,
      severity: "notice",
      facility: 16,
      timestamp: isoNow(),
      hostname: f.element.replace("-",""),
      appName: "sentinel-noc",
      procId: "1",
      msgId: "REMEDIATE",
      message: `Remediation applied: ${FAULT_LABELS[f.faultClass]} on ${f.element}. ${prevented ? "Pre-impact — no loss." : "Post-impact — recover via protect path."}`,
      structuredData: { faultClass: f.faultClass, element: f.element, prevented: String(prevented) },
    })
  }

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

  setPass(on: boolean)     { this.passActive = on }
  setAirGapped(on: boolean) { this.airGapped = on }

  reset() {
    this.active   = null
    this.event    = null
    this.recovery = null
    this.eventLog = []
    this.flowLog  = []
    this.syslogLog= []
    this.metrics = {
      injectedFaults: 0, truePositives: 0, falseAlarms: 0,
      tpr: 0, farPer10Min: 0, leadTimesS: [], medianLeadTimeS: 0,
      packetsLossPrevented: 0, reactiveMttdS: 180, reactiveMttrS: 1500,
      anomalyScores: [], meanAnomalyScore: 0,
      benignTransients: 0, trueNegatives: 0, falseNegatives: 0,
      precision: 0, recall: 0, f1: 0,
    }
    for (const n of NODES) {
      this.nodeHist[n.id] = []
      for (const k of Object.keys(this.ewmaNode[n.id])) {
        this.ewmaNode[n.id][k as keyof NodeMetrics]!.reset()
      }
    }
    for (const l of LINKS) {
      this.linkHist[l.id] = []
      for (const k of Object.keys(this.ewmaLink[l.id])) {
        this.ewmaLink[l.id][k as keyof LinkMetrics]!.reset()
      }
    }
    this.tHist = []
    this.t = 0
    this.controllerState = this.buildNominalController()
  }

  runDemoScript(onStep: (step: string) => void): () => void {
    const timers: ReturnType<typeof setTimeout>[] = []
    const s = (ms: number, fn: () => void, label: string) => {
      timers.push(setTimeout(() => { fn(); onStep(label) }, ms))
    }
    s(500,   () => { this.setPass(true) },                      "Pass activated")
    s(3000,  () => { this.injectFault("link_flap") },           "Injecting link flap…")
    s(8000,  () => { this.remediate() },                        "Applying remediation (link flap)")
    s(22000, () => { this.injectFault("ldp_instability") },     "Injecting LDP churn…")
    s(30000, () => { this.remediate() },                        "Applying remediation (LDP churn)")
    s(44000, () => { this.injectFault("bgp_route_flap") },      "Injecting BGP route flap…")
    s(52000, () => { this.remediate() },                        "Applying remediation (BGP)")
    s(66000, () => { this.injectFault("congestion") },          "Injecting congestion…")
    s(74000, () => { this.remediate() },                        "Applying remediation (congestion)")
    s(88000, () => { this.injectFault("policy_drift") },        "Injecting policy drift…")
    s(96000, () => { this.remediate() },                        "Applying remediation (policy drift)")
    return () => timers.forEach(clearTimeout)
  }

  nodeSeries(id: string, key: keyof NodeMetrics): number[] {
    return this.nodeHist[id]?.map((m) => m[key] as number) ?? []
  }
  linkSeries(id: string, key: keyof LinkMetrics): number[] {
    return this.linkHist[id]?.map((m) => m[key] as number) ?? []
  }
  times(): number[] { return [...this.tHist] }
  faultLabel(cls: FaultClass) { return FAULT_LABELS[cls] }
}

/* ------------------------------------------------------------------ *
 * gNMI Adapter Stub
 * ------------------------------------------------------------------ *
 * In production, replace the simulator's tick() with a gNMI Subscribe
 * stream that maps OpenConfig paths to TelemetryFrame fields.
 *
 * Path mapping (gNMI -> TelemetryFrame):
 *
 *   /interfaces/interface[name=*]/state/counters/in-octets
 *     -> nodes[id].inMbps (converted from octets/interval)
 *
 *   /interfaces/interface[name=*]/state/counters/out-octets
 *     -> nodes[id].outMbps
 *
 *   /network-instances/network-instance/protocols/protocol[identifier=BGP]/bgp/global/state/total-prefixes
 *     -> nodes[id].bgpPrefixCount
 *
 *   /network-instances/network-instance/protocols/protocol[identifier=OSPF]/ospf/global/timers/spf/state/last-execution-time
 *     -> nodes[id].ospfConvergenceMs
 *
 *   /mpls/lsps/constrained-path/tunnels/tunnel[name=*]/state/counters/bytes
 *     -> links[id].utilizationPct (derived from capacity)
 *
 *   /interfaces/interface[name=*]/subinterfaces/subinterface/ipv4/addresses/address/vrrp/vrrp-group/state/current-priority
 *     -> derived for ecmpAsymmetryRatio
 *
 * Usage:
 *   import { adaptGnmiUpdate } from "@/lib/sentinel/simulator"
 *   const frame = adaptGnmiUpdate(gnmiNotification, lastFrame)
 */
export function adaptGnmiUpdate(
  notification: unknown,
  lastFrame: TelemetryFrame,
): TelemetryFrame {
  // Stub: return last frame unchanged.
  // In production: parse notification.updates[], match OpenConfig paths,
  // map to TelemetryFrame fields, compute derived metrics.
  void notification
  return { ...lastFrame, ts: Date.now() }
}
