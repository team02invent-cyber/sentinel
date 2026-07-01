/**
 * SENTINEL — Local incident history (air-gapped persistence)
 * ==========================================================
 * Persisted to localStorage ONLY — no network egress — so it is consistent
 * with the zero-egress air-gap requirement. Past incidents survive reloads
 * and are fed back into the RAG corpus as "past incident" documents,
 * closing the operational-learning loop described in the spec.
 */

const STORAGE_KEY = "sentinel.incident.history.v1"
const MAX_HISTORY = 50

export interface PersistedIncident {
  id: string
  faultClass: string
  element: string
  outcome: string
  leadTimeS: number
  confidence: number
  ts: number
}

export function loadHistory(): PersistedIncident[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PersistedIncident[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveHistory(items: PersistedIncident[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)))
  } catch {
    /* quota or serialization error — non-fatal */
  }
}

/** Add an incident if its id is not already recorded. Returns the new list. */
export function appendIncident(item: PersistedIncident): PersistedIncident[] {
  const current = loadHistory()
  if (current.some((i) => i.id === item.id)) return current
  const next = [item, ...current].slice(0, MAX_HISTORY)
  saveHistory(next)
  return next
}

export function clearHistory(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* non-fatal */
  }
}
