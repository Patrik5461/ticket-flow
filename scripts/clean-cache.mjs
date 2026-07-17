/**
 * Remove Vite / TanStack dev caches. Cross-platform (no rm -rf), so it works in
 * cmd.exe and POSIX shells alike. Used by `npm run dev:clean` to recover from a
 * stale server-function registry ("Invalid server function ID") after editing
 * files under src/server/.
 */

import { rmSync } from 'node:fs'

const targets = ['node_modules/.vite', '.tanstack', '.output', '.nitro']

for (const dir of targets) {
  rmSync(dir, { recursive: true, force: true })
  console.log(`removed ${dir}`)
}
