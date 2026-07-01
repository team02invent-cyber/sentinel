/**
 * POST /api/copilot/stream
 * Streams Ollama tokens back to the browser as they are generated.
 * Body: { prompt: string }
 * Response: text/plain stream of raw token chunks.
 *
 * Used by the free-text NOC query path so the operator sees the answer
 * appear live instead of waiting for the full response.
 */
import { NextRequest } from "next/server"

export const maxDuration = 60

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral"

export async function POST(req: NextRequest) {
  const { prompt } = (await req.json()) as { prompt: string }
  if (!prompt) {
    return new Response("Missing prompt", { status: 400 })
  }

  const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: true,
      keep_alive: "30m",
      options: { temperature: 0.1, top_p: 0.9, num_predict: 400 },
    }),
    signal: AbortSignal.timeout(55000),
  })

  if (!ollamaRes.ok || !ollamaRes.body) {
    return new Response(`Ollama error ${ollamaRes.status}`, { status: 502 })
  }

  // Ollama streams newline-delimited JSON objects: {"response":"tok","done":false}
  // We parse each line and re-emit just the response text as a plain-text stream.
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = ollamaRes.body.getReader()

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed) as { response?: string; done?: boolean }
          if (obj.response) controller.enqueue(encoder.encode(obj.response))
        } catch {
          // partial line — ignore, Ollama chunks are usually whole lines
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {})
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  })
}
