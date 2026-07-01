"use client"

import { FlaskConical, Info } from "lucide-react"

interface MetricSpec {
  name: string
  symbol: string
  target: string
  how: string
  note?: string
}

const METRICS: MetricSpec[] = [
  {
    name: "True Positive Rate",
    symbol: "TPR",
    target: "≥ 90%",
    how: "TP / injected faults — fault is a TP if the prediction fires before impact.",
    note: "Measured against held-out injected fault scenarios (all five classes, randomised lead times).",
  },
  {
    name: "False Alarm Rate",
    symbol: "FAR",
    target: "≤ 1 / 10 min",
    how: "False alarms counted when the Copilot escalates on a benign transient that self-clears.",
    note: "Benign transients are injected at a rate of ~1 per 5–10 min in validation runs.",
  },
  {
    name: "Median Lead Time",
    symbol: "LT₅₀",
    target: "45 – 90 s",
    how: "Time from first prediction emission to simulated packet-loss impact, per true-positive event.",
    note: "Captured when the EWMA z-score anomaly score crosses the detection threshold (0.18).",
  },
  {
    name: "Inference Latency",
    symbol: "t_inf",
    target: "< 100 ms",
    how: "Wall-clock time from TelemetryFrame receipt to PredictionEvent emission by the ML plane.",
    note: "Design target for the production TCN model on a local GPU/CPU. Simulation: synchronous, < 1 ms.",
  },
  {
    name: "RAG Grounding Accuracy",
    symbol: "GA",
    target: "100%",
    how: "Every Copilot claim must carry a citation into the local corpus; non-cited claims → escalation.",
    note: "Verified structurally: grounded=true iff all fields carry a valid corpus id.",
  },
  {
    name: "E2E Response Time",
    symbol: "t_e2e",
    target: "< 2 s",
    how: "Telemetry tick → prediction → Copilot response rendered. Includes model + RAG retrieval.",
    note: "Design target for production offline LLM. Simulation: synchronous at 200 ms/tick.",
  },
]

const DESIGN_TARGETS = [
  { label: "MTTD vs reactive", value: "−180 s", context: "Design target; reactive baseline ≈ 3 min MTTD." },
  { label: "MTTR vs reactive", value: "25 min → < 1 min", context: "Design target; grounded CLI cuts operator response time." },
  { label: "Topology", value: "7 nodes / 9 links", context: "Demo fixed topology. Production: per-node model → N nodes." },
  { label: "Feature vector", value: "98-dim (14 × 7)", context: "Demo fixed. Production: 14 × N per-node with shared model." },
]

export function EvalPanel() {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
            Evaluation Methodology
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Info className="size-3" />
          all headline numbers are design targets unless cited
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-0 overflow-y-auto">
        {/* metric table */}
        <div className="grid grid-cols-1 divide-y divide-border">
          {METRICS.map((m) => (
            <div key={m.symbol} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest"
                    style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                  >
                    {m.symbol}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-foreground">
                    {m.name}
                  </span>
                </div>
                <span
                  className="shrink-0 font-mono text-[11px] font-semibold tabular-nums"
                  style={{ color: "var(--ok)" }}
                >
                  {m.target}
                </span>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                {m.how}
              </p>
              {m.note && (
                <p className="font-mono text-[10px] leading-relaxed text-muted-foreground/70 italic">
                  {m.note}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* design targets section */}
        <div className="border-t border-border">
          <div className="px-4 py-2.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-primary">
              Headline Figures (design targets / representative values)
            </span>
          </div>
          <div className="grid grid-cols-1 divide-y divide-border">
            {DESIGN_TARGETS.map((t) => (
              <div key={t.label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {t.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground/70 italic">
                    {t.context}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-foreground">
                  {t.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
