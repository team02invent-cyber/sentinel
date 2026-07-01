"use client"

import { useSentinel } from "@/hooks/use-sentinel"
import { HeaderBar } from "@/components/sentinel/header-bar"
import { ControlDeck } from "@/components/sentinel/control-deck"
import { ResilienceBanner } from "@/components/sentinel/resilience-banner"
import { MetricsRibbon } from "@/components/sentinel/metrics-ribbon"
import { TopologyMap } from "@/components/sentinel/topology-map"
import { PredictionTimeline } from "@/components/sentinel/prediction-timeline"
import { CopilotPanel } from "@/components/sentinel/copilot-panel"
import { EventFeed } from "@/components/sentinel/event-feed"
import { AirgapPanel } from "@/components/sentinel/airgap-panel"
import { EvalPanel } from "@/components/sentinel/eval-panel"
import { SyslogFeed } from "@/components/sentinel/syslog-feed"
import { NetflowPanel } from "@/components/sentinel/netflow-panel"
import { ControllerPanel } from "@/components/sentinel/controller-panel"
import { ClassifierPanel } from "@/components/sentinel/classifier-panel"
import { HistoryPanel } from "@/components/sentinel/history-panel"
import { exportSessionJSON, printIncidentReport } from "@/lib/sentinel/export"

export default function Page() {
  const {
    snap,
    selected,
    setSelected,
    injectFault,
    injectTransient,
    remediate,
    togglePass,
    toggleAirGap,
    toggleRunning,
    reset,
    runDemo,
    demoStep,
    running,
    nodeSeries,
    linkSeries,
    answerQuery,
    answerQueryStream,
    history,
  } = useSentinel()

  const exportSnap = {
    event: snap.event,
    copilot: snap.copilot,
    metrics: snap.metrics,
    eventLog: snap.eventLog,
    controller: snap.controller,
    t: snap.t,
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <HeaderBar t={snap.t} airGapped={snap.airGapped} />

      <div className="flex flex-1 flex-col gap-3 p-3">
        {/* Control deck */}
        <ControlDeck
          passActive={snap.passActive}
          airGapped={snap.airGapped}
          running={running}
          faultActive={!!snap.event}
          demoStep={demoStep}
          onInject={injectFault}
          onInjectTransient={injectTransient}
          onTogglePass={togglePass}
          onToggleAirGap={toggleAirGap}
          onToggleRunning={toggleRunning}
          onReset={reset}
          onRunDemo={runDemo}
          onExportJSON={() => exportSessionJSON(exportSnap)}
          onPrintReport={() => printIncidentReport(exportSnap)}
        />

        {snap.airGapped && <ResilienceBanner running={running} />}

        {/* Metrics ribbon */}
        <MetricsRibbon metrics={snap.metrics} />

        {/* Row 1: topology + timeline | copilot + event log */}
        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
          {/* left + center */}
          <div className="flex flex-col gap-3 lg:col-span-2">
            <div className="min-h-[360px] flex-1">
              <TopologyMap
                frame={snap.frame}
                event={snap.event}
                selected={selected}
                passActive={snap.passActive}
                rerouted={!!snap.recovery?.rerouted}
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
            <div className="min-h-[480px] flex-1">
              <CopilotPanel
                event={snap.event}
                copilot={snap.copilot}
                recovery={snap.recovery}
                airGapped={snap.airGapped}
                onRemediate={remediate}
                onQuery={answerQuery}
                onQueryStream={answerQueryStream}
              />
            </div>
            <div className="h-[200px]">
              <EventFeed log={snap.eventLog} />
            </div>
          </div>
        </div>

        {/* Row 2: SD-WAN controller | Syslog */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="min-h-[280px]">
            <ControllerPanel controller={snap.controller} />
          </div>
          <div className="min-h-[280px]">
            <SyslogFeed log={snap.syslogLog} />
          </div>
        </div>

        {/* Row 3: NetFlow IPFIX */}
        <div className="min-h-[220px]">
          <NetflowPanel flows={snap.flowLog} />
        </div>

        {/* Row 4: Classifier performance | Incident history */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="min-h-[320px]">
            <ClassifierPanel metrics={snap.metrics} />
          </div>
          <div className="min-h-[320px]">
            <HistoryPanel history={history} />
          </div>
        </div>

        {/* Row 5: Air-gap boundary | Evaluation methodology */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="min-h-[380px]">
            <AirgapPanel airGapped={snap.airGapped} running={running} />
          </div>
          <div className="min-h-[380px]">
            <EvalPanel />
          </div>
        </div>
      </div>
    </main>
  )
}
