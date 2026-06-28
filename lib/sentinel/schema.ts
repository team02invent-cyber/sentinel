/**
 * SENTINEL — FROZEN INTERFACE CONTRACTS (v1.0)
 * ============================================
 * These are the three frozen schemas every track builds against.
 * Step zero. Do not change a field without bumping the version.
 *
 *   1. Telemetry          (TELEMETRY_SCHEMA_VERSION)
 *   2. PredictionEvent    (PREDICTION_SCHEMA_VERSION)
 *   3. Copilot request/response (COPILOT_SCHEMA_VERSION)
 *
 * ARCHITECTURAL LAW
 * -----------------
 * The ML model PREDICTS. The LLM EXPLAINS.
 * The LLM is not responsible for prediction. It receives the
 * PredictionEvent plus summarized evidence and retrieved docs. It may
 * DISPLAY telemetry as evidence; it never INFERS failure from it.
 */

export const TELEMETRY_SCHEMA_VERSION = "1.0"
export const PREDICTION_SCHEMA_VERSION = "1.0"
export const COPILOT_SCHEMA_VERSION = "1.0"
export const MODEL_VERSION = "tcn-fault-clf@0.3.1-sim"

export const SCHEMA_NOTES = {
  featureVector:
    "12 metrics x 7 nodes = 84-dim vector per second. The flat 84-dim vector " +
    "is topology-SPECIFIC (it bakes in 7 nodes). Production uses per-node " +
    "feature vectors (12 x N) processed by a shared model, which is " +
    "topology-agnostic. Demo: fixed 84-dim. Scale story: per-node graph.",
  numbersAreTargets:
    "All headline figures (MTTD, MTTR, lead time) are representative " +
    "operational values / design targets unless explicitly cited.",
} as const

/* ------------------------------------------------------------------ *
 * 1. TELEMETRY SCHEMA v1.0
 * ------------------------------------------------------------------ */

/** Per-node metric sample. 12 fields => the per-node feature row. */
export interface NodeMetrics {
  inMbps: number // interface ingress throughput
  outMbps: number // interface egress throughput
  ifErrorsPerS: number // interface input/output errors per second
  ifDiscardsPerS: number // interface discards per second
  queueDepthPct: number // egress queue depth, 0..100
  cpuPct: number // control-plane CPU, 0..100
  ldpUp: 0 | 1 // LDP session state
  ospfUp: 0 | 1 // OSPF neighbor state
  lspUp: 0 | 1 // carried LSP state
  labelChurnPerS: number // MPLS label add/withdraw events per second
  rttMs: number // probe LSP round-trip time
  jitterMs: number // probe LSP jitter
}

export const NODE_METRIC_KEYS: (keyof NodeMetrics)[] = [
  "inMbps",
  "outMbps",
  "ifErrorsPerS",
  "ifDiscardsPerS",
  "queueDepthPct",
  "cpuPct",
  "ldpUp",
  "ospfUp",
  "lspUp",
  "labelChurnPerS",
  "rttMs",
  "jitterMs",
]

/** One full 1 Hz telemetry frame across the whole fabric. */
export interface TelemetryFrame {
  schemaVersion: string
  /** Simulated monotonic clock, seconds since session start. */
  t: number
  /** Wall-clock epoch ms when emitted. */
  ts: number
  nodes: Record<string, NodeMetrics>
  links: Record<string, LinkMetrics>
}

export interface LinkMetrics {
  utilizationPct: number // 0..100 of capacity
  up: 0 | 1
  errorRatePct: number // % of frames erroring, 0..100
}

/* ------------------------------------------------------------------ *
 * 2. PREDICTION EVENT SCHEMA v1.0
 * ------------------------------------------------------------------ */

export type FaultClass = "link_flap" | "ldp_instability" | "congestion"

export const FAULT_LABELS: Record<FaultClass, string> = {
  link_flap: "Link Flap / Fiber Degradation",
  ldp_instability: "LDP / Label-Churn Instability",
  congestion: "Congestion / Queue Buildup",
}

export type EventPhase =
  | "healthy"
  | "degrading" // prediction emitted, counting down to impact
  | "imminent" // < 15s to impact
  | "failed" // impact occurred, packet loss
  | "recovering" // remediation applied, returning to nominal

export interface PredictionEvent {
  schemaVersion: string
  modelVersion: string
  id: string
  /** Target element: node id or link id. */
  element: string
  elementKind: "node" | "link"
  faultClass: FaultClass
  /** Per-class probabilities in [0,1]; argmax == faultClass. */
  probabilities: Record<FaultClass, number>
  /** Seconds until predicted packet-loss impact (>0 before, <=0 after). */
  timeToImpactS: number
  /** Lead time captured at the moment of first prediction. */
  leadTimeS: number
  confidence: number // 0..1
  phase: EventPhase
  /** Short summarized evidence rows handed to the Copilot (never raw). */
  evidence: EvidenceRow[]
  createdAt: number // epoch ms
  remediatedAt?: number
}

export interface EvidenceRow {
  label: string
  value: string
  /** "rising" | "falling" | "flat" — direction of the trend. */
  trend?: "rising" | "falling" | "flat"
}

/* ------------------------------------------------------------------ *
 * 3. COPILOT API SCHEMA v1.0
 * ------------------------------------------------------------------ */

export interface CopilotRequest {
  schemaVersion: string
  event: PredictionEvent
}

export interface CitedClaim {
  text: string
  /** Citation into the local RAG corpus. */
  source: string
}

export interface RemediationStep {
  description: string
  command: string
  source: string
}

export interface CopilotResponse {
  schemaVersion: string
  eventId: string
  /** WHAT is happening. */
  summary: CitedClaim
  /** WHY it is happening (root cause), grounded. */
  rootCause: CitedClaim
  /** FIX — exact CLI to pre-empt the failure. */
  remediation: RemediationStep[]
  /** True only if every claim is grounded in the corpus. */
  grounded: boolean
  /** Set when grounding is insufficient -> escalate, do not advise. */
  escalation?: string
}

/* ------------------------------------------------------------------ *
 * SESSION METRICS (evaluation surface)
 * ------------------------------------------------------------------ */

export interface SessionMetrics {
  injectedFaults: number
  truePositives: number
  falseAlarms: number
  /** TPR = TP / injectedFaults. */
  tpr: number
  /** False alarms per 10 minutes of session time. */
  farPer10Min: number
  leadTimesS: number[]
  medianLeadTimeS: number
  packetsLossPrevented: number
  /** Design-target reference values for the comparison ribbon. */
  reactiveMttdS: number
  reactiveMttrS: number
}
