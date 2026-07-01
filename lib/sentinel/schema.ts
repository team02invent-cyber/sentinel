/**
 * SENTINEL — FROZEN INTERFACE CONTRACTS (v2.0)
 * ============================================
 * Five schema namespaces. Bump version on any field change.
 *
 *   1. Telemetry          (TELEMETRY_SCHEMA_VERSION)
 *   2. PredictionEvent    (PREDICTION_SCHEMA_VERSION)
 *   3. Copilot request/response (COPILOT_SCHEMA_VERSION)
 *   4. NetFlow/IPFIX record     (NETFLOW_SCHEMA_VERSION)
 *   5. Syslog event             (SYSLOG_SCHEMA_VERSION)
 *
 * ARCHITECTURAL LAW
 * -----------------
 * The ML model PREDICTS. The LLM EXPLAINS.
 * The LLM is not responsible for prediction. It receives the
 * PredictionEvent plus summarized evidence and retrieved docs. It may
 * DISPLAY telemetry as evidence; it never INFERS failure from it.
 */

export const TELEMETRY_SCHEMA_VERSION = "2.0"
export const PREDICTION_SCHEMA_VERSION = "2.0"
export const COPILOT_SCHEMA_VERSION = "2.0"
export const NETFLOW_SCHEMA_VERSION = "1.0"
export const SYSLOG_SCHEMA_VERSION = "1.0"
export const MODEL_VERSION = "tcn-fault-clf@0.4.0-sim"

export const SCHEMA_NOTES = {
  featureVector:
    "14 metrics x 7 nodes = 98-dim vector per second. The flat 98-dim vector " +
    "is topology-SPECIFIC (it bakes in 7 nodes). Production uses per-node " +
    "feature vectors (14 x N) processed by a shared model, which is " +
    "topology-agnostic. Demo: fixed 98-dim. Scale story: per-node graph.",
  numbersAreTargets:
    "All headline figures (MTTD, MTTR, lead time) are representative " +
    "operational values / design targets unless explicitly cited.",
  detectorMethod:
    "EWMA baseline (α=0.15) + rolling 30-sample z-score per metric. " +
    "Anomaly score = mean(|z| > threshold) across the feature vector. " +
    "Prediction fires when score crosses 0.18 of the fault ramp.",
} as const

/* ------------------------------------------------------------------ *
 * 1. TELEMETRY SCHEMA v2.0
 * ------------------------------------------------------------------ */

/** Per-node metric sample. 14 fields => the per-node feature row. */
export interface NodeMetrics {
  inMbps: number              // interface ingress throughput
  outMbps: number             // interface egress throughput
  ifErrorsPerS: number        // interface input/output errors per second
  ifDiscardsPerS: number      // interface discards per second
  queueDepthPct: number       // egress queue depth, 0..100
  cpuPct: number              // control-plane CPU, 0..100
  ldpUp: 0 | 1                // LDP session state
  ospfUp: 0 | 1               // OSPF neighbor state
  lspUp: 0 | 1                // carried LSP state
  labelChurnPerS: number      // MPLS label add/withdraw events per second
  rttMs: number               // probe LSP round-trip time
  jitterMs: number            // probe LSP jitter
  /** NEW v2: BGP route-advertisement count (stable = nominal) */
  bgpPrefixCount: number
  /** NEW v2: OSPF convergence timer last value ms (rising = instability) */
  ospfConvergenceMs: number
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
  "bgpPrefixCount",
  "ospfConvergenceMs",
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
  /** NEW v2: SD-WAN controller streaming telemetry */
  controller: ControllerState
}

export interface LinkMetrics {
  utilizationPct: number      // 0..100 of capacity
  up: 0 | 1
  errorRatePct: number        // % of frames erroring, 0..100
  /** NEW v2: IPSec/IKE tunnel health */
  ikeState: "established" | "rekeying" | "degraded" | "down"
  /** NEW v2: Seconds since last successful IKE rekey */
  rekeyAgeSec: number
  /** NEW v2: Rolling jitter trend (5-sample slope, ms/s) */
  jitterTrendMsPerS: number
  /** NEW v2: ECMP path asymmetry ratio (1.0 = balanced) */
  ecmpAsymmetryRatio: number
}

/** NEW v2: SD-WAN controller streaming state */
export interface ControllerState {
  /** Overall policy compliance 0..100 */
  policyCompliancePct: number
  /** Number of sites with active policy drift */
  driftingSites: number
  /** Total managed sites */
  totalSites: number
  /** Controller orchestration latency ms */
  orchestrationLatencyMs: number
  /** SD-WAN overlay tunnel count: up/total */
  tunnelsUp: number
  tunnelsTotal: number
  /** Active controller alarms */
  alarms: ControllerAlarm[]
}

export interface ControllerAlarm {
  id: string
  severity: "info" | "warn" | "crit"
  message: string
  site: string
  ts: number
}

/* ------------------------------------------------------------------ *
 * 2. PREDICTION EVENT SCHEMA v2.0
 * ------------------------------------------------------------------ */

export type FaultClass =
  | "link_flap"
  | "ldp_instability"
  | "congestion"
  | "bgp_route_flap"
  | "policy_drift"

export const FAULT_LABELS: Record<FaultClass, string> = {
  link_flap:       "Link Flap / Fiber Degradation",
  ldp_instability: "LDP / Label-Churn Instability",
  congestion:      "Congestion / Queue Buildup",
  bgp_route_flap:  "BGP Route Flap / Path Reroute Cascade",
  policy_drift:    "SD-WAN Controller Policy Drift",
}

export type EventPhase =
  | "healthy"
  | "degrading"   // prediction emitted, counting down to impact
  | "imminent"    // < 15s to impact
  | "failed"      // impact occurred, packet loss
  | "recovering"  // remediation applied, returning to nominal

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
  /** Final disposition for the event log (additive, optional). */
  outcome?: "prevented" | "false_alarm" | "impacted"
  /** NEW v2: EWMA detector anomaly score at detection moment */
  anomalyScore?: number
  /** NEW v2: downstream nodes affected by BGP cascade */
  cascadeNodes?: string[]
}

export interface EvidenceRow {
  label: string
  value: string
  /** "rising" | "falling" | "flat" — direction of the trend. */
  trend?: "rising" | "falling" | "flat"
}

/* ------------------------------------------------------------------ *
 * 3. COPILOT API SCHEMA v2.0
 * ------------------------------------------------------------------ */

export interface CopilotRequest {
  schemaVersion: string
  event: PredictionEvent
  /** NEW v2: optional free-text query from NOC operator */
  query?: string
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
  /** NEW v2: true when this response came from the real Ollama LLM */
  fromLLM?: boolean
  /** NEW v2: latency of LLM inference ms */
  inferenceMs?: number
  /** NEW v2: the query this response answers (if operator-initiated) */
  answeredQuery?: string
  /** NEW v2: retrieved corpus doc ids backing a streamed prose answer */
  citedSources?: string[]
}

/* ------------------------------------------------------------------ *
 * 4. NETFLOW / IPFIX RECORD SCHEMA v1.0
 * ------------------------------------------------------------------ */

export interface NetFlowRecord {
  schemaVersion: string
  /** 5-tuple */
  srcIp: string
  dstIp: string
  srcPort: number
  dstPort: number
  protocol: "TCP" | "UDP" | "ICMP"
  /** DSCP / traffic class */
  dscp: number
  /** Bytes in this flow export interval */
  bytes: number
  /** Packets in this flow export interval */
  packets: number
  /** Flow start epoch ms */
  startMs: number
  /** Flow end epoch ms */
  endMs: number
  /** Ingress interface id */
  ingressIf: string
  /** Egress interface id */
  egressIf: string
  /** Node that exported this flow */
  exporterNode: string
}

/* ------------------------------------------------------------------ *
 * 5. SYSLOG EVENT SCHEMA v1.0
 * ------------------------------------------------------------------ */

export type SyslogSeverity = "emerg" | "alert" | "crit" | "err" | "warning" | "notice" | "info" | "debug"

export interface SyslogEvent {
  schemaVersion: string
  /** RFC 5424 priority = facility * 8 + severity_level */
  priority: number
  severity: SyslogSeverity
  facility: number
  /** ISO 8601 timestamp */
  timestamp: string
  hostname: string
  appName: string
  procId: string
  msgId: string
  message: string
  /** Structured data pairs */
  structuredData?: Record<string, string>
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
  /** NEW v2: EWMA anomaly scores at each detection */
  anomalyScores: number[]
  /** NEW v2: mean anomaly score at detection */
  meanAnomalyScore: number
  /* --- NEW v2: full confusion matrix + derived classifier metrics --- */
  /** Benign transients injected (the negative class). */
  benignTransients: number
  /** TN = benign transients correctly ignored (not escalated). */
  trueNegatives: number
  /** FN = real faults not caught before impact (injected − TP). */
  falseNegatives: number
  /** Precision = TP / (TP + FP). */
  precision: number
  /** Recall = TP / (TP + FN) (equals TPR). */
  recall: number
  /** F1 = harmonic mean of precision and recall. */
  f1: number
}
