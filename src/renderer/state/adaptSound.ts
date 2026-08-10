import clipUrl from '../assets/adapting.mp3'
import { alertSoundPlayedAt } from './alertSound'

/**
 * The sound of the wheel turning.
 *
 * The source clip is short and bright. Played raw it would read as a notification, which
 * is the opposite of the intent, so it goes through a low-pass filter and comes out
 * pitched down and quiet: dark and cinematic rather than chirpy. A very soft sub-bass
 * swell sits underneath to give it weight without volume.
 */

let context: AudioContext | null = null
let buffer: AudioBuffer | null = null
let loading: Promise<void> | null = null

/** Reused across plays; creating an AudioContext per sound leaks hardware voices. */
function audio(): AudioContext {
  context ??= new AudioContext()
  return context
}

async function ensureLoaded(): Promise<void> {
  if (buffer) return
  loading ??= (async () => {
    const response = await fetch(clipUrl)
    buffer = await audio().decodeAudioData(await response.arrayBuffer())
  })()
  await loading
}

/**
 * Play the adaptation tone. `volume` scales the whole thing so it can sit under the
 * alert chime rather than competing with it.
 */
export async function playAdaptSound(volume = 0.22): Promise<void> {
  // An alert that just fired is the more important sound. Rather than layering the two,
  // the flourish goes silent and plays as a purely visual moment.
  if (Date.now() - alertSoundPlayedAt() < 2500) return

  try {
    await ensureLoaded()
    const ctx = audio()
    // Autoplay policy can leave the context suspended until something resumes it.
    if (ctx.state === 'suspended') await ctx.resume()
    if (!buffer) return

    const now = ctx.currentTime

    const source = ctx.createBufferSource()
    source.buffer = buffer
    // Below 1 the clip drops in pitch and stretches, which is most of the character.
    source.playbackRate.value = 0.72

    const dark = ctx.createBiquadFilter()
    dark.type = 'lowpass'
    dark.frequency.value = 900
    dark.Q.value = 0.7

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.001), now + 0.12)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6)

    source.connect(dark).connect(gain).connect(ctx.destination)
    source.start(now)
    source.stop(now + 2.8)

    // A slow sub swell. Felt more than heard, and what makes it land as weight rather
    // than as a beep.
    const sub = ctx.createOscillator()
    const subGain = ctx.createGain()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(58, now)
    sub.frequency.exponentialRampToValueAtTime(42, now + 1.8)
    subGain.gain.setValueAtTime(0.0001, now)
    subGain.gain.exponentialRampToValueAtTime(Math.max(volume * 0.5, 0.001), now + 0.4)
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2)
    sub.connect(subGain).connect(ctx.destination)
    sub.start(now)
    sub.stop(now + 2.4)
  } catch {
    // A missing or undecodable clip should cost nothing; the visual still plays.
  }
}
