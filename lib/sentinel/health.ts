import type { PredictionEvent, TelemetryFrame } from "./schema"

export type Health = "ok" | "warn" | "crit" | "info"

export const HEALTH_COLOR: Record<Health, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  info: "var(--info)",
}

export const HEALTH_TEXT: Record<Health, string> = {
  ok: "text-[color:var(--ok)]",
  warn: "text-[color:var(--warn)]",
  crit: "text-[color:var(--crit)]",
  info: "text-[color:var(--info)]",
}

/** Map a prediction phase to a health signal. */
function phaseHealth(phase: PredictionEvent["phase"]): Health {
  switch (phase) {
    case "degrading":
      return "warn"
    case "imminent":
      return "warn"
    case "failed":
      return "crit"
    case "recovering":
      return "info"
    default:
      return "ok"
  }
}

export function nodeHealth(
  id: string,
  frame: TelemetryFrame | null,
  event: PredictionEvent | null,
): Health {
  if (event && event.elementKind === "node" && event.element === id) {
    return phaseHealth(event.phase)
  }
  const n = frame?.nodes[id]
  if (n && (n.lspUp === 0 || n.ldpUp === 0 || n.ifDiscardsPerS > 20)) return "crit"
  return "ok"
}

export function linkHealth(
  id: string,
  frame: TelemetryFrame | null,
  event: PredictionEvent | null,
): Health {
  if (event && event.elementKind === "link" && event.element === id) {
    return phaseHealth(event.phase)
  }
  const l = frame?.links[id]
  if (l && l.up === 0) return "crit"
  if (l && l.errorRatePct > 1) return "warn"
  return "ok"
}
