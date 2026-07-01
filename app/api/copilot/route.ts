/**
 * POST /api/copilot
 * Server-side proxy for Ollama LLM inference.
 * Runs on the Next.js server (Node.js) — can reach localhost:11434.
 * Body: { prompt: string }
 * Response: { response: string; inferenceMs: number } | { error: string }
 */
import { NextRequest, NextResponse } from "next/server"

// Mistral 7B on Apple M-series CPU takes 8-20s first token, 20-45s full response.
// Raise the Next.js route timeout so it does not cut the connection.
export const maxDuration = 60

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral"

export async function POST(req: NextRequest) {
  try {
    const { prompt } = (await req.json()) as { prompt: string }

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 })
    }

    const start = Date.now()
    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        // Lower temperature = less creative = fewer tokens = faster
        // num_predict caps the output at 300 tokens — enough for structured JSON
        options: { temperature: 0.1, top_p: 0.9, num_predict: 300 },
      }),
      signal: AbortSignal.timeout(55000), // 55s — below maxDuration so we can return an error
    })

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text()
      console.error("[v0] Ollama error:", ollamaRes.status, text)
      return NextResponse.json(
        { error: `Ollama returned ${ollamaRes.status}: ${text}` },
        { status: 502 },
      )
    }

    const data = (await ollamaRes.json()) as { response: string; done: boolean }
    const inferenceMs = Date.now() - start

    return NextResponse.json({ response: data.response, inferenceMs })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[v0] /api/copilot error:", message)
    return NextResponse.json({ error: message }, { status: 503 })
  }
}

/**
 * GET /api/copilot — health check: verifies Ollama is reachable
 */
export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    const data = await res.json()
    const models = (data.models as Array<{ name: string }>) ?? []
    return NextResponse.json({
      ollamaReachable: true,
      model: OLLAMA_MODEL,
      availableModels: models.map((m) => m.name),
    })
  } catch {
    return NextResponse.json({ ollamaReachable: false, model: OLLAMA_MODEL }, { status: 503 })
  }
}
