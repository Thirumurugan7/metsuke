import { describe, it, expect } from 'vitest'
import { nextFocusIndex } from './focusOrder'

describe('nextFocusIndex', () => {
  it('moves forward through the dialog', () => {
    expect(nextFocusIndex(4, 1, false)).toBe(2)
  })

  it('moves backward with shift', () => {
    expect(nextFocusIndex(4, 2, true)).toBe(1)
  })

  /*
   * The wrap is the whole point. Without it, Tab off the last control lands on the
   * window behind the dialog: the user is now typing into a file tree they cannot see
   * past a modal, with no way back except the mouse.
   */
  it('wraps from the last control to the first', () => {
    expect(nextFocusIndex(4, 3, false)).toBe(0)
  })

  it('wraps backward from the first control to the last', () => {
    expect(nextFocusIndex(4, 0, true)).toBe(3)
  })

  /*
   * Focus can sit outside the list: on the dialog container itself, or on an element
   * that has just been disabled. Tab should then enter at the appropriate end rather
   * than doing nothing, which is what an index of -1 means here.
   */
  it('enters at the first control when focus is not in the list', () => {
    expect(nextFocusIndex(4, -1, false)).toBe(0)
  })

  it('enters at the last control when tabbing backwards from outside', () => {
    expect(nextFocusIndex(4, -1, true)).toBe(3)
  })

  it('stays put when the dialog has a single control', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0)
    expect(nextFocusIndex(1, 0, true)).toBe(0)
  })

  it('has nowhere to go in an empty dialog', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1)
    expect(nextFocusIndex(0, 0, true)).toBe(-1)
  })
})
