import { test } from '../fixtures'
import { makeWorkspace, removeDir } from '../helpers/workspace'
import { openWorkspace, shot } from '../helpers/stable'

test('the same screen captured twice does not drift', async ({ app }) => {
  const dir = await makeWorkspace()
  try {
    await openWorkspace(app.page, dir)

    // Two captures of one screen. If masking or freezing is wrong, the second fails.
    await shot(app.page, 'workspace.png')
    await shot(app.page, 'workspace.png')
  } finally {
    await removeDir(dir)
  }
})
