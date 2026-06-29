"use client"

import { LINKS, NODES, NODE_BY_ID, LINK_BY_ID, PRIMARY_LSP_PATH, PROTECT_LSP_PATH } from "@/lib/sentinel/topology"
import { HEALTH_COLOR, linkHealth, nodeHealth } from "@/lib/sentinel/health"
import type { PredictionEvent, TelemetryFrame } from "@/lib/sentinel/schema"

interface Props {
  frame: TelemetryFrame | null
  event: PredictionEvent | null
  selected: string | null
  passActive: boolean
  rerouted: boolean
  onSelect: (id: string) => void
}

/** Resolve the link record connecting two adjacent path nodes (either order). */
function pathLink(a: string, b: string) {
  return LINK_BY_ID[`${a}-${b}`] ?? LINK_BY_ID[`${b}-${a}`] ?? null
}

export function TopologyMap({ frame, event, selected, passActive, rerouted, onSelect }: Props) {
  const passPath = rerouted ? PROTECT_LSP_PATH : PRIMARY_LSP_PATH
  // Segments of the live pass LSP, drawn as a highlighted underlay.
  const passSegments = (passActive || rerouted)
    ? passPath
        .slice(0, -1)
        .map((id, i) => pathLink(id, passPath[i + 1]))
        .filter((l): l is NonNullable<typeof l> => !!l)
    : []

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-card">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className="text-foreground">MPLS Core Fabric</span>
        <span>· 7 nodes · 9 links</span>
        {rerouted && (
          <span className="rounded border border-[color:var(--info)] px-1.5 py-0.5 text-[color:var(--info)]">
            Pass on protect path
          </span>
        )}
      </div>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest">
        <Legend color="var(--ok)" label="Nominal" />
        <Legend color="var(--warn)" label="Predicted" />
        <Legend color="var(--crit)" label="Impact" />
        {(passActive || rerouted) && <Legend color="var(--primary)" label="Pass LSP" />}
      </div>

      <svg viewBox="0 0 1000 640" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        {/* faint grid */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="1000" height="640" fill="url(#grid)" />

        {/* live pass-LSP underlay (primary, or protect path during a reroute) */}
        {passSegments.map((l) => {
          const a = NODE_BY_ID[l.a]
          const b = NODE_BY_ID[l.b]
          return (
            <line
              key={`pass-${l.id}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={rerouted ? "var(--info)" : "var(--primary)"}
              strokeWidth={9}
              strokeOpacity={0.18}
              strokeLinecap="round"
              className={rerouted ? "animate-sentinel-pulse" : undefined}
            />
          )
        })}

        {/* links */}
        {LINKS.map((l) => {
          const a = NODE_BY_ID[l.a]
          const b = NODE_BY_ID[l.b]
          const h = linkHealth(l.id, frame, event)
          const lm = frame?.links[l.id]
          const color = HEALTH_COLOR[h]
          const isDown = lm?.up === 0
          const isPredicted = event?.elementKind === "link" && event.element === l.id && (event.phase === "degrading" || event.phase === "imminent")
          const util = lm?.utilizationPct ?? 0
          return (
            <g key={l.id}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={isDown ? 1 : 2.5}
                strokeOpacity={isDown ? 0.4 : 0.6}
                strokeDasharray={isDown ? "4 6" : undefined}
                className={isPredicted ? "animate-sentinel-pulse" : undefined}
              />
              {/* animated traffic flow */}
              {!isDown && util > 5 && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="2 10"
                  className="animate-dash-flow"
                  opacity={0.9}
                />
              )}
            </g>
          )
        })}

        {/* nodes */}
        {NODES.map((node) => {
          const h = nodeHealth(node.id, frame, event)
          const color = HEALTH_COLOR[h]
          const isSel = selected === node.id
          const isPredicted =
            event?.element === node.id && (event.phase === "degrading" || event.phase === "imminent")
          const nm = frame?.nodes[node.id]
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y})`}
              onClick={() => onSelect(node.id)}
              className="cursor-pointer"
            >
              {(isPredicted || isSel) && (
                <circle r={34} fill="none" stroke={color} strokeWidth={1} opacity={0.5} className={isPredicted ? "animate-sentinel-pulse" : undefined} />
              )}
              <circle r={24} fill="var(--card)" stroke={color} strokeWidth={isSel ? 3 : 2} />
              <circle r={6} fill={color} className={isPredicted ? "animate-sentinel-pulse" : undefined} />
              <text y={-32} textAnchor="middle" className="fill-foreground font-mono" fontSize={13} fontWeight={600}>
                {node.id}
              </text>
              <text y={42} textAnchor="middle" className="fill-muted-foreground font-mono" fontSize={9}>
                {node.role} · {nm ? `${nm.cpuPct.toFixed(0)}%cpu` : "—"}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="inline-block size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}
