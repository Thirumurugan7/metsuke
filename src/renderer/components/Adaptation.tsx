import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { playAdaptSound } from '../state/adaptSound'
import wheelUrl from '../assets/mahoraga.mp4'

/** How long the flourish stays on screen. The clip is longer; it is cut short on purpose. */
const VISIBLE_MS = 4200
/** Slowed well below real time, which is most of what makes it read as ceremony. */
const RATE = 0.55

/**
 * The wheel turns when Claude adapts.
 *
 * Deliberately faint and completely inert: `pointer-events: none` throughout, no focus
 * taken, nothing above it in the stacking order that matters. If you are typing when it
 * fires you should be able to keep typing and barely notice.
 */
export function Adaptation(): JSX.Element | null {
  const adaptation = useStore((s) => s.adaptation)
  const clearAdaptation = useStore((s) => s.clearAdaptation)
  const video = useRef<HTMLVideoElement>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!adaptation) return

    setLeaving(false)
    const element = video.current
    if (element) {
      /*
       * Muted has to be set on the element itself, not left to the JSX attribute.
       * React assigns it as a property and it does not reliably land before play() is
       * called, so Chromium sees an unmuted autoplay, refuses it, and the wheel sits
       * frozen on frame zero. Setting it here is what actually makes it move.
       */
      element.muted = true
      element.playbackRate = RATE
      element.currentTime = 0
      void element.play().catch(() => {
        // Still refused: the caption and the tone carry the moment on their own.
      })
    }

    void playAdaptSound()

    // Fade before unmounting, so it dissolves rather than blinking out.
    const fade = setTimeout(() => setLeaving(true), VISIBLE_MS - 900)
    const done = setTimeout(() => {
      video.current?.pause()
      clearAdaptation()
    }, VISIBLE_MS)

    return () => {
      clearTimeout(fade)
      clearTimeout(done)
    }
  }, [adaptation, clearAdaptation])

  if (!adaptation) return null

  return (
    <div className={`adapt${leaving ? ' leaving' : ''}`} aria-hidden="true">
      <video ref={video} className="adapt-wheel" src={wheelUrl} muted playsInline preload="auto" />
      <div className="adapt-caption">
        <span className="adapt-word">adapting</span>
        <span className="adapt-skill">{adaptation.skill}</span>
      </div>
    </div>
  )
}
