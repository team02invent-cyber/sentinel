"use client"

import { Grid2x2Check } from "lucide-react"
import type { SessionMetrics } from "@/lib/sentinel/schema"

interface Props {
  metrics: SessionMetrics
}

/**
 * Live confusion matrix + derived classifier metrics (precision / recall / F1).
 * Positive class = real fault, negative class = benign transient.
 */
export function ClassifierPanel({ metrics }: Props) {
  const tp = metrics.truePositives
  const fp = metrics.falseAlarms
  const fn = metrics.falseNegatives
  const tn = metrics.trueNegatives

  const cells = [
    { key: "tp", label: "True Positive", value: tp, sub: "fault caught", tone: "var(--ok)" },
    { key: "fn", label: "False Negative", value: fn, sub: "fault missed", tone: "var(--crit)" },
    { key: "fp", label: "False Positive", value: fp, sub: "false alarm", tone: "var(--warn)" },
    { key: "tn", label: "True Negative", value: tn, sub: "benign ignored", tone: "var(--info)" },
  ]

  const derived = [
    { label: "Precision", symbol: "P", value: metrics.precision, formula: "TP / (TP+FP)" },
    { label: "Recall", symbol: "R", value: metrics.recall, formula: "TP / (TP+FN)" },
    { label: "F1 Score", symbol: "F1", value: metrics.f1, formula: "2PR / (P+R)" },
  ]

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Grid2x2Check className="size-4 text-primary" />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
            Classifier Performance
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">live · this session</span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* axis labels + 2x2 matrix */}
        <div className="flex items-stretch gap-2">
          {/* actual axis (vertical) */}
          <div className="flex flex-col items-center justify-center">
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground [writing-mode:vertical-rl] rotate-180">
              Actual
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-2">
            <div className="text-center font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Predicted
            </div>
            <div className="grid grid-cols-2 gap-2">
              {cells.map((c) => (
                <div
                  key={c.key}
                  className="flex flex-col items-center justify-center rounded border px-2 py-3"
                  style={{ borderColor: `color-mix(in oklch, ${c.tone} 40%, transparent)`, background: `color-mix(in oklch, ${c.tone} 8%, transparent)` }}
                >
                  <span className="font-mono text-2xl font-semibold tabular-nums" style={{ color: c.tone }}>
                    {c.value}
                  </span>
                  <span className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: c.tone }}>
                    {c.label}
                  </span>
                  <span className="font-mono text-[9px] text-muted-foreground">{c.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* derived metrics */}
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded border border-border bg-border">
          {derived.map((d) => (
            <div key={d.symbol} className="flex flex-col items-center gap-0.5 bg-card px-2 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {d.label}
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                {d.value.toFixed(2)}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/70">{d.formula}</span>
            </div>
          ))}
        </div>

        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          Positive class = real fault · negative class = benign transient. Inject faults and
          transients from the control deck to populate the matrix live.
        </p>
      </div>
    </div>
  )
}
