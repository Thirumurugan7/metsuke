import { useSyncExternalStore } from 'react'
import { getTheme, onThemeChange, type Theme } from './apply'

/**
 * Subscribe a component to the current theme.
 *
 * useSyncExternalStore rather than a store of its own: the theme already lives in a
 * module with a subscribe function, and duplicating it into zustand would give two
 * sources of truth for one value.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(onThemeChange, getTheme, getTheme)
}
