# Sentinel — Architecture Reference

## 1. System Overview

Sentinel is an air-gapped predictive network operations platform for deep-space ground station MPLS/SD-WAN fabric management. It operates with zero external network egress — all telemetry processing, fault prediction, and LLM inference run entirely on-premises.

**Core architectural law:** The ML model PREDICTS. The LLM EXPLAINS. The LLM is never responsible for fault detection; it receives an already-fired PredictionEvent and retrieves grounding from a local corpus to explain and remediate it.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AIR-GAP BOUNDARY                             │
│                                                                     │
│  ┌──────────────┐   1 Hz frames   ┌──────────────────────────────┐  │
│  │  MPLS/SD-WAN │ ──────────────► │  Telemetry Ingress           │  │
│  │  Fabric Sim  │                 │  TelemetryFrame v2.0         │  │
│  │  (7 nodes)   │ ◄── remediate── │  NodeMetrics × 7 nodes       │  │
│  └──────────────┘                 │  LinkMetrics × 9 links       │  │
│                                   │  ControllerState             │  │
│         NetFlow/IPFIX (5s)        │  NetFlowRecord (every 5s)    │  │
│         Syslog RFC 5424           │  SyslogEvent (fault-driven)  │  │
│                                   └──────────┬───────────────────┘  │
│                                              │ 98-dim feature vector │
│                                              ▼                       │
│                                   ┌──────────────────────────────┐  │
│                                   │  Anomaly Detector            │  │
│                                   │  EWMA baseline (α=0.15)      │  │
│                                   │  Rolling z-score (30-sample) │  │
│                                   │  Anomaly score ≥ 0.18 fires  │  │
│                                   └──────────┬───────────────────┘  │
│                                              │ PredictionEvent v2.0  │
│                                              ▼                       │
│                                   ┌──────────────────────────────┐  │
│                                   │  Copilot (Grounded Responder) │  │
│                                   │  RAG: 20+ runbooks, incidents │  │
│                                   │  Cosine-sim retrieval (top-5) │  │
│                                   │  LLM: Mistral 7B via Ollama   │  │
│                                   │  Fallback: grounded templates │  │
│                                   └──────────┬───────────────────┘  │
│                                              │ CopilotResponse v2.0  │
│                                              ▼                       │
│                                   ┌──────────────────────────────┐  │
│                                   │  NOC Dashboard (React/Next)  │  │
│                                   │  Topology map, timeline,     │  │
│                                   │  syslog, NetFlow, controller │  │
│                                   │  Free-text query interface   │  │
│                                   └──────────────────────────────┘  │
│                                                                     │
│  ZERO external egress. No cloud API, no internet, no telemetry     │
│  sent outside this boundary.                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Map

| File | Role |
|---|---|
| `lib/sentinel/schema.ts` | Frozen interface contracts v2.0 — all data types |
| `lib/sentinel/simulator.ts` | MPLS/SD-WAN fabric simulator + EWMA detector engine |
| `lib/sentinel/copilot.ts` | RAG corpus, cosine retrieval, Ollama LLM, template fallback |
| `lib/sentinel/topology.ts` | Static topology definition (nodes, links, LSP paths) |
| `lib/sentinel/health.ts` | Health signal mapper (frame → per-node status) |
| `hooks/use-sentinel.ts` | React hook: ticks engine at 1 sim-Hz, manages state |
| `components/sentinel/` | All UI panels |

---

## 3. Schema Namespaces (v2.0)

Five independent versioned schemas:

| Schema | Version | Key additions v2.0 |
|---|---|---|
| `TelemetryFrame` | 2.0 | `bgpPrefixCount`, `ospfConvergenceMs` per node; `ikeState`, `rekeyAgeSec`, `jitterTrendMsPerS`, `ecmpAsymmetryRatio` per link; `ControllerState` embedded |
| `PredictionEvent` | 2.0 | `anomalyScore`, `cascadeNodes` for BGP fault |
| `CopilotResponse` | 2.0 | `fromLLM`, `inferenceMs`, `answeredQuery` |
| `NetFlowRecord` | 1.0 | Full IPFIX 5-tuple + DSCP + bytes/packets + timestamps |
| `SyslogEvent` | 1.0 | RFC 5424: priority, severity, facility, hostname, appName, msgId, structuredData |

---

## 4. Feature Vector

The anomaly detector operates on a **98-dimensional feature vector**: 14 metrics × 7 nodes, sampled at 1 Hz.

```
Feature vector = [
  node_PE1: [inMbps, outMbps, ifErrorsPerS, ifDiscardsPerS, queueDepthPct,
             cpuPct, ldpUp, ospfUp, lspUp, labelChurnPerS, rttMs, jitterMs,
             bgpPrefixCount, ospfConvergenceMs],
  node_PE2: [...same 14...],
  ... × 7 nodes
]
```

**Scale note:** The 98-dim vector bakes in 7 nodes (topology-specific). In production, a per-node feature vector (14 × N) fed to a shared model is topology-agnostic and scales to arbitrary fabric size.

---

## 5. Anomaly Detector

Replaces the naive ramp-timer used in v1. Each of the 14 metrics per node has:

- **EWMA baseline** — exponentially weighted moving average (α = 0.15) tracks the rolling mean
- **Rolling std-dev** — 30-sample window
- **Per-sample z-score** — `(value - mean) / std`
- **Anomaly flag** — `|z| > 2.5` triggers a per-metric flag

**Aggregate anomaly score** = fraction of all 98 dimensions that are flagged.

**Prediction fires** when `anomaly_score ≥ 0.18` (18% of the feature vector is flagged). This threshold was tuned for the representative dataset to hit TPR ≥ 0.95 while keeping FAR ≤ 0.5/10min.

---

## 6. Fault Classes

| Class | Precursor signals | Cascade |
|---|---|---|
| `link_flap` | ifErrorsPerS rising, rttMs spiking, lspUp oscillating | LSP drops to protect path |
| `ldp_instability` | labelChurnPerS rising, ldpUp flapping | Label blackhole risk |
| `congestion` | queueDepthPct approaching 95%, outMbps near capacity | Tail-drop on pass traffic |
| `bgp_route_flap` | bgpPrefixCount oscillating, ospfConvergenceMs spiking | Downstream FIB cascade: P1, P3, PE2 |
| `policy_drift` | policyCompliancePct falling, driftingSites > 0, orchestrationLatencyMs rising | QoS/routing guarantees degraded |

---

## 7. Copilot RAG Architecture

**Corpus:** 20 documents — runbooks (RB-*), config snapshots (CFG-*), postmortems (PM-*), incident logs (INC-*), topology docs (TOPO-*), metric definitions (METRIC-*), detector docs (DETECTOR-*), SD-WAN docs (SDWAN-*), architecture docs (ARCH-*).

**Retrieval:** Query → stub embedding (384-dim, deterministic hash-seeded LCG) → cosine similarity against all corpus embeddings → top-5 documents returned.

**Production path:** Replace stub embedding with `sentence-transformers/all-MiniLM-L6-v2` (local, air-gapped). Replace in-memory sorted scan with FAISS IndexFlatIP.

**LLM:** Mistral 7B (4-bit quantized) via Ollama at `OLLAMA_BASE_URL` (default: `http://localhost:11434`). Falls back to grounded templates if Ollama is unreachable. Temperature: 0.3, top_p: 0.9, timeout: 15s.

**Guardrail:** If `event.confidence < 0.55`, no LLM call is made — escalate immediately.

---

## 8. Telemetry Sources

| Source | Format | Cadence | Status |
|---|---|---|---|
| SNMP/gNMI counters | `NodeMetrics` (14 fields) | 1 Hz | Simulated |
| Link metrics | `LinkMetrics` (8 fields) | 1 Hz | Simulated |
| BGP/OSPF routing events | `bgpPrefixCount`, `ospfConvergenceMs` | 1 Hz | Simulated |
| NetFlow/IPFIX | `NetFlowRecord` (IPFIX 5-tuple) | 5s export | Simulated |
| Syslog RFC 5424 | `SyslogEvent` | Fault-driven | Simulated |
| SD-WAN controller | `ControllerState` | 1 Hz | Simulated |

**gNMI adapter:** `lib/sentinel/simulator.ts` exports `GNMIAdapter` — a stub that maps real `gnmi.Notification` payloads into `TelemetryFrame`. Wire a real gNMI collector (gnmic, OpenConfig) to this adapter for production use.

---

## 9. Evaluation Metrics

| Metric | Definition | Target | Measurement |
|---|---|---|---|
| TPR | TP / injected_faults | ≥ 0.95 | Prediction fired with leadTimeS > 15s |
| FAR | false_alarms / (session_min / 10) | ≤ 0.5 / 10min | Escalations where confidence < 0.55 |
| LT50 | median(leadTimesS) | ≥ 30s | Captured at detection moment |
| t_inf | LLM inference latency | ≤ 2000ms | `CopilotResponse.inferenceMs` |
| Anomaly score | mean(|z| > 2.5 fraction) | ≥ 0.18 at detection | `PredictionEvent.anomalyScore` |

**Design-target references:** MTTD reactive 180s, MTTR reactive 1500s. Predictive gain: MTTD reduced to ~35s (LT50), MTTR reduced to ~120s (operator acts on Copilot remediation before impact).

---

## 10. Air-Gap Compliance

Every component is verified zero-egress:

| Component | Network access | Verdict |
|---|---|---|
| Telemetry feed | None — in-process simulation | PASS |
| Prediction model | None — deterministic JS | PASS |
| Copilot LLM | `localhost:11434` only | PASS |
| RAG corpus | In-memory, local files | PASS |
| Dashboard UI | Served locally (Next.js) | PASS |
| External internet | Blocked | PASS |

The `OLLAMA_BASE_URL` environment variable must point to a local address. Any external URL will violate the air-gap contract.

---

## 11. Design Decisions

| Decision | Rationale |
|---|---|
| Simulated environment (no real EVE-NG/GNS3) | Reproducible, deterministic, no hardware dependency for demo/evaluation |
| EWMA + z-score (not LSTM/Prophet) | Explainable, low-latency, no training pipeline required; captures the statistical detection concept |
| Templates as LLM fallback | Guarantees grounded responses even when Ollama is unreachable; preserves zero-hallucination guarantee |
| 98-dim flat feature vector | Simplest representation for a 7-node demo; documented scale path to per-node graph model |
| All schema fields documented | Enables judges/reviewers to verify the full data model without running the code |
