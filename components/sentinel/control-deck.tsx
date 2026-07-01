"use client"

import { Pause, Play, Radio, Satellite, Unplug, Cable, RotateCcw, Clapperboard, FileJson, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { FaultClass } from "@/lib/sentinel/schema"

interface Props {
  passActive: boolean
  airGapped: boolean
  running: boolean
  faultActive: boolean
  demoStep: string | null
  onInject: (cls: FaultClass) => void
  onInjectTransient: () => void
  onTogglePass: () => void
  onToggleAirGap: () => void
  onToggleRunning: () => void
  onReset: () => void
  onRunDemo: () => void
  onExportJSON: () => void
  onPrintReport: () => void
}

const FAULTS: { cls: FaultClass; label: string }[] = [
  { cls: "link_flap", label: "Inject Link Flap" },
  { cls: "ldp_instability", label: "Inject LDP Churn" },
  { cls: "congestion", label: "Inject Congestion" },
  { cls: "bgp_route_flap", label: "Inject BGP Flap" },
  { cls: "policy_drift", label: "Inject Policy Drift" },
]

export function ControlDeck({
  passActive,
  airGapped,
  running,
  faultActive,
  demoStep,
  onInject,
  onInjectTransient,
  onTogglePass,
  onToggleAirGap,
  onToggleRunning,
  onReset,
  onRunDemo,
  onExportJSON,
  onPrintReport,
}: Props) {
  const demoRunning = !!demoStep

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        {/* Manual fault injection */}
        <span className="mr-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Inject
        </span>

        {FAULTS.map((f) => (
          <Button
            key={f.cls}
            size="sm"
            variant="outline"
            disabled={faultActive || demoRunning}
            onClick={() => onInject(f.cls)}
            className="font-mono text-[11px]"
          >
            {f.label}
          </Button>
        ))}

        <Button
          size="sm"
          variant="outline"
          disabled={faultActive || demoRunning}
          onClick={onInjectTransient}
          className="font-mono text-[11px] text-muted-foreground"
          title="Benign glitch: low-confidence anomaly the Copilot escalates instead of advising"
        >
          Inject Transient
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        {/* Pass + Air-gap */}
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

        {/* Demo controls */}
        <Button
          size="sm"
          variant="outline"
          onClick={onRunDemo}
          className="font-mono text-[11px]"
          style={{ borderColor: "var(--primary)", color: "var(--primary)" }}
          title="Runs the full scripted demo sequence automatically"
        >
          <Clapperboard className="size-3.5" />
          Run Demo
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={onReset}
          className="font-mono text-[11px]"
          title="Reset engine to nominal state"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </Button>

        <div className="mx-1 h-5 w-px bg-border" />

        {/* Export */}
        <Button
          size="sm"
          variant="ghost"
          onClick={onExportJSON}
          className="font-mono text-[11px]"
          title="Download the session as JSON"
        >
          <FileJson className="size-3.5" />
          Export JSON
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={onPrintReport}
          className="font-mono text-[11px]"
          title="Open a printable incident report (Save as PDF)"
        >
          <Printer className="size-3.5" />
          Report
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

      {/* Demo sequence progress strip */}
      {demoStep && (
        <div className="flex items-center gap-2 rounded border border-primary/30 bg-primary/5 px-3 py-1.5">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          <span className="font-mono text-[11px] text-primary">Demo sequence running</span>
          <span className="font-mono text-[11px] text-muted-foreground">— {demoStep}</span>
        </div>
      )}
    </div>
  )
}
