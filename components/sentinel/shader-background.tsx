"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"

// WebGL canvas must be client-only; load lazily so it never blocks SSR/first paint.
const ShaderGradientCanvas = dynamic(
  () => import("@shadergradient/react").then((m) => m.ShaderGradientCanvas),
  { ssr: false },
)
const ShaderGradient = dynamic(
  () => import("@shadergradient/react").then((m) => m.ShaderGradient),
  { ssr: false },
)

/**
 * Animated liquid shader backdrop (shader-gradient) rendered fixed behind the
 * entire app. Kept dark and low-density so the real-time dashboard stays crisp
 * and the frosted glass panels read clearly on top. Respects reduced-motion.
 */
export function ShaderBackground() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    // Skip the WebGL layer for users who prefer reduced motion — the static
    // radial wash in globals.css remains as a graceful fallback.
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setEnabled(!mq.matches)
    const onChange = () => setEnabled(!mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  if (!enabled) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ opacity: 0.6 }}
    >
      <ShaderGradientCanvas
        style={{ width: "100%", height: "100%" }}
        pixelDensity={1}
        fov={40}
      >
        <ShaderGradient
          control="props"
          type="waterPlane"
          animate="on"
          uSpeed={0.16}
          uDensity={1.3}
          uStrength={2.4}
          uFrequency={5.5}
          color1="#0b2540"
          color2="#0e7490"
          color3="#15173a"
          cDistance={3.6}
          cameraZoom={9.1}
          cAzimuthAngle={180}
          cPolarAngle={80}
          grain="on"
          lightType="3d"
          brightness={0.9}
          envPreset="dawn"
          reflection={0.1}
          rotationX={50}
          rotationY={0}
          rotationZ={-60}
          positionX={0}
          positionY={0}
          positionZ={0}
        />
      </ShaderGradientCanvas>
    </div>
  )
}
