// Post-build guard: fail loudly if the older-Safari polyfill did not make it
// into the SSR output. The polyfill renders from __root's <head> into a
// content-hashed router chunk (NOT ssr.mjs), so we grep the whole _ssr dir by
// CONTENT, never by chunk filename. Run: `node scripts/verify-polyfill.mjs`.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SSR_DIR = '.output/server/_ssr'
const NEEDLE = "Object,'hasOwn'" // unique to our polyfill's defineProperty call

if (!existsSync(SSR_DIR)) {
  console.error(`[verify-polyfill] ${SSR_DIR} not found — run \`npm run build\` first.`)
  process.exit(1)
}

const hit = readdirSync(SSR_DIR)
  .filter((f) => f.endsWith('.mjs'))
  .find((f) => readFileSync(join(SSR_DIR, f), 'utf8').includes(NEEDLE))

if (!hit) {
  console.error(
    '[verify-polyfill] FAIL: older-Safari polyfill not found in any _ssr chunk. ' +
      'Mobile hydration will break. Did the devtools-vite plugin strip __root.tsx?',
  )
  process.exit(1)
}

console.log(`[verify-polyfill] OK: polyfill present in ${hit}`)
