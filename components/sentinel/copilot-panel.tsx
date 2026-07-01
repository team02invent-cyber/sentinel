"use client"

import { useRef, useState } from "react"
import {
  ShieldCheck,
  Terminal,
  TriangleAlert,
  WifiOff,
  FileText,
  Zap,
  Route,
  CheckCircle2,
  Cpu,
  Send,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { corpusTitle } from "@/lib/sentinel/copilot"
import { FAULT_LABELS } from "@/lib/sentinel/schema"
import { PROTECT_LSP_PATH } from "@/lib/sentinel/topology"
import type { CopilotResponse, PredictionEvent } from "@/lib/sentinel/schema"
import type { RecoveryState } from "@/lib/sentinel/simulator"

interface Props {
  event: PredictionEvent | null
  copilot: CopilotResponse | null
  recovery: RecoveryState | null
  airGapped: boolean
  onRemediate: () => void
  onQuery: (q: string) => Promise<CopilotResponse>
}

export function CopilotPanel({ event, copilot, recovery, airGapped, onRemediate, onQuery }: Props) {
  const active = event && copilot && (event.phase === "degrading" || event.phase === "imminent")
  const [query, setQuery] = useState("")
  const [queryResult, setQueryResult] = useState<CopilotResponse | null>(null)
  const [querying, setQuerying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleQuery() {
    const q = query.trim()
    if (!q) return
    setQuerying(true)
    setQueryResult(null)
    try {
      const result = await onQuery(q)
      setQueryResult(result)
    } finally {
      setQuerying(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Don't submit while a CJK IME is composing (Safari reports keyCode 229)
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) handleQuery()
  }

  // If there is an active event, show event response. If query result exists and no active event, show query result.
  const displayResponse = event ? copilot : queryResult

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-primary" />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
            Sentinel Copilot
          </span>
        </div>
        <div className="flex items-center gap-3">
          {copilot?.fromLLM && (
            <div className="flex items-center gap-1 font-mono text-[10px] text-[color:var(--ok)]">
              <Cpu className="size-3" />
              <span>Mistral · {copilot.inferenceMs?.toFixed(0)}ms</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest">
            <WifiOff className="size-3 text-[color:var(--ok)]" />
            <span className="text-[color:var(--ok)]">Offline · on-prem LLM</span>
          </div>
        </div>
      </div>

      {/* architectural law strip */}
      <div className="border-b border-border bg-secondary/40 px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
        ML predicts · LLM explains · every claim cited
      </div>

      {/* free-text NOC query bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Input
          ref={inputRef}
          className="h-7 flex-1 font-mono text-[11px] placeholder:text-muted-foreground/50"
          placeholder="Ask a question about this network (e.g. 'how do I dampen BGP flaps?')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={querying}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={handleQuery}
          disabled={querying || !query.trim()}
          title="Ask the Copilot"
        >
          {querying ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {recovery ? (
          <RecoverySuccess recovery={recovery} />
        ) : !displayResponse ? (
          <IdleState airGapped={airGapped} />
        ) : queryResult && !event ? (
          <QueryAnswer result={queryResult} />
        ) : active && copilot?.grounded ? (
          <GroundedAdvice event={event} copilot={copilot} />
        ) : displayResponse && !displayResponse.grounded ? (
          <EscalationState copilot={displayResponse} />
        ) : (
          <IdleState airGapped={airGapped} />
        )}
      </div>

      {/* action */}
      <div className="border-t border-border p-3">
        <Button
          className="w-full font-mono text-xs uppercase tracking-widest"
          disabled={!active || !copilot?.grounded || !!recovery}
          onClick={onRemediate}
          style={{
            background: active && !recovery ? "var(--ok)" : undefined,
            color: active && !recovery ? "var(--ok-foreground)" : undefined,
          }}
        >
          <Terminal className="size-4" />
          {recovery ? "Remediation Applied" : "Apply Remediation"}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sub-views                                                           */
/* ------------------------------------------------------------------ */

function IdleState({ airGapped }: { airGapped: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <ShieldCheck className="size-8 text-[color:var(--ok)]" />
      <p className="font-mono text-xs text-muted-foreground">
        No active prediction. Copilot is idle. Use the query bar above to ask
        any question about the network, runbooks, or past incidents.
      </p>
      {airGapped && (
        <p className="font-mono text-[10px] text-[color:var(--ok)]">
          Network link disabled — still fully operational.
        </p>
      )}
    </div>
  )
}

function QueryAnswer({ result }: { result: CopilotResponse }) {
  return (
    <div className="flex flex-col gap-4">
      {result.answeredQuery && (
        <div className="rounded border border-primary/20 bg-primary/5 px-3 py-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-primary">Query</span>
          <p className="mt-1 font-mono text-xs text-foreground">{result.answeredQuery}</p>
        </div>
      )}
      {result.fromLLM && (
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-[color:var(--ok)]">
          <Cpu className="size-3" />
          LLM response · {result.inferenceMs?.toFixed(0)}ms
        </div>
      )}
      <Section title="Answer" body={result.summary.text} source={result.summary.source} />
      {result.rootCause.text && result.rootCause.text !== result.summary.text && (
        <Section title="Context" body={result.rootCause.text} source={result.rootCause.source} />
      )}
      {!result.grounded && result.escalation && (
        <div className="rounded border border-[color:var(--warn)]/30 bg-[color:var(--warn)]/5 px-3 py-2 font-mono text-[11px] text-[color:var(--warn)]">
          {result.escalation}
        </div>
      )}
    </div>
  )
}

function RecoverySuccess({ recovery }: { recovery: RecoveryState }) {
  const prevented = recovery.prevented
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex items-center gap-2"
        style={{ color: prevented ? "var(--ok)" : "var(--info)" }}
      >
        <CheckCircle2 className="size-5" />
        <span className="font-mono text-xs font-semibold uppercase tracking-widest">
          {prevented ? "Failure averted" : "Service restored"}
        </span>
      </div>

      <p className="font-mono text-xs leading-relaxed text-foreground">
        {prevented
          ? `Remediation landed before impact on ${recovery.element}. No pass telemetry was lost.`
          : `${recovery.element} took impact; the protect path absorbed traffic and the element is recovering.`}
      </p>

      {recovery.rerouted && (
        <div className="rounded border border-border bg-secondary/30 px-2.5 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-primary">
            <Route className="size-3.5" />
            Pass LSP rerouted
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {PROTECT_LSP_PATH.join(" \u2192 ")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border">
        <div className="flex flex-col gap-0.5 bg-card px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Loss prevented
          </span>
          <span
            className="font-mono text-lg font-semibold tabular-nums"
            style={{ color: "var(--ok)" }}
          >
            {formatPkts(recovery.packetsPrevented)}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">packets</span>
        </div>
        <div className="flex flex-col gap-0.5 bg-card px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Lead time
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
            {recovery.leadTimeS.toFixed(0)}s
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">before impact</span>
        </div>
      </div>

      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Element is taper-healing to nominal. The Copilot will return to idle when
        recovery completes.
      </p>
    </div>
  )
}

function formatPkts(n: number): string {
  if (n === 0) return "0"
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

function EscalationState({ copilot }: { copilot: CopilotResponse }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[color:var(--warn)]">
        <TriangleAlert className="size-4" />
        <span className="font-mono text-xs font-semibold uppercase tracking-widest">
          Insufficient grounding
        </span>
      </div>
      <p className="font-mono text-xs leading-relaxed text-muted-foreground">{copilot.escalation}</p>
    </div>
  )
}

function GroundedAdvice({
  event,
  copilot,
}: {
  event: PredictionEvent
  copilot: CopilotResponse
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* fault chip */}
      <div className="flex items-center justify-between">
        <span
          className="rounded-md px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest"
          style={{ background: "var(--warn)", color: "var(--warn-foreground)" }}
        >
          {FAULT_LABELS[event.faultClass]}
        </span>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-[10px] text-muted-foreground">
            conf {(event.confidence * 100).toFixed(0)}% · {event.modelVersion}
          </span>
          {copilot.fromLLM && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-[color:var(--ok)]">
              <Cpu className="size-3" />
              Mistral {copilot.inferenceMs?.toFixed(0)}ms
            </span>
          )}
        </div>
      </div>

      <Section title="What" body={copilot.summary.text} source={copilot.summary.source} />
      <Section title="Why" body={copilot.rootCause.text} source={copilot.rootCause.source} />

      {/* evidence */}
      <div>
        <SectionLabel>Evidence (summarized, not raw)</SectionLabel>
        <div className="mt-1.5 grid grid-cols-1 gap-1">
          {event.evidence.map((e) => (
            <div
              key={e.label}
              className="flex items-center justify-between rounded border border-border bg-secondary/30 px-2 py-1 font-mono text-[11px]"
            >
              <span className="text-muted-foreground">{e.label}</span>
              <span className="flex items-center gap-1.5 text-foreground">
                {e.value}
                {e.trend === "rising" && <span className="text-[color:var(--crit)]">&#9650;</span>}
                {e.trend === "falling" && <span className="text-[color:var(--warn)]">&#9660;</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* BGP cascade if present */}
      {event.cascadeNodes && event.cascadeNodes.length > 0 && (
        <div>
          <SectionLabel>BGP cascade — affected nodes</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {event.cascadeNodes.map((n) => (
              <span
                key={n}
                className="rounded border border-[color:var(--crit)]/30 bg-[color:var(--crit)]/5 px-2 py-0.5 font-mono text-[10px] text-[color:var(--crit)]"
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* fix */}
      <div>
        <SectionLabel>Fix — exact commands</SectionLabel>
        <div className="mt-1.5 flex flex-col gap-2">
          {copilot.remediation.map((r, i) => (
            <div key={i} className="rounded border border-border bg-background">
              <p className="px-2.5 pt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {r.description}
              </p>
              <pre className="mt-1.5 overflow-x-auto border-t border-border px-2.5 py-2 font-mono text-[11px] text-[color:var(--ok)]">
                {r.command}
              </pre>
              <Citation source={r.source} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  body,
  source,
}: {
  title: string
  body: string
  source: string
}) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <p className="mt-1 font-mono text-xs leading-relaxed text-foreground">{body}</p>
      <Citation source={source} />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-primary">
      {children}
    </span>
  )
}

function Citation({ source }: { source: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
      <FileText className="size-3 shrink-0" />
      <span className="truncate">
        <span className="text-primary">{source}</span> · {corpusTitle(source)}
      </span>
    </div>
  )
}
