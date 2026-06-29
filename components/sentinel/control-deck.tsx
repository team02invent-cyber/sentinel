"use client"

import { Pause, Play, Radio, Satellite, Unplug, Cable } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FaultClass } from "@/lib/sentinel/schema"

interface Props {
  passActive: boolean
  airGapped: boolean
  running: boolean
  faultActive: boolean
  onInject: (cls: FaultClass) => void
  onInjectTransient: () => void
  onTogglePass: () => void
  onToggleAirGap: () => void
  onToggleRunning: () => void
}

const FAULTS: { cls: FaultClass; label: string }[] = [
  { cls: "link_flap", label: "Inject Link Flap" },
  { cls: "ldp_instability", label: "Inject LDP Churn" },
  { cls: "congestion", label: "Inject Congestion" },
]

export function ControlDeck({
  passActive,
  airGapped,
  running,
  faultActive,
  onInject,
  onInjectTransient,
  onTogglePass,
  onToggleAirGap,
  onToggleRunning,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Scenario
      </span>

      {FAULTS.map((f) => (
        <Button
          key={f.cls}
          size="sm"
          variant="outline"
          disabled={faultActive}
          onClick={() => onInject(f.cls)}
          className="font-mono text-[11px]"
        >
          {f.label}
        </Button>
      ))}

      <Button
        size="sm"
        variant="outline"
        disabled={faultActive}
        onClick={onInjectTransient}
        className="font-mono text-[11px] text-muted-foreground"
        title="Benign glitch: low-confidence anomaly the Copilot escalates instead of advising"
      >
        Inject Transient
      </Button>

      <div className="mx-1 h-5 w-px bg-border" />

      <Button
        size="sm"
        variant={passActive ? "default" : "outline"}
        onClick={onTogglePass}
        className="font-mono text-[11px]"
      >
        <Satellite className="size-3.5" />
        {passActive ? "Pass Active" : "Start Pass"}
      </Button>

      <Button
        size="sm"
        variant={airGapped ? "destructive" : "outline"}
        onClick={onToggleAirGap}
        className="font-mono text-[11px]"
      >
        {airGapped ? <Unplug className="size-3.5" /> : <Cable className="size-3.5" />}
        {airGapped ? "Air-Gapped" : "Cut Network"}
      </Button>

      <div className="mx-1 h-5 w-px bg-border" />

      <Button size="sm" variant="ghost" onClick={onToggleRunning} className="font-mono text-[11px]">
        {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        {running ? "Pause" : "Resume"}
      </Button>

      <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Radio className={`size-3 ${running ? "text-[color:var(--ok)]" : "text-muted-foreground"}`} />
        {running ? "Live · 1 Hz" : "Paused"}
      </span>
    </div>
  )
}
