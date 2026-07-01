"use client"

import { History, Database } from "lucide-react"
import { FAULT_LABELS, type FaultClass } from "@/lib/sentinel/schema"
import type { PersistedIncident } from "@/lib/sentinel/history"

interface Props {
  history: PersistedIncident[]
}

const OUTCOME_TONE: Record<string, string> = {
  prevented: "var(--ok)",
  impacted: "var(--crit)",
  false_alarm: "var(--warn)",
}

/**
 * Persisted incident history (localStorage, air-gapped). These incidents are
 * also fed back into the RAG corpus so the Copilot can cite past incidents.
 */
export function HistoryPanel({ history }: Props) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="size-4 text-primary" />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
            Incident History
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Database className="size-3" />
          {history.length} on-device · fed to RAG
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="font-mono text-xs text-muted-foreground">
              No incidents recorded yet. Resolved incidents persist locally and
              survive reloads — the Copilot can then cite them as past incidents.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {history.map((inc) => (
              <div key={inc.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest"
                      style={{
                        background: `color-mix(in oklch, ${OUTCOME_TONE[inc.outcome] ?? "var(--muted)"} 15%, transparent)`,
                        color: OUTCOME_TONE[inc.outcome] ?? "var(--muted-foreground)",
                      }}
                    >
                      {inc.outcome.replace("_", " ")}
                    </span>
                    <span className="truncate font-mono text-[11px] text-foreground">
                      {FAULT_LABELS[inc.faultClass as FaultClass] ?? inc.faultClass}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {inc.element} · {new Date(inc.ts).toLocaleString()}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[11px] font-semibold tabular-nums text-foreground">
                    {inc.leadTimeS.toFixed(0)}s
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    lead
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
