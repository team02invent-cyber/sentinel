/**
 * POST /api/copilot/warmup
 * Fires a 1-token generation so Ollama loads the model into memory.
 * Called once on app mount to eliminate the cold-start lag on the
 * operator's first real query. Safe to call repeatedly (idempotent).
 */
import { NextResponse } from "next/server"

export const maxDuration = 60

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral"

export async function POST() {
  const start = Date.now()
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: "ok",
        stream: false,
        // keep_alive holds the model in RAM for 30 min after warm-up
        keep_alive: "30m",
        options: { num_predict: 1, temperature: 0 },
      }),
      signal: AbortSignal.timeout(55000),
    })
    if (!res.ok) {
      return NextResponse.json({ warmed: false, error: `Ollama ${res.status}` }, { status: 502 })
    }
    await res.json()
    return NextResponse.json({ warmed: true, model: OLLAMA_MODEL, loadMs: Date.now() - start })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ warmed: false, error: message }, { status: 503 })
  }
}
