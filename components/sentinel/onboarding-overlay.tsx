"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Play, SkipForward, Volume2, ShieldCheck } from "lucide-react"

interface Line {
  line: string
  start: number
  end: number
}
interface Narration {
  duration: number
  lines: Line[]
}

// Fallback copy (matches the generated narration) so the pitch always renders,
// even if the audio asset fails to load.
const FALLBACK_LINES: Line[] = [
  { line: "Every year, network outages cost enterprises billions.", start: 0, end: 3.6 },
  { line: "And most are caught only after users are already impacted.", start: 3.6, end: 7.4 },
  { line: "Sentinel changes that.", start: 7.4, end: 9.2 },
  { line: "It watches your MPLS and SD-WAN fabric in real time, learning what normal looks like.", start: 9.2, end: 15 },
  { line: "Then it predicts failures up to a minute before they cascade.", start: 15, end: 19 },
  { line: "When trouble emerges, its air-gapped AI copilot explains the root cause,", start: 19, end: 23.5 },
  { line: "and hands your engineers a remediation playbook.", start: 23.5, end: 27 },
  { line: "All running fully offline, inside your secure perimeter.", start: 27, end: 31 },
  { line: "This is network operations that can finally see the future.", start: 31, end: 35 },
]

export function OnboardingOverlay({ onComplete }: { onComplete: () => void }) {
  const [lines, setLines] = useState<Line[]>(FALLBACK_LINES)
  const [hasAudio, setHasAudio] = useState(false)
  const [started, setStarted] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [leaving, setLeaving] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | null>(null)

  // Load the offline narration timings (generated once, committed to /public).
  useEffect(() => {
    let cancelled = false
    fetch("/onboarding/narration.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Narration | null) => {
        if (cancelled || !data?.lines?.length) return
        setLines(data.lines)
        setHasAudio(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const finish = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const a = audioRef.current
    if (a) {
      a.pause()
    }
    setLeaving(true)
    window.setTimeout(onComplete, 650)
  }, [onComplete])

  // Karaoke sync loop: highlight the line whose [start,end) contains currentTime.
  const syncLoop = useCallback(() => {
    const a = audioRef.current
    const t = a ? a.currentTime : 0
    let idx = lines.findIndex((l) => t >= l.start && t < l.end)
    if (idx === -1 && t > 0) {
      // Between lines — keep the most recently started line active.
      for (let i = lines.length - 1; i >= 0; i--) {
        if (t >= lines[i].start) {
          idx = i
          break
        }
      }
    }
    setActiveIdx(idx)
    rafRef.current = requestAnimationFrame(syncLoop)
  }, [lines])

  function begin() {
    setStarted(true)
    setActiveIdx(0)
    const a = audioRef.current
    if (a && hasAudio) {
      a.currentTime = 0
      a.play().catch(() => {})
      rafRef.current = requestAnimationFrame(syncLoop)
    } else {
      // No audio: reveal lines on a timer, then finish.
      let i = 0
      const total = lines.length
      const step = () => {
        setActiveIdx(i)
        i++
        if (i < total) {
          window.setTimeout(step, 3200)
        } else {
          window.setTimeout(finish, 3200)
        }
      }
      step()
    }
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-6 transition-opacity duration-700 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Darkening scrim so captions stay readable over the shader */}
      <div className="absolute inset-0 bg-background/55 backdrop-blur-sm" />

      {hasAudio && (
        <audio ref={audioRef} src="/onboarding/narration.mp3" preload="auto" onEnded={finish} />
      )}

      <div className="glass-panel relative z-10 flex w-full max-w-3xl flex-col items-center gap-8 rounded-2xl px-8 py-12 text-center sm:px-14">
        {/* Wordmark */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
              <ShieldCheck className="size-5 text-primary" />
            </span>
            <span className="font-mono text-xl font-semibold tracking-[0.3em] text-foreground">SENTINEL</span>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.35em] text-primary/80">
            Predictive Network Operations
          </span>
        </div>

        {!started ? (
          <>
            <p className="max-w-xl text-balance text-sm leading-relaxed text-muted-foreground">
              A sixty-second briefing on what Sentinel does and why it matters. Audio plays once,
              fully offline.
            </p>
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={begin}
                className="group flex items-center gap-2.5 rounded-full bg-primary px-7 py-3 font-mono text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-[1.03]"
              >
                <Play className="size-4 fill-current" />
                Begin briefing
              </button>
              <button
                onClick={finish}
                className="font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                Skip intro
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Karaoke captions */}
            <div className="flex min-h-[220px] flex-col justify-center gap-3">
              {lines.map((l, i) => {
                const isActive = i === activeIdx
                const isPast = i < activeIdx
                return (
                  <p
                    key={i}
                    className={`text-balance font-sans text-lg leading-relaxed transition-all duration-500 sm:text-xl ${
                      isActive
                        ? "scale-100 font-medium text-primary opacity-100"
                        : isPast
                          ? "scale-[0.98] text-foreground/35 opacity-60"
                          : "scale-[0.98] text-muted-foreground/25 opacity-40"
                    }`}
                  >
                    {l.line}
                  </p>
                )
              })}
            </div>

            <div className="flex items-center gap-3 text-muted-foreground">
              <Volume2 className="size-4 animate-pulse text-primary" />
              <button
                onClick={finish}
                className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest transition-colors hover:text-foreground"
              >
                <SkipForward className="size-3.5" />
                Skip to dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
