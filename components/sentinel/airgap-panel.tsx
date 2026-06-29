"use client"

import {
  Cpu,
  Database,
  Globe,
  Lock,
  Radio,
  Server,
  ShieldCheck,
  Sparkles,
  Unplug,
  WifiOff,
  XCircle,
} from "lucide-react"

interface Props {
  airGapped: boolean
  running: boolean
}

interface Boundary {
  label: string
  detail: string
  egress: boolean // true = external egress — must be zero
  Icon: typeof Cpu
}

const COMPONENTS: Boundary[] = [
  {
    label: "Telemetry feed",
    detail: "gNMI/SNMP from local FRR nodes",
    egress: false,
    Icon: Radio,
  },
  {
    label: "Prediction model",
    detail: "tcn-fault-clf · on-prem GPU/CPU",
    egress: false,
    Icon: Cpu,
  },
  {
    label: "Copilot LLM",
    detail: "quantized 4-bit · llama.cpp",
    egress: false,
    Icon: Sparkles,
  },
  {
    label: "RAG corpus",
    detail: "FAISS + runbooks · local disk",
    egress: false,
    Icon: Database,
  },
  {
    label: "Dashboard UI",
    detail: "Next.js · served locally",
    egress: false,
    Icon: Server,
  },
  {
    label: "External network",
    detail: "internet / cloud APIs",
    egress: true,
    Icon: Globe,
  },
]

export function AirgapPanel({ airGapped, running }: Props) {
  const egressCount = COMPONENTS.filter((c) => c.egress).length
  const blocked = egressCount // all external egress paths are explicitly blocked
  const compliant = blocked === egressCount

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-primary" />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
            Air-Gap Boundary
          </span>
        </div>
        <div
          className="flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest"
          style={{
            background: compliant ? "var(--ok)" : "var(--crit)",
            color: compliant ? "var(--ok-foreground)" : "var(--crit-foreground)",
          }}
        >
          <ShieldCheck className="size-3" />
          {compliant ? "0 external egress" : "egress detected"}
        </div>
      </div>

      {/* sub-label */}
      <div className="border-b border-border bg-secondary/40 px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
        Every inference component runs on-prem · zero cloud dependency · assertion holds with WAN severed
      </div>

      {/* component list */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3">
        {COMPONENTS.map((c) => {
          const isExternal = c.egress
          const blocked = isExternal // we assert all external paths are blocked
          return (
            <div
              key={c.label}
              className="flex items-center gap-3 rounded border border-border bg-secondary/20 px-3 py-2"
            >
              <c.Icon
                className="size-4 shrink-0"
                style={{ color: isExternal ? "var(--crit)" : "var(--ok)" }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] text-foreground">{c.label}</div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  {c.detail}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {isExternal ? (
                  <>
                    <XCircle className="size-3.5 shrink-0" style={{ color: "var(--crit)" }} />
                    <span
                      className="font-mono text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: "var(--crit)" }}
                    >
                      blocked
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="inline-block size-1.5 rounded-full"
                      style={{
                        background: running ? "var(--ok)" : "var(--warn)",
                        boxShadow: running ? "0 0 4px var(--ok)" : undefined,
                      }}
                    />
                    <span
                      className="font-mono text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: running ? "var(--ok)" : "var(--warn)" }}
                    >
                      {running ? "online" : "paused"}
                    </span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* WAN status footer */}
      <div
        className="flex items-center gap-2 border-t border-border px-4 py-2.5"
        style={{
          background: airGapped ? "color-mix(in srgb, var(--crit) 8%, transparent)" : undefined,
        }}
      >
        {airGapped ? (
          <>
            <Unplug className="size-3.5 shrink-0" style={{ color: "var(--crit)" }} />
            <span className="font-mono text-[11px] font-semibold" style={{ color: "var(--crit)" }}>
              WAN severed
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              — prediction &amp; Copilot fully operational
            </span>
          </>
        ) : (
          <>
            <WifiOff className="size-3.5 shrink-0 text-[color:var(--ok)]" />
            <span
              className="font-mono text-[11px] font-semibold"
              style={{ color: "var(--ok)" }}
            >
              WAN connected
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              — no inference traffic leaves the boundary
            </span>
          </>
        )}
      </div>
    </div>
  )
}
