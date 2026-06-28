"use client"

import { Sparkline } from "./sparkline"
import { NODE_BY_ID } from "@/lib/sentinel/topology"
import type { NodeMetrics, LinkMetrics, PredictionEvent, TelemetryFrame } from "@/lib/sentinel/schema"

interface Props {
  frame: TelemetryFrame | null
  event: PredictionEvent | null
  selected: string | null
  nodeSeries: (id: string, key: keyof NodeMetrics) => number[]
  linkSeries: (id: string, key: keyof LinkMetrics) => number[]
}

/** Pick the most diagnostic series for the chosen element. */
function pickSignal(
  id: string,
  isNode: boolean,
  nodeSeries: Props["nodeSeries"],
  linkSeries: Props["linkSeries"],
): { label: string; unit: string; data: number[]; max: number } {
  if (!isNode) {
    return { label: "Link error rate", unit: "%/s", data: linkSeries(id, "errorRatePct"), max: 5 }
  }
  // choose the signal with the strongest recent slope among key node metrics
  const candidates: { label: string; unit: string; key: keyof NodeMetrics; max: number }[] = [
    { label: "Egress queue depth", unit: "%", key: "queueDepthPct", max: 100 },
    { label: "Label churn", unit: "/s", key: "labelChurnPerS", max: 200 },
    { label: "Control-plane CPU", unit: "%", key: "cpuPct", max: 100 },
  ]
  let best = candidates[0]
  let bestSlope = -Infinity
  for (const c of candidates) {
    const s = nodeSeries(id, c.key)
    if (s.length < 6) continue
    const slope = s[s.length - 1] - s[s.length - 6]
    if (slope > bestSlope) {
      bestSlope = slope
      best = c
    }
  }
  return { label: best.label, unit: best.unit, data: nodeSeries(id, best.key), max: best.max }
}

export function PredictionTimeline({ frame, event, selected, nodeSeries, linkSeries }: Props) {
  // Default focus: the active event element, else the selected node, else PE1.
  const focus = event?.element ?? selected ?? "PE1"
  const isNode = !!NODE_BY_ID[focus]
  const sig = pickSignal(focus, isNode, nodeSeries, linkSeries)

  const inWindow = event && (event.phase === "degrading" || event.phase === "imminent")
  const failed = event?.phase === "failed"
  const tti = event?.timeToImpactS ?? 0

  // Predicted window starts where "now minus lead time" sits in the 120s view.
  const predictedFrom = inWindow ? 0.72 : null

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Prediction Timeline
          </div>
          <div className="mt-0.5 font-mono text-sm text-foreground">
            {focus} · <span className="text-muted-foreground">{sig.label}</span>
          </div>
        </div>
        {event ? (
          <CountdownBadge tti={tti} failed={failed} phase={event.phase} />
        ) : (
          <div className="rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-[color:var(--ok)]">
            All systems nominal
          </div>
        )}
      </div>

      <div className="mt-3 flex-1">
        <Sparkline
          data={sig.data}
          max={sig.max}
          height={120}
          color={failed ? "var(--crit)" : inWindow ? "var(--warn)" : "var(--primary)"}
          predictedFrom={predictedFrom}
          className="h-full w-full"
        />
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>120s window · 1 Hz</span>
        <span className="tabular-nums">
          now: {sig.data.length ? `${sig.data[sig.data.length - 1].toFixed(1)} ${sig.unit}` : "—"}
        </span>
        {inWindow && <span className="text-[color:var(--warn)]">shaded = predicted failure window</span>}
      </div>
    </div>
  )
}

function CountdownBadge({ tti, failed, phase }: { tti: number; failed: boolean; phase: string }) {
  if (failed) {
    return (
      <div className="rounded-md bg-[color:var(--crit)] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-[color:var(--crit-foreground)]">
        Impact · packet loss
      </div>
    )
  }
  if (phase === "recovering") {
    return (
      <div className="rounded-md border border-[color:var(--info)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-[color:var(--info)]">
        Recovering
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-[color:var(--warn)] bg-[color:var(--warn)]/10 px-2.5 py-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--warn)]">
        Impact in
      </span>
      <span className="font-mono text-lg font-bold tabular-nums text-[color:var(--warn)] animate-sentinel-pulse">
        {Math.max(0, tti).toFixed(0)}s
      </span>
    </div>
  )
}
