/**
 * POST /api/copilot/embed
 * Real semantic embeddings via Ollama's nomic-embed-text model.
 * Body: { texts: string[] }
 * Response: { embeddings: number[][], model: string } | { error }
 *
 * Requires: `ollama pull nomic-embed-text` on the host.
 * If the model is missing, the client falls back to hash-based stub vectors.
 */
import { NextRequest, NextResponse } from "next/server"

export const maxDuration = 60

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434"
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text"

export async function POST(req: NextRequest) {
  try {
    const { texts } = (await req.json()) as { texts: string[] }
    if (!Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: "Missing texts[]" }, { status: 400 })
    }

    // Ollama /api/embed supports a batch `input` array (v0.1.39+)
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
      signal: AbortSignal.timeout(45000),
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Ollama embed ${res.status}: ${text}` }, { status: 502 })
    }

    const data = (await res.json()) as { embeddings?: number[][] }
    if (!data.embeddings) {
      return NextResponse.json({ error: "No embeddings returned" }, { status: 502 })
    }
    return NextResponse.json({ embeddings: data.embeddings, model: EMBED_MODEL })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
