import { useCallback, useEffect, useRef } from 'react'

/**
 * A draggable divider between two panels.
 *
 * Pointer capture keeps the drag alive when the cursor moves over the Monaco editor or
 * the preview webview — without it, those swallow the pointer and the divider sticks
 * mid-drag.
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

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return
      e.preventDefault()
      onResize(orientation === 'vertical' ? e.clientX : e.clientY)
    },
    [onResize, orientation]
  )

  useEffect(() => {
    const stop = (): void => {
      dragging.current = false
      document.body.classList.remove('resizing')
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
      stop()
    }
  }, [onPointerMove])

  return (
    <div
      ref={handle}
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true
        handle.current?.setPointerCapture(e.pointerId)
        // Suppresses text selection and pointer events on iframes for the whole drag.
        document.body.classList.add('resizing')
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
