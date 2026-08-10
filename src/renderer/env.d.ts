/// <reference types="vite/client" />

import type { JSX as ReactJSX } from 'react'

/**
 * React 19 removed the global JSX namespace in favour of `React.JSX`. Aliasing it back
 * keeps plain `JSX.Element` return annotations working across the renderer without an
 * import in every file.
 */
declare global {
  namespace JSX {
    type Element = ReactJSX.Element
    type ElementType = ReactJSX.ElementType
    type IntrinsicElements = ReactJSX.IntrinsicElements
  }
}

export {}
