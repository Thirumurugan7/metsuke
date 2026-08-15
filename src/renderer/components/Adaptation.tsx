import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { playAdaptSound } from '../state/adaptSound'
import wheelUrl from '../assets/mahoraga.webm'

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
    let cancelled = false

    /*
     * Getting this to actually move took three fixes, all of which fail silently.
     *
     * 1. Muted has to be set on the element, not left to the JSX attribute. React
     *    assigns it as a property and it does not reliably land before play(), so
     *    Chromium sees an unmuted autoplay and refuses.
     * 2. Seeking a freshly mounted element aborts a play() issued in the same tick, so
     *    wait for data before touching currentTime.
     * 3. Chromium defers playback for a window that is not visible, which is the normal
     *    case here: the flourish fires while you are looking at your browser, not at
     *    the editor. play() resolves and the video stays paused, so it needs a retry.
     *
     * Every one of these leaves the wheel frozen on frame zero rather than throwing.
     */
    const start = async (): Promise<void> => {
      const element = video.current
      if (!element) return

      element.muted = true
      element.playbackRate = RATE

      if (element.readyState < 2) {
        await new Promise<void>((resolve) => {
          const done = (): void => resolve()
          element.addEventListener('loadeddata', done, { once: true })
          setTimeout(done, 600)
        })
      }
      if (cancelled) return

      try {
        element.currentTime = 0
      } catch {
        // Not seekable yet. Playing from wherever it is beats not playing at all.
      }

      await element.play().catch(() => {})
      if (cancelled || !element.paused) return

      await new Promise((resolve) => setTimeout(resolve, 150))
      if (cancelled) return
      await element.play().catch(() => {
        // Still refused. The caption and the tone carry the moment on their own.
      })
    }

    void start()
    void playAdaptSound()

    // Fade before unmounting, so it dissolves rather than blinking out.
    const fade = setTimeout(() => setLeaving(true), VISIBLE_MS - 900)
    const done = setTimeout(() => {
      video.current?.pause()
      clearAdaptation()
    }, VISIBLE_MS)

    return () => {
      cancelled = true
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
