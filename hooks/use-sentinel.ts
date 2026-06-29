"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { answerQuery, generateCopilotResponse } from "@/lib/sentinel/copilot"
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
  const demoCancelRef = useRef<(() => void) | null>(null)
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

  useEffect(() => {
    if (!running) return
    const engine = engineRef.current!
    const interval = setInterval(() => {
      const frame = engine.tick()
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
  }
}
