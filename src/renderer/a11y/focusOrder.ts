/**
 * Where Tab should go inside a dialog, as arithmetic.
 *
 * Split out from the DOM so the wrap-around is testable without a browser. Getting it
 * wrong is not a cosmetic bug: Tab off the last control lands on the window behind the
 * dialog, and the user is then typing into a file tree they cannot see past a modal.
 *
 * `current` is -1 when focus is not on any of the elements, which happens when it is on
 * the dialog container itself or on a control that has just been disabled.
 */
export function nextFocusIndex(count: number, current: number, shift: boolean): number {
  if (count === 0) return -1
  if (current < 0) return shift ? count - 1 : 0

  return shift ? (current - 1 + count) % count : (current + 1) % count
}
