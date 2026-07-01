/**
 * One-time build script: generates the Sentinel onboarding narration with
 * ElevenLabs and stores it OFFLINE in /public so the running app never calls
 * the API again. Uses the with-timestamps endpoint to get character-level
 * alignment, which we collapse into per-line timings for the karaoke captions.
 *
 * Run once:
 *   node --env-file=/vercel/share/.env.project scripts/generate-narration.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, "..", "public", "onboarding")

// A clear, cinematic voice. "Adam" — deep, measured, futuristic narrator.
const VOICE_ID = "pNInz6obpgDQGcFmaJgB"
const MODEL_ID = "eleven_multilingual_v2"

// The pitch, split into caption lines. The audio is generated from the joined
// text so the character alignment maps cleanly back onto each line.
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

const fullText = LINES.join(" ")

async function main() {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) {
    console.error("[v0] ELEVENLABS_API_KEY not set")
    process.exit(1)
  }

  console.log("[v0] Requesting narration from ElevenLabs...")
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

  if (!res.ok) {
    console.error("[v0] ElevenLabs error", res.status, await res.text())
    process.exit(1)
  }

  const data = await res.json()
  const audioBuffer = Buffer.from(data.audio_base64, "base64")

  // Character alignment -> per-line start/end times.
  const chars = data.alignment?.characters ?? data.normalized_alignment?.characters ?? []
  const starts = data.alignment?.character_start_times_seconds ?? data.normalized_alignment?.character_start_times_seconds ?? []
  const ends = data.alignment?.character_end_times_seconds ?? data.normalized_alignment?.character_end_times_seconds ?? []

  const timings = []
  let cursor = 0
  const joined = chars.join("")
  for (const line of LINES) {
    // Locate this line within the concatenated character stream.
    const idx = joined.indexOf(line.slice(0, 20), cursor)
    const startCharIdx = idx >= 0 ? idx : cursor
    const endCharIdx = Math.min(startCharIdx + line.length - 1, chars.length - 1)
    const start = starts[startCharIdx] ?? 0
    const end = ends[endCharIdx] ?? start + 2
    timings.push({ line, start: +start.toFixed(3), end: +end.toFixed(3) })
    cursor = endCharIdx + 1
  }

  const totalDuration = ends[ends.length - 1] ?? timings[timings.length - 1]?.end ?? 0

  mkdirSync(publicDir, { recursive: true })
  writeFileSync(join(publicDir, "narration.mp3"), audioBuffer)
  writeFileSync(
    join(publicDir, "narration.json"),
    JSON.stringify({ voiceId: VOICE_ID, model: MODEL_ID, duration: +totalDuration.toFixed(3), lines: timings }, null, 2),
  )

  console.log(`[v0] Saved narration.mp3 (${(audioBuffer.length / 1024).toFixed(0)} KB) and narration.json`)
  console.log(`[v0] Duration ${totalDuration.toFixed(1)}s across ${timings.length} lines`)
}

main()
