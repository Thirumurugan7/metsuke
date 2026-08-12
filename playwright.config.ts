import { defineConfig } from '@playwright/test'

/*
 * Serial, single worker, always. Only one window can hold macOS focus, and a capture
 * of a backgrounded window hangs rather than failing, so a second worker would not
 * just be slow, it would wedge the run. Ptys and ports are global to the machine too.
 */
export default defineConfig({
  testDir: './tests/ui/specs',
  fullyParallel: false,
  workers: 1,
  // The app has to be built and launched per file; nothing here is fast.
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  snapshotPathTemplate: '{testDir}/../__screenshots__/{testFileName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      // Font rasterisation moves a pixel or two between runs on the same machine.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide'
    }
  }
})
