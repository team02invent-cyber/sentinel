import { NextResponse } from "next/server"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export const maxDuration = 120

const VOICE_ID = "pNInz6obpgDQGcFmaJgB"
const MODEL_ID = "eleven_multilingual_v2"

const LINES = [
  "Every year, network outages cost enterprises billions.",
  "And most are caught only after users are already impacted.",
  "Sentinel changes that.",
  "It watches your MPLS and SD-WAN fabric in real time, learning what normal looks like.",
  "Then it predicts failures up to a minute before they cascade.",
  "When trouble emerges, its air-gapped AI copilot explains the root cause,",
  "and hands your engineers a remediation playbook.",
  "All running fully offline, inside your secure perimeter.",
  "This is network operations that can finally see the future.",
]

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return NextResponse.json({ error: "no key" }, { status: 500 })

  const fullText = LINES.join(" ")
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: fullText,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
      }),
    },
  )
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status })

  const data = await res.json()
  const audioBuffer = Buffer.from(data.audio_base64, "base64")
  const align = data.alignment ?? data.normalized_alignment ?? {}
  const chars: string[] = align.characters ?? []
  const starts: number[] = align.character_start_times_seconds ?? []
  const ends: number[] = align.character_end_times_seconds ?? []

  const joined = chars.join("")
  const timings: { line: string; start: number; end: number }[] = []
  let cursor = 0
  for (const line of LINES) {
    const idx = joined.indexOf(line.slice(0, 18), cursor)
    const s = idx >= 0 ? idx : cursor
    const e = Math.min(s + line.length - 1, chars.length - 1)
    timings.push({ line, start: +(starts[s] ?? 0).toFixed(3), end: +(ends[e] ?? 0).toFixed(3) })
    cursor = e + 1
  }
  const duration = +(ends[ends.length - 1] ?? 0).toFixed(3)

  const dir = join(process.cwd(), "public", "onboarding")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "narration.mp3"), audioBuffer)
  writeFileSync(join(dir, "narration.json"), JSON.stringify({ voiceId: VOICE_ID, model: MODEL_ID, duration, lines: timings }, null, 2))

  return NextResponse.json({ ok: true, kb: Math.round(audioBuffer.length / 1024), duration, lines: timings.length })
}
