/**
 * SENTINEL — Incident / session export
 * =====================================
 * Produces operator-ready artifacts from the current session:
 *   - exportSessionJSON: machine-readable JSON download (metrics + logs)
 *   - printIncidentReport: opens a formatted, printable report (Save as PDF)
 * All generation is client-side — nothing leaves the machine.
 */
import type {
  ControllerState,
  CopilotResponse,
  PredictionEvent,
  SessionMetrics,
} from "./schema"

export interface SessionExport {
  event: PredictionEvent | null
  copilot: CopilotResponse | null
  metrics: SessionMetrics
  eventLog: PredictionEvent[]
  controller: ControllerState | null
  t: number
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportSessionJSON(snap: SessionExport) {
  const payload = {
    generatedAt: new Date().toISOString(),
    product: "Sentinel v2.0",
    sessionSeconds: snap.t,
    metrics: snap.metrics,
    activeEvent: snap.event,
    copilot: snap.copilot,
    eventLog: snap.eventLog,
    controller: snap.controller,
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  download(`sentinel-session-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json")
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  )
}

export function printIncidentReport(snap: SessionExport) {
  const m = snap.metrics
  const e = snap.event
  const c = snap.copilot
  const now = new Date().toLocaleString()

  const remediation =
    c?.remediation?.map(
      (r) =>
        `<li><div>${escapeHtml(r.description)}</div><pre>${escapeHtml(r.command)}</pre><small>Source: ${escapeHtml(r.source)}</small></li>`,
    ).join("") ?? "<li>No remediation recorded.</li>"

  const eventLogRows =
    snap.eventLog
      .map(
        (ev) =>
          `<tr><td>${escapeHtml(ev.id)}</td><td>${escapeHtml(ev.faultClass)}</td><td>${escapeHtml(ev.element)}</td><td>${escapeHtml(ev.outcome ?? ev.phase)}</td><td>${ev.leadTimeS.toFixed(0)}s</td></tr>`,
      )
      .join("") || `<tr><td colspan="5">No resolved events.</td></tr>`

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sentinel Incident Report</title>
<style>
  body { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #111; margin: 40px; line-height: 1.5; }
  h1 { font-size: 20px; border-bottom: 2px solid #111; padding-bottom: 8px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-top: 28px; color: #333; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .kpi { border: 1px solid #ccc; border-radius: 6px; padding: 10px; }
  .kpi .v { font-size: 22px; font-weight: 700; }
  .kpi .l { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f4f4f4; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
  pre { background: #f4f4f4; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
  li { margin-bottom: 12px; }
  small { color: #666; }
  .muted { color: #666; font-size: 11px; }
</style></head><body>
  <h1>Sentinel — NOC Incident Report</h1>
  <div class="muted">Generated ${escapeHtml(now)} · Air-gapped · Session ${snap.t}s</div>

  <h2>Session Metrics</h2>
  <div class="grid">
    <div class="kpi"><div class="v">${(m.tpr * 100).toFixed(0)}%</div><div class="l">True Positive Rate</div></div>
    <div class="kpi"><div class="v">${m.precision.toFixed(2)}</div><div class="l">Precision</div></div>
    <div class="kpi"><div class="v">${m.recall.toFixed(2)}</div><div class="l">Recall</div></div>
    <div class="kpi"><div class="v">${m.f1.toFixed(2)}</div><div class="l">F1 Score</div></div>
    <div class="kpi"><div class="v">${m.medianLeadTimeS.toFixed(0)}s</div><div class="l">Median Lead Time</div></div>
    <div class="kpi"><div class="v">${m.farPer10Min.toFixed(2)}</div><div class="l">False Alarms / 10min</div></div>
  </div>
  <p class="muted">Confusion matrix — TP ${m.truePositives} · FP ${m.falseAlarms} · FN ${m.falseNegatives} · TN ${m.trueNegatives}. Packets loss prevented: ${m.packetsLossPrevented.toLocaleString()}.</p>

  <h2>Active Prediction</h2>
  ${
    e
      ? `<p><strong>${escapeHtml(e.faultClass)}</strong> on <strong>${escapeHtml(e.element)}</strong> · confidence ${(e.confidence * 100).toFixed(0)}% · phase ${escapeHtml(e.phase)} · ${e.timeToImpactS.toFixed(0)}s to impact</p>`
      : `<p class="muted">No active prediction at time of export.</p>`
  }

  <h2>Copilot Assessment</h2>
  ${
    c
      ? `<p><strong>What:</strong> ${escapeHtml(c.summary.text)} <small>[${escapeHtml(c.summary.source)}]</small></p>
         <p><strong>Why:</strong> ${escapeHtml(c.rootCause.text)} <small>[${escapeHtml(c.rootCause.source)}]</small></p>
         <h2>Remediation</h2><ol>${remediation}</ol>`
      : `<p class="muted">No copilot assessment available.</p>`
  }

  <h2>Event Log</h2>
  <table><thead><tr><th>ID</th><th>Fault</th><th>Element</th><th>Outcome</th><th>Lead</th></tr></thead>
  <tbody>${eventLogRows}</tbody></table>

  <p class="muted" style="margin-top:32px">Sentinel v2.0 · Offline predictive network assurance · All inference on-premises.</p>
  <script>window.onload = () => { window.print(); }</script>
</body></html>`

  const w = window.open("", "_blank", "width=900,height=1000")
  if (!w) return
  w.document.write(html)
  w.document.close()
}
