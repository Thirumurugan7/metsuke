/**
 * Alert audio.
 *
 * A user-chosen file is read by the main process and handed over as base64, because the
 * renderer's CSP forbids loading `file://` media directly. When no file is configured,
 * a two-tone chime is synthesised with the Web Audio API so the sound channel works
 * out of the box with nothing to install.
 */

let cached: { path: string | null; url: string } | null = null

/** When the alert last made a noise, so other sounds can stay out of its way. */
let playedAt = 0
export const alertSoundPlayedAt = (): number => playedAt

/** Built-in chime: a rising two-note figure, deliberately short and not alarming. */
function playBuiltInChime(volume: number): void {
  const context = new AudioContext()
  const now = context.currentTime

  for (const [index, frequency] of [880, 1318.5].entries()) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency

    const start = now + index * 0.14
    // A quick attack and exponential decay reads as a chime rather than a beep.
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.01) * 0.6, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32)

    oscillator.connect(gain).connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.35)
  }

  // Release the hardware once the tail has finished.
  setTimeout(() => void context.close(), 900)
}

export async function playAlertSound(
  soundPath: string | null,
  volume: number,
  fetchSound: () => Promise<{ mimeType: string; base64: string } | null>
): Promise<void> {
  playedAt = Date.now()
  if (!soundPath) return playBuiltInChime(volume)

  try {
    if (cached?.path !== soundPath) {
      const data = await fetchSound()
      if (!data) return playBuiltInChime(volume)

      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0))
      if (cached) URL.revokeObjectURL(cached.url)
      cached = { path: soundPath, url: URL.createObjectURL(new Blob([bytes], { type: data.mimeType })) }
    }

    const audio = new Audio(cached.url)
    audio.volume = Math.min(1, Math.max(0, volume))
    await audio.play()
  } catch {
    // Unreadable or unsupported file: still make a noise rather than failing silently.
    playBuiltInChime(volume)
  }
}
