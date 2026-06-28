"use client"

import { useId } from "react"

interface SparklineProps {
  data: number[]
  /** Fixed y-axis max; if omitted, autoscale to data max. */
  max?: number
  color?: string
  height?: number
  /** Fraction (0..1) from the right that marks the predicted window. */
  predictedFrom?: number | null
  className?: string
}

export function Sparkline({
  data,
  max,
  color = "var(--primary)",
  height = 64,
  predictedFrom = null,
  className,
}: SparklineProps) {
  const gid = useId()
  const W = 300
  const H = height
  const pad = 4
  const n = data.length

  if (n < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none">
        <line x1={0} y1={H - pad} x2={W} y2={H - pad} stroke="var(--border)" strokeWidth={1} />
      </svg>
    )
  }

  const hi = max ?? Math.max(1, ...data) * 1.1
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2)
  const y = (v: number) => H - pad - (Math.min(v, hi) / hi) * (H - pad * 2)

  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const area = `${line} L${x(n - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`

  const predX = predictedFrom != null ? pad + predictedFrom * (W - pad * 2) : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {predX != null && (
        <rect
          x={predX}
          y={0}
          width={W - predX - pad}
          height={H}
          fill="var(--warn)"
          opacity={0.1}
        />
      )}
      <path d={area} fill={`url(#fill-${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
