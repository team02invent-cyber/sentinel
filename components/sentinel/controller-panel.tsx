"use client"

import { Network, CheckCircle2, TriangleAlert, XCircle } from "lucide-react"
import type { ControllerState } from "@/lib/sentinel/schema"

interface Props {
  controller: ControllerState | null
}

function ComplianceBar({ pct }: { pct: number }) {
  const color = pct >= 95 ? "var(--ok)" : pct >= 75 ? "var(--warn)" : "var(--crit)"
  return (
    <div className="mt-1.5 w-full overflow-hidden rounded-full bg-secondary/50 h-2">
      <div
        className="h-2 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function AlarmIcon({ sev }: { sev: "info" | "warn" | "crit" }) {
  if (sev === "crit") return <XCircle className="size-3.5 shrink-0 text-[color:var(--crit)]" />
  if (sev === "warn") return <TriangleAlert className="size-3.5 shrink-0 text-[color:var(--warn)]" />
  return <CheckCircle2 className="size-3.5 shrink-0 text-[color:var(--info)]" />
}

export function ControllerPanel({ controller }: Props) {
  if (!controller) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-card font-mono text-[10px] text-muted-foreground">
        No controller data
      </div>
    )
  }

  const pct = controller.policyCompliancePct
  const isHealthy = pct >= 95 && controller.driftingSites === 0

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Network className="size-3.5 text-primary" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-foreground">
          SD-WAN Controller
        </span>
        <div className={`ml-auto flex items-center gap-1 font-mono text-[10px] ${isHealthy ? "text-[color:var(--ok)]" : "text-[color:var(--warn)]"}`}>
          {isHealthy ? <CheckCircle2 className="size-3" /> : <TriangleAlert className="size-3" />}
          {isHealthy ? "Nominal" : "Drift detected"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Policy compliance */}
        <div>
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="uppercase tracking-widest text-muted-foreground">Policy compliance</span>
            <span
              className="font-semibold tabular-nums text-sm"
              style={{ color: pct >= 95 ? "var(--ok)" : pct >= 75 ? "var(--warn)" : "var(--crit)" }}
            >
              {pct.toFixed(0)}%
            </span>
          </div>
          <ComplianceBar pct={pct} />
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border">
          <Stat label="Drifting sites" value={`${controller.driftingSites} / ${controller.totalSites}`} warn={controller.driftingSites > 0} />
          <Stat label="Tunnels up" value={`${controller.tunnelsUp} / ${controller.tunnelsTotal}`} warn={controller.tunnelsUp < controller.tunnelsTotal} />
          <Stat label="Orch. latency" value={`${controller.orchestrationLatencyMs.toFixed(0)} ms`} warn={controller.orchestrationLatencyMs > 100} />
          <Stat label="Active alarms" value={String(controller.alarms.length)} warn={controller.alarms.length > 0} />
        </div>

        {/* Alarms */}
        {controller.alarms.length > 0 && (
          <div>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-primary">
              Active alarms
            </span>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {controller.alarms.map((a) => (
                <div
                  key={a.id}
                  className={`flex items-start gap-2 rounded border px-2.5 py-2 ${
                    a.severity === "crit"
                      ? "border-[color:var(--crit)]/30 bg-[color:var(--crit)]/5"
                      : "border-[color:var(--warn)]/30 bg-[color:var(--warn)]/5"
                  }`}
                >
                  <AlarmIcon sev={a.severity} />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-mono text-[10px] text-foreground leading-snug">{a.message}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">site: {a.site}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isHealthy && (
          <div className="flex items-center justify-center rounded border border-[color:var(--ok)]/20 bg-[color:var(--ok)]/5 py-3 font-mono text-[10px] text-[color:var(--ok)]">
            All sites compliant · No policy drift detected
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${warn ? "text-[color:var(--warn)]" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  )
}
