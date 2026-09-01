/**
 * The real-sheet fixture, and how to load it.
 *
 * Constants live here rather than in `mkfixture.ts` because that script fetches
 * from the bucket at import time; a test that imported it would go to the
 * network. See `mkfixture.ts` for what the fixture is, which sheet it came from
 * and why that sheet.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SpriteSheet } from '../../../src/catalog'
import { MEASURED_SPRITE_SHEET } from '../../../src/catalog'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The sheet the fixture is cut from: the Aztlan `s2w` door corner, strongly asymmetric. */
export const FIXTURE_BLOB = '4896685b1a1d9855ccd33999a303c195'

/** Frame edge in the fixture. The real sheet's frames are 512 px. */
export const FIXTURE_TILE = 128

export const FIXTURE_PATH = join(HERE, `sheet-${FIXTURE_BLOB.slice(0, 8)}.mini.webp`)

/**
 * The fixture's geometry: the real sheet's 2×5 row-major grid at a smaller frame
 * size. Frame size is data in this tool — the index carries it — so shrinking it
 * exercises exactly the same code path as the real 512 px sheets.
 */
export const FIXTURE_SHEET: SpriteSheet = { ...MEASURED_SPRITE_SHEET, tile: FIXTURE_TILE }

export function loadFixtureSheet(): Buffer {
  return readFileSync(FIXTURE_PATH)
}
