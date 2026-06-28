"use client"

import { useSentinel } from "@/hooks/use-sentinel"
import { HeaderBar } from "@/components/sentinel/header-bar"
import { ControlDeck } from "@/components/sentinel/control-deck"
import { MetricsRibbon } from "@/components/sentinel/metrics-ribbon"
import { TopologyMap } from "@/components/sentinel/topology-map"
import { PredictionTimeline } from "@/components/sentinel/prediction-timeline"
import { CopilotPanel } from "@/components/sentinel/copilot-panel"
import { EventFeed } from "@/components/sentinel/event-feed"

export default function Page() {
  const {
    snap,
    selected,
    setSelected,
    injectFault,
    remediate,
    togglePass,
    toggleAirGap,
    toggleRunning,
    running,
    nodeSeries,
    linkSeries,
  } = useSentinel()

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <HeaderBar t={snap.t} airGapped={snap.airGapped} />

      <div className="flex flex-1 flex-col gap-3 p-3">
        <ControlDeck
          passActive={snap.passActive}
          airGapped={snap.airGapped}
          running={running}
          faultActive={!!snap.event}
          onInject={injectFault}
          onTogglePass={togglePass}
          onToggleAirGap={toggleAirGap}
          onToggleRunning={toggleRunning}
        />

        <MetricsRibbon metrics={snap.metrics} />

        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
          {/* left + center: topology and timeline */}
          <div className="flex flex-col gap-3 lg:col-span-2">
            <div className="min-h-[360px] flex-1">
              <TopologyMap
                frame={snap.frame}
                event={snap.event}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
            <div className="h-[260px]">
              <PredictionTimeline
                frame={snap.frame}
                event={snap.event}
                selected={selected}
                nodeSeries={nodeSeries}
                linkSeries={linkSeries}
              />
            </div>
          </div>

          {/* right: copilot + event log */}
          <div className="flex flex-col gap-3">
            <div className="min-h-[420px] flex-1">
              <CopilotPanel
                event={snap.event}
                copilot={snap.copilot}
                airGapped={snap.airGapped}
                onRemediate={remediate}
              />
            </div>
            <div className="h-[200px]">
              <EventFeed log={snap.eventLog} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
