"use client"

import { CheckCircle2, History, TriangleAlert, Route } from "lucide-react"
import { FAULT_LABELS } from "@/lib/sentinel/schema"
import type { PredictionEvent } from "@/lib/sentinel/schema"

interface Props {
  log: PredictionEvent[]
}

const OUTCOME: Record<
  NonNullable<PredictionEvent["outcome"]>,
  { label: string; color: string; Icon: typeof CheckCircle2 }
> = {
  prevented: { label: "prevented", color: "var(--ok)", Icon: CheckCircle2 },
  impacted: { label: "recovered", color: "var(--info)", Icon: Route },
  false_alarm: { label: "false alarm", color: "var(--warn)", Icon: TriangleAlert },
}

export function EventFeed({ log }: Props) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <History className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
          Event Log
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          resolved · {log.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {log.length === 0 ? (
          <p className="px-2 py-3 font-mono text-[11px] text-muted-foreground">
            No resolved events yet. Inject a scenario to generate a prediction.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {log.map((e) => {
              const o = OUTCOME[e.outcome ?? "prevented"]
              const Icon = o.Icon
              const isFalseAlarm = e.outcome === "false_alarm"
              return (
                <li
                  key={e.id + e.remediatedAt}
                  className="flex items-center gap-2 rounded border border-border bg-secondary/30 px-2.5 py-2"
                >
                  <Icon className="size-3.5 shrink-0" style={{ color: o.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] text-foreground">
                      {e.element} · {isFalseAlarm ? "Benign transient" : FAULT_LABELS[e.faultClass]}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {isFalseAlarm
                        ? `escalated · no impact · ${e.id}`
                        : `lead ${e.leadTimeS.toFixed(0)}s · conf ${(e.confidence * 100).toFixed(0)}% · ${e.id}`}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10px]" style={{ color: o.color }}>
                    {o.label}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
