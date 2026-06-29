"use client"

import { Terminal } from "lucide-react"
import type { SyslogEvent } from "@/lib/sentinel/schema"

interface Props {
  log: SyslogEvent[]
}

const SEV_COLOR: Record<string, string> = {
  emerg:   "text-[color:var(--crit)]",
  alert:   "text-[color:var(--crit)]",
  crit:    "text-[color:var(--crit)]",
  err:     "text-[color:var(--crit)]",
  warning: "text-[color:var(--warn)]",
  notice:  "text-[color:var(--info)]",
  info:    "text-muted-foreground",
  debug:   "text-muted-foreground",
}

const SEV_BG: Record<string, string> = {
  emerg:   "bg-[color:var(--crit)]/10",
  alert:   "bg-[color:var(--crit)]/10",
  crit:    "bg-[color:var(--crit)]/8",
  err:     "bg-[color:var(--crit)]/5",
  warning: "bg-[color:var(--warn)]/8",
  notice:  "bg-[color:var(--info)]/5",
  info:    "",
  debug:   "",
}

export function SyslogFeed({ log }: Props) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Terminal className="size-3.5 text-primary" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-foreground">
          Syslog · RFC 5424
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {log.length} events
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {log.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-[10px] text-muted-foreground">
            No syslog events. Inject a fault to generate log entries.
          </div>
        ) : (
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-border">
                <th className="w-[70px] py-1 px-2 text-left font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Sev</th>
                <th className="w-[60px] py-1 px-2 text-left font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Host</th>
                <th className="py-1 px-2 text-left font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Message</th>
                <th className="w-[60px] py-1 px-2 text-right font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Time</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e, i) => (
                <tr
                  key={i}
                  className={`border-b border-border/50 ${SEV_BG[e.severity] ?? ""}`}
                >
                  <td className={`px-2 py-1 font-mono text-[10px] font-semibold uppercase ${SEV_COLOR[e.severity] ?? "text-muted-foreground"}`}>
                    {e.severity}
                  </td>
                  <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground truncate">
                    {e.hostname}
                  </td>
                  <td className="px-2 py-1 font-mono text-[10px] text-foreground leading-snug">
                    {e.message}
                    {e.msgId && (
                      <span className="ml-1.5 text-muted-foreground">[{e.msgId}]</span>
                    )}
                  </td>
                  <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground text-right">
                    {e.timestamp.slice(11, 19)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
