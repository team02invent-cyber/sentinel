"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  answerQuery as _answerQuery,
  answerQueryStream as _answerQueryStream,
  generateCopilotResponse,
  incidentToCorpusEntry,
  registerPastIncident,
  type LiveNetworkState,
} from "@/lib/sentinel/copilot"
import {
  appendIncident,
  loadHistory,
  type PersistedIncident,
} from "@/lib/sentinel/history"
import { SentinelEngine, type RecoveryState } from "@/lib/sentinel/simulator"
import type {
  ControllerState,
  CopilotResponse,
  FaultClass,
  NetFlowRecord,
  PredictionEvent,
  SessionMetrics,
  SyslogEvent,
  TelemetryFrame,
} from "@/lib/sentinel/schema"

/** 1 sim-second per this many ms (time acceleration for the demo). */
const TICK_MS = 200

export interface SentinelSnapshot {
  frame: TelemetryFrame | null
  event: PredictionEvent | null
  copilot: CopilotResponse | null
  metrics: SessionMetrics
  eventLog: PredictionEvent[]
  recovery: RecoveryState | null
  passActive: boolean
  airGapped: boolean
  running: boolean
  t: number
  flowLog: NetFlowRecord[]
  syslogLog: SyslogEvent[]
  controller: ControllerState | null
}

export function useSentinel() {
  const engineRef = useRef<SentinelEngine | null>(null)
  if (engineRef.current === null) engineRef.current = new SentinelEngine()

  const [running, setRunning] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [demoStep, setDemoStep] = useState<string | null>(null)
  const [history, setHistory] = useState<PersistedIncident[]>([])
  const demoCancelRef = useRef<(() => void) | null>(null)
  /** ids of resolved incidents already persisted this session */
  const persistedIdsRef = useRef<Set<string>>(new Set())
  const [snap, setSnap] = useState<SentinelSnapshot>({
    frame: null,
    event: null,
    copilot: null,
    metrics: engineRef.current.metrics,
    eventLog: [],
    recovery: null,
    passActive: false,
    airGapped: false,
    running: true,
    t: 0,
    flowLog: [],
    syslogLog: [],
    controller: null,
  })

  // Cache the copilot response per event id so it isn't regenerated each tick.
  const copilotCache = useRef<{ id: string; resp: CopilotResponse } | null>(null)

  // On mount: warm up the LLM (eliminates cold-start lag) and load past
  // incidents from local storage back into the RAG corpus.
  useEffect(() => {
    // Fire-and-forget model warm-up
    fetch("/api/copilot/warmup", { method: "POST" }).catch(() => {})

    const past = loadHistory()
    setHistory(past)
    for (const inc of past) {
      persistedIdsRef.current.add(inc.id)
      registerPastIncident(
        incidentToCorpusEntry({
          id: inc.id,
          faultClass: inc.faultClass,
          element: inc.element,
          outcome: inc.outcome,
          leadTimeS: inc.leadTimeS,
          ts: inc.ts,
        }),
      )
    }
  }, [])

  useEffect(() => {
    if (!running) return
    const engine = engineRef.current!
    const interval = setInterval(() => {
      const frame = engine.tick()

      // Persist any newly-resolved incidents to local history + RAG corpus.
      for (const ev of engine.eventLog) {
        if (!ev.outcome || persistedIdsRef.current.has(ev.id)) continue
        persistedIdsRef.current.add(ev.id)
        const inc: PersistedIncident = {
          id: ev.id,
          faultClass: ev.faultClass,
          element: ev.element,
          outcome: ev.outcome,
          leadTimeS: ev.leadTimeS,
          confidence: ev.confidence,
          ts: ev.remediatedAt ?? ev.createdAt,
        }
        const next = appendIncident(inc)
        setHistory(next)
        registerPastIncident(incidentToCorpusEntry(inc))
      }

      let copilot: CopilotResponse | null = null
      if (engine.event) {
        if (copilotCache.current?.id !== engine.event.id) {
          // Generate async — fire and forget; the cache will fill on the next tick
          const eventId = engine.event.id
          const eventSnapshot = { ...engine.event }
          generateCopilotResponse({
            schemaVersion: "2.0",
            event: eventSnapshot,
          }).then((resp) => {
            // Only store if still the same event
            if (copilotCache.current?.id !== eventId) {
              copilotCache.current = { id: eventId, resp }
            }
          }).catch(() => {/* handled inside generateCopilotResponse */})
        }
        copilot = copilotCache.current?.resp ?? null
      } else {
        copilotCache.current = null
      }

      setSnap({
        frame,
        event: engine.event,
        copilot,
        metrics: { ...engine.metrics },
        eventLog: [...engine.eventLog],
        recovery: engine.recovery ? { ...engine.recovery } : null,
        passActive: engine.passActive,
        airGapped: engine.airGapped,
        running: true,
        t: engine.t,
        flowLog: [...engine.flowLog],
        syslogLog: [...engine.syslogLog],
        controller: { ...engine.controllerState },
      })
    }, TICK_MS)
    return () => clearInterval(interval)
  }, [running])

  const injectFault = useCallback((cls: FaultClass) => {
    engineRef.current!.injectFault(cls)
  }, [])
  const injectTransient = useCallback(() => {
    engineRef.current!.injectTransient()
  }, [])
  const remediate = useCallback(() => {
    engineRef.current!.remediate()
  }, [])
  const togglePass = useCallback(() => {
    const e = engineRef.current!
    e.setPass(!e.passActive)
  }, [])
  const toggleAirGap = useCallback(() => {
    const e = engineRef.current!
    e.setAirGapped(!e.airGapped)
  }, [])
  const toggleRunning = useCallback(() => setRunning((r) => !r), [])

  const reset = useCallback(() => {
    demoCancelRef.current?.()
    demoCancelRef.current = null
    setDemoStep(null)
    copilotCache.current = null
    engineRef.current!.reset()
  }, [])

  const runDemo = useCallback(() => {
    demoCancelRef.current?.()
    copilotCache.current = null
    engineRef.current!.reset()
    setRunning(true)
    const cancel = engineRef.current!.runDemoScript((step) => setDemoStep(step))
    demoCancelRef.current = cancel
  }, [])

  const nodeSeries = useCallback(
    (id: string, key: Parameters<SentinelEngine["nodeSeries"]>[1]) =>
      engineRef.current!.nodeSeries(id, key),
    [],
  )
  const linkSeries = useCallback(
    (id: string, key: Parameters<SentinelEngine["linkSeries"]>[1]) =>
      engineRef.current!.linkSeries(id, key),
    [],
  )

  /** Build the current live-network snapshot for grounding copilot queries. */
  const buildLiveState = useCallback((): LiveNetworkState => {
    const engine = engineRef.current!
    const frame = engine.lastFrame
    return {
      activeEvent: engine.event
        ? {
            faultClass: engine.event.faultClass,
            element: engine.event.element,
            phase: engine.event.phase,
            confidence: engine.event.confidence,
          }
        : null,
      passBurstActive: engine.passActive,
      topNodes: Object.entries(frame?.nodes ?? {}).slice(0, 4).map(([id, m]) => ({
        id,
        cpuPct: m.cpuPct,
        queueDepthPct: m.queueDepthPct,
        ldpUp: m.ldpUp,
        ospfUp: m.ospfUp,
      })),
      controllerCompliance: engine.controllerState.policyCompliancePct,
      tunnelsUp: engine.controllerState.tunnelsUp,
      tunnelsTotal: engine.controllerState.tunnelsTotal,
    }
  }, [])

  /** answerQuery with live telemetry injected automatically (non-streaming). */
  const answerQuery = useCallback(
    (query: string) => _answerQuery(query, buildLiveState()),
    [buildLiveState],
  )

  /** Streaming answerQuery — onToken receives the growing answer text. */
  const answerQueryStream = useCallback(
    (query: string, onToken: (full: string) => void) =>
      _answerQueryStream(query, buildLiveState(), onToken),
    [buildLiveState],
  )

  return {
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
  }
}
