import { useEffect, type RefObject } from 'react'
import { nextFocusIndex } from './focusOrder'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** Visible, focusable, in DOM order. */
function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // offsetParent is null for anything display:none or inside a collapsed section, and
    // focusing one of those is a cursor that has visibly gone nowhere.
    (element) => element.offsetParent !== null || element === document.activeElement
  )
}

/**
 * Keep Tab inside a dialog while it is open, and give focus back when it closes.
 *
 * Without this, every overlay in the app leaked: Tab off the last control moved focus to
 * the window behind, so a keyboard user ended up typing into a file tree they could not
 * see past the modal, with no way back except the mouse. Closing then dropped focus on
 * the body, which means the next Tab starts again from the top of the page rather than
 * from whatever opened the dialog.
 *
 * Both halves matter for the same reason: for anyone not using a mouse, focus is the
 * cursor.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  initial?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return
    const container = ref.current
    if (!container) return

    const previous = document.activeElement as HTMLElement | null

    // Move in, so the first Tab is a step within the dialog rather than a jump out of it.
    const target = initial?.current ?? focusableWithin(container)[0] ?? container
    if (target === container && !container.hasAttribute('tabindex')) {
      // A dialog with nothing focusable still has to hold focus itself, or the trap has
      // nothing to trap and screen readers announce the page behind it.
      container.setAttribute('tabindex', '-1')
    }
    target.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return

      const elements = focusableWithin(container)
      if (elements.length === 0) {
        // Nothing to move to, but Tab must still not escape.
        event.preventDefault()
        return
      }

      const index = elements.indexOf(document.activeElement as HTMLElement)
      const next = nextFocusIndex(elements.length, index, event.shiftKey)
      if (next < 0) return

      event.preventDefault()
      elements[next].focus()
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // Only if it is still there: the element that opened the dialog may have been a
      // row that the dialog's own action removed.
      if (previous && previous.isConnected) previous.focus()
    }
  }, [open, ref, initial])
}
