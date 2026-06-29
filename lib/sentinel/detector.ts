/**
 * SENTINEL — Statistical Anomaly Detector ("ML predicts" plane)
 * ============================================================
 * This is the real detection layer. It consumes ONLY the TelemetryFrame
 * stream — it has no knowledge of which fault (if any) was injected. From
 * the raw 1 Hz telemetry it maintains, per (element, metric):
 *
 *   - a robust EWMA baseline (mean + variance) that adapts during nominal
 *     operation but FREEZES when a sample is anomalous, so the baseline
 *     never chases a developing fault (the classic z-score collapse bug);
 *   - a smoothed trend/slope estimate (EWMA of first differences);
 *   - a breach streak counter for debouncing against single-sample noise.
 *
 * Per tick it scores each known fault signature, picks the dominant class,
 * and emits a verdict whose CONFIDENCE is computed from (a) how far the
 * signals sit above baseline, (b) the MARGIN between the top class and the
 * runner-up, and (c) trend consistency. Ambiguous, low-margin anomalies
 * (e.g. a benign transient that smudges several unrelated metrics) yield
 * low confidence -> the Copilot escalates instead of advising.
 *
 * Nothing here is hardcoded to a ramp fraction: lead time, confidence and
 * classification are all emergent from the observed signal. Production
 * swaps this class for a TCN/LSTM scorer emitting the same Verdict.
 */

import type { EvidenceRow, FaultClass, TelemetryFrame } from "./schema"

/* ------------------------------------------------------------------ *
 * Signal catalogue — the observable evidence for each fault signature.
 * The detector watches these metrics on EVERY element; it does not know
 * in advance which element will fault.
 * ------------------------------------------------------------------ */

type ElementKind = "node" | "link"

interface SignalSpec {
  metric: string
  kind: ElementKind
  faultClass: FaultClass
  /** Anomalous direction. */
  direction: "rising" | "falling"
  /** Contribution weight to the class score. */
  weight: number
  /** Human label + unit formatter for evidence rows. */
  label: string
  unit: string
}

const SIGNALS: SignalSpec[] = [
  // LDP / label-churn instability
  { metric: "labelChurnPerS", kind: "node", faultClass: "ldp_instability", direction: "rising", weight: 1.0, label: "Label churn", unit: "/s" },
  { metric: "jitterMs", kind: "node", faultClass: "ldp_instability", direction: "rising", weight: 0.6, label: "Session jitter", unit: "ms" },
  { metric: "cpuPct", kind: "node", faultClass: "ldp_instability", direction: "rising", weight: 0.4, label: "Control-plane CPU", unit: "%" },
  // Congestion / queue buildup
  { metric: "queueDepthPct", kind: "node", faultClass: "congestion", direction: "rising", weight: 1.0, label: "Egress queue depth", unit: "%" },
  { metric: "ifDiscardsPerS", kind: "node", faultClass: "congestion", direction: "rising", weight: 0.8, label: "Tail-drop discards", unit: "/s" },
  // Link flap / fiber degradation
  { metric: "errorRatePct", kind: "link", faultClass: "link_flap", direction: "rising", weight: 1.0, label: "Link error rate", unit: "%/s" },
]

const FAULT_CLASSES: FaultClass[] = ["link_flap", "ldp_instability", "congestion"]

/* ------------------------------------------------------------------ *
 * Tunables (calibrated for the 1 Hz sim; documented, not magic).
 * ------------------------------------------------------------------ */

const WARMUP_TICKS = 12 // learn baselines before any detection can fire
const BASE_ALPHA = 0.05 // EWMA rate for baseline mean/variance (slow)
const TREND_ALPHA = 0.3 // EWMA rate for the first-difference (slope)
const FREEZE_Z = 3.0 // |z| above this freezes baseline adaptation
const MIN_STD = 1e-3 // variance floor so quiet signals don't divide by ~0
const Z_ENTER = 3.0 // directed-z above this marks a signal as breaching
const Z_REF = 6.0 // directed-z at which a signal's anomaly saturates to 1.0
const SCORE_ENTER = 0.55 // class score (bounded units) to ENTER firing
const SCORE_EXIT = 0.3 // class score to LEAVE firing (hysteresis)
const MIN_STREAK = 3 // consecutive breaching ticks to debounce noise
const GROUNDING_FLOOR = 0.55 // confidence below this -> escalate (mirrors copilot)

function logistic(x: number) {
  return 1 / (1 + Math.exp(-x))
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Running robust-EWMA baseline for one (element, metric) signal. */
interface Baseline {
  mean: number
  variance: number
  slope: number // smoothed first difference (units/s)
  last: number | null
  samples: number
}

function freshBaseline(): Baseline {
  return { mean: 0, variance: 1, slope: 0, last: null, samples: 0 }
}

/** A single scored signal at the current tick. */
export interface ScoredSignal {
  key: string
  element: string
  elementKind: ElementKind
  metric: string
  faultClass: FaultClass
  value: number
  z: number // directed z-score (positive == anomalous direction)
  slope: number // smoothed units/sec
  label: string
  unit: string
}

/** The detector's per-tick output — the honest PredictionEvent inputs. */
export interface DetectorVerdict {
  firing: boolean
  element: string
  elementKind: ElementKind
  faultClass: FaultClass
  /** Computed from signal strength AND class margin AND trend. */
  confidence: number
  /** Softmax over the three class scores. */
  probabilities: Record<FaultClass, number>
  /** True when an anomaly is present but too ambiguous to ground. */
  ambiguous: boolean
  /** Top contributing signals for the winning element (for the UI/Copilot). */
  topSignals: ScoredSignal[]
  /** Evidence rows grounded in real z-scores. */
  evidence: EvidenceRow[]
  /** Aggregate score of the winning class (for diagnostics). */
  score: number
  margin: number
}

export class Detector {
  private base: Record<string, Baseline> = {}
  private ticks = 0
  private firing = false
  private breachStreak = 0
  private firingClass: FaultClass | null = null

  private key(element: string, metric: string) {
    return `${element}.${metric}`
  }

  /** Update one signal's robust EWMA baseline and return its directed z + slope. */
  private updateSignal(element: string, spec: SignalSpec, value: number): { z: number; slope: number } {
    const k = this.key(element, spec.metric)
    const b = (this.base[k] ??= freshBaseline())

    // Trend: EWMA of first differences.
    if (b.last !== null) {
      const d = value - b.last
      b.slope = TREND_ALPHA * d + (1 - TREND_ALPHA) * b.slope
    }
    b.last = value

    const std = Math.sqrt(Math.max(b.variance, MIN_STD))
    const rawZ = (value - b.mean) / std
    const directedZ = spec.direction === "rising" ? rawZ : -rawZ

    // Robust adaptation: only fold a sample into the baseline if it is NOT
    // strongly anomalous. This stops the baseline from chasing a fault ramp.
    const adapt = b.samples < WARMUP_TICKS || Math.abs(rawZ) < FREEZE_Z
    if (adapt) {
      const diff = value - b.mean
      b.mean += BASE_ALPHA * diff
      b.variance = (1 - BASE_ALPHA) * (b.variance + BASE_ALPHA * diff * diff)
    }
    b.samples += 1

    return { z: directedZ, slope: b.slope }
  }

  /**
   * Ingest one telemetry frame and produce a verdict. Pure function of the
   * telemetry stream — it never sees the injected fault.
   */
  update(frame: TelemetryFrame): DetectorVerdict {
    this.ticks += 1

    // 1. Score every signal on every element against its baseline.
    const scored: ScoredSignal[] = []
    for (const spec of SIGNALS) {
      const bag = spec.kind === "node" ? frame.nodes : frame.links
      for (const element of Object.keys(bag)) {
        const value = (bag[element] as Record<string, number>)[spec.metric]
        if (typeof value !== "number") continue
        const { z, slope } = this.updateSignal(element, spec, value)
        scored.push({
          key: this.key(element, spec.metric),
          element,
          elementKind: spec.kind,
          metric: spec.metric,
          faultClass: spec.faultClass,
          value,
          z,
          slope,
          label: spec.label,
          unit: spec.unit,
        })
      }
    }

    const idle = this.idleVerdict()
    if (this.ticks <= WARMUP_TICKS) return idle

    // 2. Aggregate a score per (element, faultClass). Each signal's anomaly is
    //    SATURATED to [0,1] (directedZ/Z_REF) so one near-zero-baseline metric
    //    with a huge z cannot dominate — class scores stay in a bounded space
    //    where the margin between classes is meaningful.
    const specByMetric = new Map(SIGNALS.map((s) => [s.metric, s]))
    const byClassElement = new Map<string, { element: string; kind: ElementKind; cls: FaultClass; score: number; sigs: ScoredSignal[] }>()
    for (const s of scored) {
      const spec = specByMetric.get(s.metric)!
      const anomaly = clamp(s.z / Z_REF, 0, 1)
      const contribution = anomaly * spec.weight
      if (s.z < Z_ENTER) continue
      const key = `${s.faultClass}:${s.element}`
      const cur = byClassElement.get(key) ?? { element: s.element, kind: s.elementKind, cls: s.faultClass, score: 0, sigs: [] }
      cur.score += contribution
      cur.sigs.push(s)
      byClassElement.set(key, cur)
    }

    // 3. Best (element, class) per class, then global winner.
    const bestPerClass: Record<FaultClass, { element: string; kind: ElementKind; score: number; sigs: ScoredSignal[] }> = {
      link_flap: { element: "", kind: "link", score: 0, sigs: [] },
      ldp_instability: { element: "", kind: "node", score: 0, sigs: [] },
      congestion: { element: "", kind: "node", score: 0, sigs: [] },
    }
    for (const v of byClassElement.values()) {
      if (v.score > bestPerClass[v.cls].score) {
        bestPerClass[v.cls] = { element: v.element, kind: v.kind, score: v.score, sigs: v.sigs }
      }
    }

    const ranked = FAULT_CLASSES.map((c) => ({ cls: c, ...bestPerClass[c] })).sort((a, b) => b.score - a.score)
    const winner = ranked[0]
    const runnerUp = ranked[1]
    const score = winner.score
    const margin = winner.score - runnerUp.score

    // 4. Hysteresis + debounce on the winning class score.
    if (score >= SCORE_ENTER) this.breachStreak += 1
    else if (score < SCORE_EXIT) this.breachStreak = 0

    if (!this.firing && this.breachStreak >= MIN_STREAK) {
      this.firing = true
      this.firingClass = winner.cls
    } else if (this.firing && score < SCORE_EXIT) {
      this.firing = false
      this.firingClass = null
    }

    if (!this.firing || winner.score === 0) return idle

    // 5. Probabilities: softmax over the three class scores.
    const probabilities = this.softmax(ranked)

    // 6. Confidence = absolute strength x class margin x trend consistency.
    //    Each factor in [0,1]; a weak MARGIN (an ambiguous anomaly that fits
    //    two signatures equally, e.g. a benign transient) caps confidence
    //    below the grounding floor regardless of how strong the signal is.
    const breaching = winner.sigs.filter((s) => s.z >= Z_ENTER)
    const meanAnomaly = breaching.length
      ? breaching.reduce((a, s) => a + clamp(s.z / Z_REF, 0, 1), 0) / breaching.length
      : 0
    const strength = logistic(6 * (meanAnomaly - 0.6)) // ~0.5 at anomaly 0.6
    const marginFactor = logistic(7 * (margin - 0.35)) // ~0 when classes tie
    const risingShare = breaching.length ? breaching.filter((s) => s.slope > 0).length / breaching.length : 0
    const trendFactor = 0.6 + 0.4 * risingShare
    const confidence = clamp(strength * marginFactor * trendFactor, 0, 0.99)

    const ambiguous = confidence < GROUNDING_FLOOR

    const topSignals = [...winner.sigs].sort((a, b) => b.z - a.z).slice(0, 3)
    const evidence = this.buildEvidence(topSignals)

    return {
      firing: true,
      element: winner.element,
      elementKind: winner.kind,
      faultClass: winner.cls,
      confidence,
      probabilities,
      ambiguous,
      topSignals,
      evidence,
      score,
      margin,
    }
  }

  private softmax(ranked: { cls: FaultClass; score: number }[]): Record<FaultClass, number> {
    const T = 2.2 // temperature: keeps probabilities readable
    const exps = ranked.map((r) => ({ cls: r.cls, e: Math.exp(r.score / T) }))
    const sum = exps.reduce((a, x) => a + x.e, 0) || 1
    const out: Record<FaultClass, number> = { link_flap: 0, ldp_instability: 0, congestion: 0 }
    for (const x of exps) out[x.cls] = +(x.e / sum).toFixed(3)
    return out
  }

  private buildEvidence(sigs: ScoredSignal[]): EvidenceRow[] {
    return sigs.map((s) => ({
      label: s.label,
      value: `${formatVal(s.value, s.unit)} · z=${s.z.toFixed(1)}`,
      trend: s.slope > 0.05 ? "rising" : s.slope < -0.05 ? "falling" : "flat",
    }))
  }

  private idleVerdict(): DetectorVerdict {
    return {
      firing: false,
      element: "",
      elementKind: "node",
      faultClass: "ldp_instability",
      confidence: 0,
      probabilities: { link_flap: 0, ldp_instability: 0, congestion: 0 },
      ambiguous: false,
      topSignals: [],
      evidence: [],
      score: 0,
      margin: 0,
    }
  }
}

function formatVal(v: number, unit: string): string {
  const n = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
  return `${n} ${unit}`.trim()
}
