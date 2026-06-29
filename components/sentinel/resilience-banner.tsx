"use client"

import { Cpu, Database, Radio, ShieldCheck, Sparkles, Unplug } from "lucide-react"

interface Props {
  running: boolean
}

interface Service {
  label: string
  detail: string
  Icon: typeof Cpu
  up: boolean
}

/**
 * Shown only while the WAN uplink is severed. Demonstrates the air-gap value:
 * every inference service runs on-prem, so prediction and grounded remediation
 * continue uninterrupted with zero external connectivity.
 */
export function ResilienceBanner({ running }: Props) {
  const services: Service[] = [
    { label: "Telemetry feed", detail: "local · 1 Hz", Icon: Radio, up: running },
    { label: "Prediction model", detail: "on-prem · tcn-fault-clf", Icon: Cpu, up: true },
    { label: "Copilot LLM", detail: "on-prem · quantized", Icon: Sparkles, up: true },
    { label: "RAG corpus", detail: "local · runbooks", Icon: Database, up: true },
    { label: "WAN uplink", detail: "severed", Icon: Unplug, up: false },
  ]

  return (
    <div className="rounded-lg border border-[color:var(--crit)]/40 bg-[color:var(--crit)]/5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-[color:var(--ok)]" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">
          Network severed · fully operational
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          prediction &amp; grounded remediation continue with zero external connectivity
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {services.map((s) => {
          const color = s.up ? "var(--ok)" : "var(--crit)"
          return (
            <div
              key={s.label}
              className="flex items-center gap-2 rounded border border-border bg-card px-2.5 py-1.5"
            >
              <s.Icon className="size-3.5 shrink-0" style={{ color }} />
              <div className="min-w-0">
                <div className="truncate font-mono text-[11px] text-foreground">{s.label}</div>
                <div className="font-mono text-[9px] uppercase tracking-widest" style={{ color }}>
                  {s.up ? "online" : "offline"} · {s.detail}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
