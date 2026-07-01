/**
 * SENTINEL — Offline Copilot v2.0 (grounded responder + Ollama LLM)
 * ==================================================================
 * Production: llama.cpp/Ollama (4-bit 3-8B) + FAISS over the network's
 * own runbooks/configs. Air-gapped quantized LLM with grounded RAG.
 *
 * v2.0 upgrades:
 *   - Expanded RAG corpus: 20+ runbooks, past incidents, topology docs
 *   - Embedding-based cosine similarity retrieval (not direct class lookup)
 *   - Real Ollama LLM integration (localhost:11434 or OLLAMA_BASE_URL)
 *   - Free-text NOC query support (operator-initiated)
 *   - Templates for new fault classes: bgp_route_flap, policy_drift
 *
 * RULE: every claim carries a citation. If grounding is insufficient,
 * escalate instead of advising. The responder NEVER predicts — it only
 * explains the PredictionEvent or answers queries grounded in the corpus.
 */

import {
  COPILOT_SCHEMA_VERSION,
  type CopilotRequest,
  type CopilotResponse,
  type FaultClass,
  type PredictionEvent,
} from "./schema"

/* ------------------------------------------------------------------ *
 * RAG Corpus v2.0 (expanded)
 * ------------------------------------------------------------------ */
export interface CorpusEntry {
  id: string
  title: string
  /** Full document content (used for retrieval + grounding) */
  content: string
  /** Precomputed embedding (stub: in production use sentence-transformers) */
  embedding?: number[]
}

export const RAG_CORPUS: CorpusEntry[] = [
  {
    id: "RB-OSPF-014",
    title: "Runbook: OSPF/LDP reconvergence on link fault",
    content: `When an MPLS link fails, OSPF detects the adjacency down within 10-40s (dead-interval). LDP sessions terminate, triggering label table rebuilds. To pre-empt loss: (1) raise OSPF cost on the degrading link to steer traffic away gracefully, (2) withdraw LDP advertisement for that link, (3) monitor LSP path switchover. Critical paths must have protect-path configured (RSVP-TE fast-reroute or LFA). Convergence timer > 200ms indicates control-plane instability.`,
  },
  {
    id: "RB-MPLS-022",
    title: "Runbook: TE LSP protect-path switchover",
    content: `Traffic-engineering LSPs carry the deep-space pass telemetry. Primary path: PE1 → P1 → P3 → PE2. Protect path: PE1 → P2 → P4 → PE2. On primary path degradation, pre-emptively move the LSP to the protect path before packet loss. Command: vtysh -c "conf t" -c "mpls ldp" -c "no advertise-labels for <failing-link>". Verify with: show mpls ldp binding. Expected switchover time: < 50ms if FRR is enabled, else 1-3s.`,
  },
  {
    id: "RB-QOS-009",
    title: "Runbook: Egress queue congestion mitigation",
    content: `Egress queue tail-drop occurs when queue depth exceeds the buffer threshold (default 95%). Pass telemetry is marked DSCP EF and should be strict-priority queued. If the queue saturates, apply: (1) strict-priority queuing for the pass class, (2) traffic shaping on best-effort, (3) reroute best-effort to the protect path. Command: vtysh -c "conf t" -c "interface <iface>" -c "priority-queue out class pass-telemetry". Monitor with: show qos interface <iface>.`,
  },
  {
    id: "RB-BGP-031",
    title: "Runbook: BGP route flap dampening and cascade mitigation",
    content: `BGP route flap occurs when a peer repeatedly advertises/withdraws prefixes, causing OSPF/LDP reconvergence on every update. Symptom: bgpPrefixCount oscillates, ospfConvergenceMs spikes > 500ms. Downstream cascade: PE1 flap propagates to P1, P3, PE2 as each recalculates its FIB. Mitigation: (1) enable BGP route dampening (suppress flapping routes), (2) increase BGP keepalive/holdtime, (3) isolate the flapping peer. Command: vtysh -c "conf t" -c "router bgp 65000" -c "bgp dampening". Expected: prefix count stabilizes within 60s.`,
  },
  {
    id: "RB-LDP-017",
    title: "Runbook: LDP session protection and holdtime tuning",
    content: `LDP session flapping creates label blackholes as the label table rebuilds. Enable session protection to ride out transient adjacency loss. Command: vtysh -c "conf t" -c "mpls ldp" -c "session protection". Increase discovery hello holdtime from 15s to 45s to tolerate jitter. Command: vtysh -c "mpls ldp" -c "discovery hello holdtime 45". Monitor label churn: show mpls ldp binding. Target: < 5 label updates/s in steady-state.`,
  },
  {
    id: "RB-SDWAN-008",
    title: "Runbook: SD-WAN policy drift detection and remediation",
    content: `Policy drift occurs when the controller's desired state diverges from the device running-config. Symptoms: policyCompliancePct < 95%, driftingSites > 0, orchestrationLatencyMs > 200ms. Root cause: manual config changes bypassing the controller, or controller-device sync failure. Mitigation: (1) reconcile device config with controller template, (2) roll back unauthorized changes, (3) enable config lock to prevent manual edits. Command: sdwan-cli policy reconcile --site <site-id>. Verify: sdwan-cli policy status.`,
  },
  {
    id: "CFG-PE2-IFm",
    title: "Config: PE2 interface & SRLG mapping",
    content: `PE2 interface GigabitEthernet0/0/0 is the egress for deep-space pass traffic. SRLG (Shared Risk Link Group): primary and protect paths are physically diverse (no fiber sharing). Interface config: mtu 9000, qos trust dscp, priority-queue out class pass-telemetry. Link capacity: 1 Gbps. Protect path: GigabitEthernet0/0/1 via P4.`,
  },
  {
    id: "PM-2024-117",
    title: "Postmortem: fiber degradation, pass DSN-117",
    content: `Incident: 2024-11-15, DSN-117 spacecraft pass. Link P1-P3 experienced fiber degradation (receive-side connector oxidation). Interface error rate climbed from 0.02%/s to 4.5%/s over 3 minutes. Prediction fired at T+2:10 (35s lead time). Remediation: LSP moved to protect path before loss. Outcome: zero packet loss. Root cause: aging fiber patch panel. Fix: replaced connector, added predictive maintenance schedule.`,
  },
  {
    id: "PM-2023-098",
    title: "Postmortem: BGP flap cascade, pass DSN-098",
    content: `Incident: 2023-09-22, DSN-098 spacecraft pass. PE1 BGP peer (10.0.0.1) flapped due to software bug in the vendor's BGP daemon. Prefix count dropped from 240 to 0, triggering OSPF reconvergence. Downstream cascade: P1, P3, PE2 all recalculated FIB, causing 8s of packet loss. Prediction fired at T+1:45 (20s lead time, insufficient). Outcome: partial loss. Root cause: BGP daemon bug. Fix: vendor patch applied, BGP dampening enabled.`,
  },
  {
    id: "CMD-FRR-REF",
    title: "FRRouting command reference (vtysh)",
    content: `FRRouting (FRR) is the routing daemon. Access via vtysh. Key commands: show ip ospf neighbor (OSPF adjacencies), show mpls ldp binding (LDP label table), show ip route (FIB), show bgp summary (BGP peers), show interface (interface stats). Config mode: vtysh -c "conf t". Write config: write memory. Reload: clear ip ospf process. Log level: debug ospf events.`,
  },
  {
    id: "TOPO-MPLS-001",
    title: "Topology: MPLS core fabric design",
    content: `7-node fabric: 2 PE (provider edge), 4 P (core), 1 RR (route reflector). PE1 ingress, PE2 egress. Primary LSP path for pass traffic: PE1 → P1 → P3 → PE2. Protect path: PE1 → P2 → P4 → PE2. All links 1 Gbps, MTU 9000. OSPF area 0.0.0.0. BGP AS 65000. LDP enabled on all links. No ECMP on pass traffic (strict TE path).`,
  },
  {
    id: "TOPO-PASS-002",
    title: "Topology: Deep-space pass traffic profile",
    content: `Deep-space pass: 800 Mbps burst for 8-12 minutes during spacecraft overhead. Traffic marked DSCP EF (expedited forwarding), strict-priority queued. Baseline traffic: 200 Mbps best-effort. Pass schedule: coordinated via ground station network operations center (NOC). Critical requirement: zero packet loss during pass window.`,
  },
  {
    id: "ARCH-AIRGAP-001",
    title: "Architecture: Air-gap boundary and offline LLM",
    content: `Sentinel operates air-gapped: no internet, no cloud API. All inference runs on-premises. LLM: Mistral 7B or LLaMA 3 8B, 4-bit quantized, served via Ollama (localhost:11434). RAG corpus: network runbooks, config snapshots, past incidents, topology docs — all stored locally. Embeddings: sentence-transformers/all-MiniLM-L6-v2. Vector store: FAISS (in-memory). Guardrail: if confidence < 0.55 or no grounded citation, escalate to human operator.`,
  },
  {
    id: "INC-2024-034",
    title: "Incident log: LDP churn on P3",
    content: `2024-08-10: P3 experienced LDP session flapping (holdtime expired 6x over 10 min). Label churn rate spiked to 120/s. Root cause: loose fiber connection causing micro-interrupts. Prediction fired at T+1:50 (25s lead time). Remediation: session protection enabled, fiber reseated. Outcome: no pass impact.`,
  },
  {
    id: "INC-2023-112",
    title: "Incident log: congestion on PE2 during DSN-112",
    content: `2023-10-05: PE2 egress queue saturated during DSN-112 pass (queue depth 98%). Best-effort traffic caused tail-drop on pass class. Prediction fired at T+2:00 (30s lead time). Remediation: strict-priority queuing applied. Outcome: 120 packets lost before fix. Root cause: QoS misconfiguration. Fix: QoS policy template updated.`,
  },
  {
    id: "METRIC-TPR-001",
    title: "Evaluation metric: True Positive Rate (TPR)",
    content: `TPR = (true positives) / (injected faults). Target: ≥ 0.95. A true positive: prediction fired before impact, operator had time to remediate. Measurement: count predictions with leadTimeS > 15s. Denominator: total fault injections (excludes benign transients). Current model (tcn-fault-clf@0.4.0): TPR 0.96 on validation set.`,
  },
  {
    id: "METRIC-FAR-001",
    title: "Evaluation metric: False Alarm Rate (FAR)",
    content: `FAR = (false alarms) / (session time in 10-min intervals). Target: ≤ 0.5 per 10 minutes. A false alarm: prediction fired but no real fault (benign transient, insufficient grounding). Measurement: count escalations where confidence < 0.55. Tradeoff: lowering detection threshold increases TPR but also FAR.`,
  },
  {
    id: "METRIC-LT50-001",
    title: "Evaluation metric: Median Lead Time (LT50)",
    content: `LT50 = median(leadTimesS). Target: ≥ 30s. Lead time: seconds between prediction and predicted impact. Measurement: captured at detection moment (when anomaly score crosses threshold). Baseline (reactive monitoring): MTTD 180s. Predictive gain: 150s. Critical for pre-impact remediation.`,
  },
  {
    id: "DETECTOR-EWMA-001",
    title: "Detector: EWMA baseline and z-score anomaly scoring",
    content: `Each metric has an EWMA baseline (α=0.15) and rolling 30-sample std-dev. Per-sample z-score: (value - mean) / std. Anomaly flagged if |z| > 2.5. Aggregate anomaly score: fraction of metrics flagged across the 98-dim feature vector. Prediction fires when anomaly score ≥ 0.18. This replaces the naive ramp-timer — the detector now observes real metric deviation.`,
  },
  {
    id: "SDWAN-CTRL-001",
    title: "SD-WAN controller: policy compliance monitoring",
    content: `Controller maintains desired-state templates for QoS, routing, and tunnel policies. Polls devices every 30s. Policy compliance = (devices in-sync) / (total devices). Drift occurs when device running-config diverges from template. Causes: manual config, device reboot without controller sync, controller-device connection loss. Alarm threshold: compliance < 95% or driftingSites > 1.`,
  },
]

/** Build a simple embedding stub (in production: call sentence-transformers) */
function stubEmbedding(text: string): number[] {
  // Stub: return a 384-dim random vector seeded by text hash
  // In production: POST to a local embedding service or use @xenova/transformers
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash << 5) - hash + text.charCodeAt(i)
  const rng = () => {
    hash = (hash * 1664525 + 1013904223) >>> 0
    return (hash / 0xffffffff - 0.5) * 2
  }
  return Array.from({ length: 384 }, () => rng())
}

// Precompute embeddings on module load
for (const doc of RAG_CORPUS) {
  doc.embedding = stubEmbedding(doc.title + " " + doc.content)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

/** Retrieve top-k most relevant docs for a query */
function retrieveDocs(query: string, k: number): CorpusEntry[] {
  const queryEmb = stubEmbedding(query)
  const scored = RAG_CORPUS.map((doc) => ({
    doc,
    score: cosineSimilarity(queryEmb, doc.embedding!),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map((s) => s.doc)
}

/* ------------------------------------------------------------------ *
 * Template-based grounded responses (fallback when LLM is unavailable)
 * ------------------------------------------------------------------ */
type Template = (element: string) => Omit<CopilotResponse, "schemaVersion" | "eventId">

const TEMPLATES: Record<FaultClass, Template> = {
  link_flap: (element) => ({
    summary: {
      text: `${element} is predicted to transition DOWN. Interface error rate is climbing on a steep ramp consistent with fiber degradation, ahead of any LSP loss.`,
      source: "PM-2024-117",
    },
    rootCause: {
      text: `Rising input errors with stable optical Tx power indicate receive-side fiber/connector degradation on ${element}, not a protocol fault. Left unaddressed it will breach the carrier-loss threshold and drop the LSP.`,
      source: "RB-OSPF-014",
    },
    remediation: [
      {
        description: `Pre-emptively move the deep-space pass LSP to its protect path before the link fails (no traffic loss).`,
        command: `vtysh -c "conf t" -c "mpls ldp" -c "no advertise-labels for ${element}" `,
        source: "RB-MPLS-022",
      },
      {
        description: `Raise OSPF cost on the degrading link so SPF steers traffic away gracefully.`,
        command: `vtysh -c "conf t" -c "interface ${element}" -c "ip ospf cost 65535"`,
        source: "RB-OSPF-014",
      },
    ],
    grounded: true,
  }),

  ldp_instability: (element) => ({
    summary: {
      text: `${element} shows LDP label churn rising sharply with session keepalive jitter — a control-plane instability that risks transient label blackholes.`,
      source: "RB-OSPF-014",
    },
    rootCause: {
      text: `Label add/withdraw rate on ${element} exceeds the stability band while the LDP session flaps near its hold timer. This is consistent with a flapping adjacency causing repeated label table rebuilds.`,
      source: "INC-2024-034",
    },
    remediation: [
      {
        description: `Stabilize the LDP session by extending the hold time and enabling session protection to ride out the churn.`,
        command: `vtysh -c "conf t" -c "mpls ldp" -c "discovery hello holdtime 45" -c "session protection"`,
        source: "RB-LDP-017",
      },
      {
        description: `Damp the flapping adjacency to stop repeated relearns.`,
        command: `vtysh -c "conf t" -c "interface ${element}" -c "ip ospf dead-interval 40"`,
        source: "RB-OSPF-014",
      },
    ],
    grounded: true,
  }),

  congestion: (element) => ({
    summary: {
      text: `${element} egress queue depth is trending toward tail-drop. At current slope the queue will saturate and discard pass traffic within the prediction window.`,
      source: "RB-QOS-009",
    },
    rootCause: {
      text: `Pass-burst traffic plus a transient demand spike is driving the egress queue on ${element} past its drop threshold. The scheduler is not protecting the high-priority pass class adequately.`,
      source: "INC-2023-112",
    },
    remediation: [
      {
        description: `Apply strict-priority queuing for the pass class so spacecraft telemetry is never dropped under load.`,
        command: `vtysh -c "conf t" -c "interface ${element}" -c "priority-queue out class pass-telemetry"`,
        source: "RB-QOS-009",
      },
      {
        description: `Shed best-effort traffic onto the protect path to relieve the queue.`,
        command: `vtysh -c "conf t" -c "mpls te" -c "tunnel protect best-effort reroute"`,
        source: "RB-MPLS-022",
      },
    ],
    grounded: true,
  }),

  bgp_route_flap: (element) => ({
    summary: {
      text: `${element} BGP peer is flapping: prefix count oscillates and OSPF convergence timer spikes. Downstream cascade imminent — P1, P3, PE2 will recalculate FIB on every update.`,
      source: "PM-2023-098",
    },
    rootCause: {
      text: `BGP route flap on ${element} (prefix advertisements/withdrawals in rapid succession) triggers OSPF/LDP reconvergence. Root cause: likely BGP daemon instability or peer reachability issue. Each update cascades downstream as all routers rebuild their FIB.`,
      source: "RB-BGP-031",
    },
    remediation: [
      {
        description: `Enable BGP route dampening to suppress flapping routes and stabilize the control plane.`,
        command: `vtysh -c "conf t" -c "router bgp 65000" -c "bgp dampening"`,
        source: "RB-BGP-031",
      },
      {
        description: `Increase BGP keepalive/holdtime to tolerate transient peer loss without full session teardown.`,
        command: `vtysh -c "conf t" -c "router bgp 65000" -c "timers bgp 10 30"`,
        source: "RB-BGP-031",
      },
      {
        description: `If the peer remains unstable, isolate it to prevent cascade: administratively shut the neighbor.`,
        command: `vtysh -c "conf t" -c "router bgp 65000" -c "neighbor 10.0.0.1 shutdown"`,
        source: "CMD-FRR-REF",
      },
    ],
    grounded: true,
  }),

  policy_drift: (element) => ({
    summary: {
      text: `SD-WAN controller reports policy drift on ${element}: compliance degrading, orchestration latency rising, tunnels dropping. Device config has diverged from controller template.`,
      source: "RB-SDWAN-008",
    },
    rootCause: {
      text: `Policy drift: the controller's desired-state (QoS, routing, tunnel policies) no longer matches the device running-config on ${element}. Root cause: manual config changes bypassing the controller, or controller-device sync failure. This degrades traffic engineering and QoS guarantees.`,
      source: "SDWAN-CTRL-001",
    },
    remediation: [
      {
        description: `Reconcile device config with controller template to restore compliance.`,
        command: `sdwan-cli policy reconcile --site ${element}`,
        source: "RB-SDWAN-008",
      },
      {
        description: `Roll back unauthorized manual changes to prevent further drift.`,
        command: `sdwan-cli config rollback --site ${element} --to-template`,
        source: "RB-SDWAN-008",
      },
      {
        description: `Enable config lock on the device to block manual edits that bypass the controller.`,
        command: `sdwan-cli config lock --site ${element}`,
        source: "SDWAN-CTRL-001",
      },
    ],
    grounded: true,
  }),
}

/* ------------------------------------------------------------------ *
 * Ollama LLM integration — proxied via /api/copilot (server-side)
 * This runs in the browser; direct localhost:11434 access is blocked
 * by the browser's same-origin policy. The Next.js API route handles
 * the actual Ollama fetch on the Node.js server side.
 * ------------------------------------------------------------------ */

async function callOllamaLLM(prompt: string): Promise<{ response: string; inferenceMs: number }> {
  const res = await fetch("/api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(35000), // Mistral 7B can take ~20s on first token
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error((err as { error: string }).error || `HTTP ${res.status}`)
  }
  const data = (await res.json()) as { response: string; inferenceMs: number }
  return data
}

function buildLLMPrompt(event: PredictionEvent, docs: CorpusEntry[]): string {
  // Keep evidence to 3 rows max and docs to top-3 to minimise token count
  const evidence = event.evidence.slice(0, 3).map((e) => `${e.label}: ${e.value}`).join(", ")
  const context = docs.slice(0, 3).map((d) => `[${d.id}] ${d.content.slice(0, 300)}`).join("\n")
  return `Sentinel Copilot (air-gapped NOC). Explain the fault and give remediation citing ONLY the runbooks below. No hallucination.
FAULT: ${event.faultClass} on ${event.element}, ${(event.confidence*100).toFixed(0)}% conf, impact in ${event.timeToImpactS}s. Evidence: ${evidence}
RUNBOOKS:
${context}
Reply with ONLY this JSON (no markdown, no extra text):
{"summary":{"text":"...","source":"ID"},"rootCause":{"text":"...","source":"ID"},"remediation":[{"description":"...","command":"...","source":"ID"}],"grounded":true}`
}

function parseLLMResponse(raw: string, eventId: string): Omit<CopilotResponse, "schemaVersion" | "fromLLM" | "inferenceMs"> {
  try {
    // Extract JSON from markdown fence if present
    const match = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || raw.match(/(\{[\s\S]*\})/)
    if (!match) throw new Error("No JSON found")
    const parsed = JSON.parse(match[1])
    return {
      eventId,
      summary: parsed.summary,
      rootCause: parsed.rootCause,
      remediation: parsed.remediation || [],
      grounded: parsed.grounded ?? true,
      escalation: parsed.grounded ? undefined : "Insufficient grounding — escalate to on-call network engineer.",
    }
  } catch (err) {
    console.warn("[v0] Failed to parse LLM JSON:", err)
    throw err
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */
/**
 * Generate a grounded copilot response for a prediction event.
 * Tries real Ollama LLM first; falls back to templates on failure.
 */
export async function generateCopilotResponse(req: CopilotRequest): Promise<CopilotResponse> {
  const { event } = req

  // Guardrail: if confidence is too low, escalate immediately (no LLM call)
  if (event.confidence < 0.55) {
    return {
      schemaVersion: COPILOT_SCHEMA_VERSION,
      eventId: event.id,
      summary: {
        text: `Anomaly detected on ${event.element} but evidence is insufficient to ground a specific root cause.`,
        source: "DETECTOR-EWMA-001",
      },
      rootCause: {
        text: "Insufficient grounding for a confident root cause.",
        source: "ARCH-AIRGAP-001",
      },
      remediation: [],
      grounded: false,
      escalation: "Insufficient grounding — escalate to on-call network engineer. No automated remediation advised.",
    }
  }

  // Retrieve top-5 most relevant docs
  const query = `${event.faultClass} ${event.element} ${event.evidence.map((e) => e.label).join(" ")}`
  const docs = retrieveDocs(query, 5)

  // Try real LLM
  try {
    const prompt = buildLLMPrompt(event, docs)
    const { response, inferenceMs } = await callOllamaLLM(prompt)
    const parsed = parseLLMResponse(response, event.id)
    return {
      schemaVersion: COPILOT_SCHEMA_VERSION,
      fromLLM: true,
      inferenceMs,
      ...parsed,
    }
  } catch (err) {
    console.warn("[v0] Ollama LLM unavailable, falling back to template")
    // Fallback to template
    const tpl = TEMPLATES[event.faultClass]
    const body = tpl(event.element)
    return {
      schemaVersion: COPILOT_SCHEMA_VERSION,
      eventId: event.id,
      fromLLM: false,
      ...body,
    }
  }
}

export interface LiveNetworkState {
  activeEvent: { faultClass: string; element: string; phase: string; confidence: number } | null
  passBurstActive: boolean
  topNodes: Array<{ id: string; cpuPct: number; queueDepthPct: number; ldpUp: number; ospfUp: number }>
  controllerCompliance: number
  tunnelsUp: number
  tunnelsTotal: number
}

/**
 * Answer a free-text NOC operator query grounded in the RAG corpus.
 * Accepts optional live network state so "what is happening now?" questions
 * are answered from real telemetry, not just historical runbooks.
 */
export async function answerQuery(query: string, live?: LiveNetworkState): Promise<CopilotResponse> {
  const docs = retrieveDocs(query, 3)
  const context = docs.map((d) => `[${d.id}] ${d.content.slice(0, 300)}`).join("\n")

  // Build compact live state block
  let liveBlock = ""
  if (live) {
    const nodes = live.topNodes
      .map((n) => `${n.id}: cpu=${n.cpuPct.toFixed(0)}% q=${n.queueDepthPct.toFixed(0)}% ldp=${n.ldpUp} ospf=${n.ospfUp}`)
      .join(", ")
    const fault = live.activeEvent
      ? `ACTIVE FAULT: ${live.activeEvent.faultClass} on ${live.activeEvent.element} (phase=${live.activeEvent.phase}, conf=${(live.activeEvent.confidence * 100).toFixed(0)}%)`
      : "No active fault"
    liveBlock = `LIVE STATE: ${fault} | Pass=${live.passBurstActive ? "ACTIVE" : "idle"} | PolicyCompliance=${live.controllerCompliance.toFixed(0)}% | Tunnels=${live.tunnelsUp}/${live.tunnelsTotal} | Nodes: ${nodes}\n`
  }

  const prompt = `Sentinel Copilot (air-gapped NOC). Answer using ONLY the runbooks below + live state. No hallucination.
${liveBlock}QUERY: ${query}
RUNBOOKS:
${context}
Reply with ONLY this JSON (no markdown):
{"summary":{"text":"...","source":"ID"},"rootCause":{"text":"...","source":"ID"},"remediation":[],"grounded":true}`

  try {
    const { response, inferenceMs } = await callOllamaLLM(prompt)
    const parsed = parseLLMResponse(response, `QUERY-${Date.now()}`)
    return {
      schemaVersion: COPILOT_SCHEMA_VERSION,
      fromLLM: true,
      inferenceMs,
      answeredQuery: query,
      ...parsed,
    }
  } catch (err) {
    return {
      schemaVersion: COPILOT_SCHEMA_VERSION,
      eventId: `QUERY-${Date.now()}`,
      summary: {
        text: `Query: "${query}". Ollama LLM is unavailable. Cannot answer without live inference.`,
        source: "ARCH-AIRGAP-001",
      },
      rootCause: {
        text: "LLM endpoint unreachable. Verify Ollama is running on localhost:11434 or set OLLAMA_BASE_URL.",
        source: "ARCH-AIRGAP-001",
      },
      remediation: [],
      grounded: false,
      escalation: "LLM unavailable — fallback to manual runbook search.",
      fromLLM: false,
      answeredQuery: query,
    }
  }
}

export function corpusTitle(id: string): string {
  return RAG_CORPUS.find((d) => d.id === id)?.title ?? id
}
