"use client"

import { Activity } from "lucide-react"
import type { NetFlowRecord } from "@/lib/sentinel/schema"

interface Props {
  flows: NetFlowRecord[]
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)}G`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)}M`
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)}K`
  return `${b}`
}

const DSCP_LABEL: Record<number, string> = {
  0: "BE",
  46: "EF",
  34: "AF41",
  26: "AF31",
  18: "AF21",
  10: "AF11",
}

export function NetflowPanel({ flows }: Props) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Activity className="size-3.5 text-primary" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-foreground">
          NetFlow / IPFIX
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          5s export intervals
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {flows.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-[10px] text-muted-foreground">
            No flow records yet. Flows export every 5 sim-seconds.
          </div>
        ) : (
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-border">
                <th className="w-[80px] py-1 px-2 text-left font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Exporter</th>
                <th className="w-[80px] py-1 px-2 text-left font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Src IP</th>
                <th className="w-[80px] py-1 px-2 text-left font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Dst IP</th>
                <th className="w-[40px] py-1 px-2 text-left font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Proto</th>
                <th className="w-[40px] py-1 px-2 text-left font-mono text-[9px] uppercase tracking-widest text-muted-foreground">DSCP</th>
                <th className="w-[60px] py-1 px-2 text-right font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Bytes</th>
                <th className="w-[50px] py-1 px-2 text-right font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Pkts</th>
              </tr>
            </thead>
            <tbody>
              {flows.map((f, i) => {
                const isPass = f.dscp === 46
                return (
                  <tr
                    key={i}
                    className={`border-b border-border/50 ${isPass ? "bg-[color:var(--info)]/5" : ""}`}
                  >
                    <td className="px-2 py-0.5 font-mono text-[10px] text-foreground">{f.exporterNode}</td>
                    <td className="px-2 py-0.5 font-mono text-[10px] text-muted-foreground truncate">{f.srcIp}</td>
                    <td className="px-2 py-0.5 font-mono text-[10px] text-muted-foreground truncate">{f.dstIp}</td>
                    <td className="px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{f.protocol}</td>
                    <td className="px-2 py-0.5 font-mono text-[10px]">
                      <span className={isPass ? "text-[color:var(--ok)] font-semibold" : "text-muted-foreground"}>
                        {DSCP_LABEL[f.dscp] ?? f.dscp}
                      </span>
                    </td>
                    <td className="px-2 py-0.5 font-mono text-[10px] text-foreground text-right">{fmtBytes(f.bytes)}</td>
                    <td className="px-2 py-0.5 font-mono text-[10px] text-muted-foreground text-right">{f.packets.toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
