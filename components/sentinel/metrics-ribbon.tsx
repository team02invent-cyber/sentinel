"use client"

import type { SessionMetrics } from "@/lib/sentinel/schema"

interface Props {
  metrics: SessionMetrics
}

export function MetricsRibbon({ metrics }: Props) {
  const cells = [
    {
      label: "True Positive Rate",
      value: metrics.injectedFaults ? `${(metrics.tpr * 100).toFixed(0)}%` : "—",
      sub: `${metrics.truePositives}/${metrics.injectedFaults} faults`,
      target: "target ≥ 90%",
      good: metrics.tpr >= 0.9 || metrics.injectedFaults === 0,
    },
    {
      label: "False Alarm Rate",
      value: `${metrics.farPer10Min.toFixed(2)}`,
      sub: "per 10 min",
      target: "target ≤ 1",
      good: metrics.farPer10Min <= 1,
    },
    {
      label: "Median Lead Time",
      value: metrics.medianLeadTimeS ? `${metrics.medianLeadTimeS.toFixed(0)}s` : "—",
      sub: "before impact",
      target: "target 45–90s",
      good: metrics.medianLeadTimeS >= 30,
    },
    {
      label: "Loss Prevented",
      value: formatPkts(metrics.packetsLossPrevented),
      sub: "packets",
      target: "this session",
      good: metrics.packetsLossPrevented > 0,
    },
    {
      label: "MTTD vs Reactive",
      value: `−${metrics.reactiveMttdS}s`,
      sub: "detect ahead of impact",
      target: "design target",
      good: true,
    },
    {
      label: "MTTR vs Reactive",
      value: `${Math.round(metrics.reactiveMttrS / 60)}m → <1m`,
      sub: "grounded remediation",
      target: "design target",
      good: true,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col gap-1 bg-card px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {c.label}
          </div>
          <div
            className="font-mono text-2xl font-semibold tabular-nums"
            style={{ color: c.good ? "var(--ok)" : "var(--warn)" }}
          >
            {c.value}
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>{c.sub}</span>
            <span className="opacity-70">{c.target}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatPkts(n: number): string {
  if (n === 0) return "0"
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}
