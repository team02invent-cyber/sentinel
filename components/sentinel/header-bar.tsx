"use client"

import { Activity, Lock } from "lucide-react"

interface Props {
  t: number
  airGapped: boolean
}

export function HeaderBar({ t, airGapped }: Props) {
  const mm = String(Math.floor(t / 60)).padStart(2, "0")
  const ss = String(t % 60).padStart(2, "0")
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md border border-primary/40 bg-primary/10">
          <Activity className="size-4 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-foreground">
              Sentinel
            </h1>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              v1.0
            </span>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            Air-Gapped Predictive Network Operations Platform · grounded offline copilot
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest"
          style={{
            borderColor: airGapped ? "var(--crit)" : "var(--ok)",
            color: airGapped ? "var(--crit)" : "var(--ok)",
          }}
        >
          <Lock className="size-3" />
          {airGapped ? "Network severed · operational" : "Air-gap ready"}
        </div>
        <div className="font-mono text-xs tabular-nums text-muted-foreground">
          T+{mm}:{ss}
        </div>
      </div>
    </header>
  )
}
