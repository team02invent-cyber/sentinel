/**
 * SENTINEL — Fixed MPLS Core Topology (Demo Reference)
 * ----------------------------------------------------
 * 7 nodes / 9 links. This mirrors a small ground-station backbone.
 * The topology is FIXED for the demonstration build. The production
 * design uses per-node feature vectors with a shared model so it is
 * topology-agnostic (see schema.ts -> SCHEMA_NOTES).
 */

export type NodeRole = "PE" | "P" | "RR"

export interface TopoNode {
  id: string
  label: string
  role: NodeRole
  /** Layout coordinates in a 1000 x 600 viewBox */
  x: number
  y: number
}

export interface TopoLink {
  id: string
  a: string
  b: string
  /** Nominal capacity in Mbps — used to derive utilization. */
  capacityMbps: number
}

export const NODES: TopoNode[] = [
  { id: "PE1", label: "PE1 · Ingress", role: "PE", x: 90, y: 300 },
  { id: "P1", label: "P1 · Core", role: "P", x: 320, y: 150 },
  { id: "P2", label: "P2 · Core", role: "P", x: 320, y: 450 },
  { id: "RR1", label: "RR1 · Reflector", role: "RR", x: 300, y: 570 },
  { id: "P3", label: "P3 · Core", role: "P", x: 660, y: 150 },
  { id: "P4", label: "P4 · Core", role: "P", x: 660, y: 450 },
  { id: "PE2", label: "PE2 · Egress", role: "PE", x: 910, y: 300 },
]

export const LINKS: TopoLink[] = [
  { id: "PE1-P1", a: "PE1", b: "P1", capacityMbps: 1000 },
  { id: "PE1-P2", a: "PE1", b: "P2", capacityMbps: 1000 },
  { id: "P1-P2", a: "P1", b: "P2", capacityMbps: 1000 },
  { id: "P1-P3", a: "P1", b: "P3", capacityMbps: 1000 },
  { id: "P2-P4", a: "P2", b: "P4", capacityMbps: 1000 },
  { id: "P3-P4", a: "P3", b: "P4", capacityMbps: 1000 },
  { id: "P3-PE2", a: "P3", b: "PE2", capacityMbps: 1000 },
  { id: "P4-PE2", a: "P4", b: "PE2", capacityMbps: 1000 },
  { id: "RR1-P2", a: "RR1", b: "P2", capacityMbps: 1000 },
]

export const NODE_BY_ID: Record<string, TopoNode> = Object.fromEntries(
  NODES.map((n) => [n.id, n]),
)

export const LINK_BY_ID: Record<string, TopoLink> = Object.fromEntries(
  LINKS.map((l) => [l.id, l]),
)

/**
 * The primary "deep-space pass" LSP path. Traffic for a scheduled
 * spacecraft pass is carried PE1 -> P1 -> P3 -> PE2. Its protect path
 * is PE1 -> P2 -> P4 -> PE2.
 */
export const PRIMARY_LSP_PATH = ["PE1", "P1", "P3", "PE2"]
export const PROTECT_LSP_PATH = ["PE1", "P2", "P4", "PE2"]
