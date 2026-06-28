"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { generateCopilotResponse } from "@/lib/sentinel/copilot"
import { SentinelEngine } from "@/lib/sentinel/simulator"
import type {
  CopilotResponse,
  FaultClass,
  PredictionEvent,
  SessionMetrics,
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
  passActive: boolean
  airGapped: boolean
  running: boolean
  t: number
}

export function useSentinel() {
  const engineRef = useRef<SentinelEngine | null>(null)
  if (engineRef.current === null) engineRef.current = new SentinelEngine()

  const [running, setRunning] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [snap, setSnap] = useState<SentinelSnapshot>({
    frame: null,
    event: null,
    copilot: null,
    metrics: engineRef.current.metrics,
    eventLog: [],
    passActive: false,
    airGapped: false,
    running: true,
    t: 0,
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
          copilotCache.current = {
            id: engine.event.id,
            resp: generateCopilotResponse({
              schemaVersion: "1.0",
              event: engine.event,
            }),
          }
        }
        copilot = copilotCache.current.resp
      } else {
        copilotCache.current = null
      }

      setSnap({
        frame,
        event: engine.event,
        copilot,
        metrics: { ...engine.metrics },
        eventLog: [...engine.eventLog],
        passActive: engine.passActive,
        airGapped: engine.airGapped,
        running: true,
        t: engine.t,
      })
    }, TICK_MS)
    return () => clearInterval(interval)
  }, [running])

  const injectFault = useCallback((cls: FaultClass) => {
    engineRef.current!.injectFault(cls)
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
    remediate,
    togglePass,
    toggleAirGap,
    toggleRunning,
    running,
    nodeSeries,
    linkSeries,
  }
}
