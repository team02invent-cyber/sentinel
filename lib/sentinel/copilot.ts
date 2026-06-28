/**
 * SENTINEL — Offline Copilot (grounded responder)
 * -----------------------------------------------
 * Stand-in for the air-gapped quantized LLM + RAG plane.
 * In production this is llama.cpp/Ollama (4-bit 3-8B) + FAISS over the
 * network's own runbooks/configs. Here we return the SAME CopilotResponse
 * contract with hard citations so the UI and demo are exact.
 *
 * RULE: every claim carries a citation. If grounding is insufficient,
 * we escalate instead of advising. The responder NEVER predicts — it
 * only explains the PredictionEvent it is handed.
 */

import {
  COPILOT_SCHEMA_VERSION,
  type CopilotRequest,
  type CopilotResponse,
  type FaultClass,
} from "./schema"

/** The local RAG corpus, referenced by citation id. */
export const RAG_CORPUS: { id: string; title: string }[] = [
  { id: "RB-OSPF-014", title: "Runbook: OSPF/LDP reconvergence on link fault" },
  { id: "RB-MPLS-022", title: "Runbook: TE LSP protect-path switchover" },
  { id: "RB-QOS-009", title: "Runbook: Egress queue congestion mitigation" },
  { id: "CFG-PE2-IFm", title: "Config: PE2 interface & SRLG mapping" },
  { id: "PM-2024-117", title: "Postmortem: fiber degradation, pass DSN-117" },
  { id: "CMD-FRR-REF", title: "FRRouting command reference (vtysh)" },
]

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
      source: "PM-2024-117",
    },
    remediation: [
      {
        description: `Stabilize the LDP session by extending the hold time and enabling session protection to ride out the churn.`,
        command: `vtysh -c "conf t" -c "mpls ldp" -c "discovery hello holdtime 45" -c "session protection"`,
        source: "CMD-FRR-REF",
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
      source: "CFG-PE2-IFm",
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
}

/**
 * Generate a grounded response for a prediction event.
 * Mirrors the offline LLM + RAG call. Synchronous here; the UI streams it.
 */
export function generateCopilotResponse(req: CopilotRequest): CopilotResponse {
  const { event } = req
  const tpl = TEMPLATES[event.faultClass]

  // Guardrail: if confidence is too low to ground a recommendation,
  // escalate instead of advising (anti-hallucination contract).
  if (event.confidence < 0.55) {
    return {
      schemaVersion: COPILOT_SCHEMA_VERSION,
      eventId: event.id,
      summary: {
        text: `Anomaly detected on ${event.element} but evidence is insufficient to ground a specific root cause.`,
        source: "RB-OSPF-014",
      },
      rootCause: {
        text: "Insufficient grounding for a confident root cause.",
        source: "RB-OSPF-014",
      },
      remediation: [],
      grounded: false,
      escalation:
        "Insufficient grounding — escalate to on-call network engineer. No automated remediation advised.",
    }
  }

  const body = tpl(event.element)
  return {
    schemaVersion: COPILOT_SCHEMA_VERSION,
    eventId: event.id,
    ...body,
  }
}

export function corpusTitle(id: string): string {
  return RAG_CORPUS.find((d) => d.id === id)?.title ?? id
}
