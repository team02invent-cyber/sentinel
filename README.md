# Sentinel — Predictive Network Operations Platform

Air-gapped predictive NOC for deep-space ground station MPLS/SD-WAN fabric management.

## What it does

Sentinel continuously monitors a simulated 7-node MPLS core fabric and 5-site SD-WAN overlay, predicts network faults before they cause packet loss, and explains each prediction with grounded, cited remediation steps via a local LLM — with zero external egress.

**Core architectural law:** The ML model predicts. The LLM explains. The LLM never infers failure from raw telemetry — it receives an already-fired PredictionEvent and retrieves grounding from a local RAG corpus.

---

## Evaluation Rubric Coverage

| Dimension | Weight | Implementation |
|---|---|---|
| Technical Merit | 35% | EWMA z-score detector, 98-dim feature vector, 5 fault classes, TPR/FAR/LT50 live metrics |
| Copilot Effectiveness | 35% | 20+ doc RAG corpus, cosine similarity retrieval, Mistral 7B via Ollama, grounded template fallback, free-text NOC query |
| Security / Offline Compliance | 20% | Zero-egress air-gap panel, per-component boundary assertion, gNMI adapter stub |
| Documentation Quality | 10% | This README + `docs/ARCHITECTURE.md` |

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. (Optional but recommended) Start Ollama for real LLM inference
ollama serve
ollama pull mistral        # or: phi3, llama3.2

# 3. Run the dev server
pnpm dev

# 4. Open http://localhost:3000
```

**Without Ollama:** The copilot falls back to grounded templates automatically. All other features (detector, topology, NetFlow, syslog, controller panel) work fully without it.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint — must be a local address |
| `OLLAMA_MODEL` | `mistral` | Model to use (`mistral`, `phi3`, `llama3.2`) |

---

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system diagram, component map, schema reference, feature vector specification, detector algorithm, RAG architecture, and evaluation metric definitions.

---

## Fault Scenarios

| Scenario | Fault Class | Precursor Signals |
|---|---|---|
| Link flap / fiber degradation | `link_flap` | `ifErrorsPerS` rising, `rttMs` spiking |
| LDP / label-churn instability | `ldp_instability` | `labelChurnPerS` rising, `ldpUp` flapping |
| Congestion / queue buildup | `congestion` | `queueDepthPct` approaching 95% |
| BGP route flap + downstream cascade | `bgp_route_flap` | `bgpPrefixCount` oscillating, `ospfConvergenceMs` spiking; cascades to P1, P3, PE2 |
| SD-WAN controller policy drift | `policy_drift` | `policyCompliancePct` falling, `driftingSites` > 0 |

---

## Telemetry Sources

| Source | Format | Cadence |
|---|---|---|
| SNMP/gNMI node counters | `NodeMetrics` (14 fields × 7 nodes = 98-dim vector) | 1 Hz |
| Link health (IKE/rekey, ECMP, jitter trend) | `LinkMetrics` (8 fields × 9 links) | 1 Hz |
| BGP/OSPF routing events | Embedded in `NodeMetrics` | 1 Hz |
| SD-WAN controller state | `ControllerState` | 1 Hz |
| NetFlow / IPFIX | `NetFlowRecord` (full 5-tuple + DSCP) | 5s export |
| Syslog RFC 5424 | `SyslogEvent` (priority, severity, facility, msgId) | Fault-driven |

---

## Key Design Decisions

- **Simulated environment:** Fully reproducible and deterministic. A `GNMIAdapter` stub in `lib/sentinel/simulator.ts` documents the production wiring path for real gNMI/OpenConfig collectors (EVE-NG, GNS3, Containerlab). No hardware dependency for evaluation.
- **EWMA + z-score detector:** Explainable, low-latency, zero training pipeline. Anomaly score = fraction of the 98-dim feature vector with `|z| > 2.5`. Prediction fires at score >= 0.18.
- **Mistral 7B fallback to grounded templates:** Zero-hallucination guarantee. If Ollama is unreachable, templates fire instead. Every claim is still cited. The guardrail rejects any response with `confidence < 0.55`.
- **All headline numbers are design targets:** MTTD, MTTR, lead time, TPR/FAR are representative operational values, explicitly documented as such in the Evaluation Methodology panel and in `SCHEMA_NOTES`.

---

## Project Structure

```
lib/sentinel/
  schema.ts            Frozen data contracts v2.0 (5 schema namespaces)
  simulator.ts         Fabric simulator + EWMA detector + NetFlow/syslog emitters + gNMI adapter
  copilot.ts           RAG corpus (20 docs), cosine retrieval, Ollama LLM, grounded templates
  topology.ts          Static topology (nodes, links, LSP paths)
  health.ts            Frame -> per-node health signal mapper

hooks/
  use-sentinel.ts      React hook: 1 Hz engine tick, snapshot state, query routing

components/sentinel/
  header-bar.tsx       Title bar with session clock and air-gap indicator
  control-deck.tsx     Fault injection, pass/air-gap toggles, Reset, Run Demo
  metrics-ribbon.tsx   TPR, FAR, LT50, packets prevented live ribbon
  topology-map.tsx     Live SVG topology with fault highlight and LSP reroute
  prediction-timeline.tsx  Time-series sparklines for selected element
  copilot-panel.tsx    LLM copilot with free-text NOC query bar and BGP cascade display
  event-feed.tsx       Ordered prediction event log
  controller-panel.tsx SD-WAN controller compliance, tunnel health, alarms
  syslog-feed.tsx      RFC 5424 syslog table (severity-coloured)
  netflow-panel.tsx    NetFlow/IPFIX flow record table with DSCP annotation
  airgap-panel.tsx     Air-gap boundary assertion, per-component status
  eval-panel.tsx       Evaluation methodology + design targets
  resilience-banner.tsx  Air-gap mode notification banner

docs/
  ARCHITECTURE.md      System diagram, schema reference, detector, RAG, metrics
```

---

## Real Network Data (Production Path)

The simulator runs self-contained. To wire real network telemetry:

1. Deploy a gNMI collector (gnmic, OpenConfig) pointing at your routers
2. Map `gnmi.Notification` payloads into `TelemetryFrame` using the `GNMIAdapter` stub in `lib/sentinel/simulator.ts`
3. Replace the `SentinelEngine.tick()` call in `hooks/use-sentinel.ts` with your streaming adapter
4. All downstream components (detector, copilot, UI panels) work unchanged

No changes to the schema, detector, or copilot are required.
