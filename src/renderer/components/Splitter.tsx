import { useEffect, useRef } from 'react'

/**
 * A draggable divider between two panels.
 *
 * The listeners are registered once for the component's lifetime and read `onResize`
 * through a ref. They used to be re-registered whenever `onResize` changed identity —
 * and since the parent passes an inline arrow, that was every render, including the
 * re-render caused by the resize itself. The teardown reset the drag flag, so a drag
 * died a few pixels in: a 120px drag moved 30px.
 */
export function Splitter({
  orientation,
  onResize,
  label
}: {
  orientation: 'vertical' | 'horizontal'
  /** Called with the pointer's viewport coordinate along the drag axis. */
  onResize: (coordinate: number) => void
  label: string
}): JSX.Element {
  const dragging = useRef(false)
  const handle = useRef<HTMLDivElement>(null)

  // Always the latest callback, without making the listener effect depend on it.
  const latest = useRef(onResize)
  latest.current = onResize

  useEffect(() => {
    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging.current) return
      e.preventDefault()
      latest.current(orientation === 'vertical' ? e.clientX : e.clientY)
    }

    const stop = (): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('resizing')
      handle.current?.removeAttribute('data-dragging')
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      stop()
    }
  }, [orientation])

  return (
    <div
      ref={handle}
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        dragging.current = true
        // Keeps the drag alive over the Monaco editor and the preview webview, which
        // would otherwise swallow the pointer. Synthetic pointers may not be capturable.
        try {
          handle.current?.setPointerCapture(e.pointerId)
        } catch {
          /* capture is an optimisation, not a requirement */
        }
        document.body.classList.add('resizing')
        handle.current?.setAttribute('data-dragging', 'true')
      }}
      // Keyboard resizing, so the layout is not mouse-only.
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10
        const rect = handle.current?.getBoundingClientRect()
        if (!rect) return
        const at = orientation === 'vertical' ? rect.left : rect.top
        if (e.key === (orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp')) onResize(at - step)
        if (e.key === (orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown')) onResize(at + step)
      }}
    />
  )
}
