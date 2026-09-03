#!/usr/bin/env tsx
/**
 * Rebuild the real-sheet test fixture.
 *
 *     tsx tools/thumbnails/fixtures/mkfixture.ts [md5]
 *
 * ## Why a fixture exists at all
 *
 * The one thing this tool must not get wrong is *which frame it crops*, and that
 * cannot be proved against a synthetic checkerboard: a synthetic sheet would
 * agree with a column-major reading, a flipped row order or a transposed grid
 * just as happily as with the right one, as long as the test's expectation was
 * built the same wrong way. It has to be a real render, where the ten frames are
 * ten actual camera angles and frame 0 is a real "front" view.
 *
 * ## Why it is not the real sheet's bytes
 *
 * A real sheet is 2560×1024 and about 670–875 KB. Checking one into git to test
 * an arithmetic identity is a poor trade, and the arithmetic does not depend on
 * the frame size: this tool reads the grid from `CatalogFile.sprite`, so 512 px
 * frames are *data*, not an assumption in the code.
 *
 * So the fixture keeps the real pixels and shrinks them. Each of the ten frames
 * is cropped from the real sheet at its native 512 px and downscaled
 * independently to {@link FIXTURE_TILE} px, then reassembled into a
 * `5 × FIXTURE_TILE` by `2 × FIXTURE_TILE` sheet with the same row-major layout.
 * Every frame is therefore genuine render content of a genuine camera angle,
 * the grid is genuinely 2×5, and the file is small enough to review.
 * Lossless WebP, so the fixture's pixels are exactly what the test asserts on.
 *
 * ## Which sheet
 *
 * `4896685b1a1d9855ccd33999a303c195` — the Aztlan `s2w` door corner. Chosen
 * because it is **strongly asymmetric**, which is what makes a
 * "the crop is frame 0 and not frame 3" assertion meaningful.
 * `src/screens/detail/spriteFrames.ts` measured its frames: the pairs upstream's
 * metadata wrongly calls identical differ by 27.0, 27.0 and 12.6 mean absolute
 * per-channel difference. The obvious first sheet in display order,
 * `87076088…`, is a four-fold symmetric 1×1 floor whose eight ring frames
 * collapse into two clusters of four at MAD ≤ 2.3 — against that sheet, a
 * frame-identity test would pass while cropping the wrong frame.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import sharp from 'sharp'

import { MEASURED_SPRITE_SHEET } from '../../../src/catalog'
import { USER_AGENT } from '../fetch'
import { frameRect } from '../geometry'

import { FIXTURE_BLOB, FIXTURE_PATH, FIXTURE_SHEET, FIXTURE_TILE } from './sheet'

async function main(blob: string): Promise<void> {
  const url = `https://objects.openforge.tools/sprites/${blob.slice(0, 6)}/${blob}.png`
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`)
  const sheet = Buffer.from(await response.arrayBuffer())

  const composites = []
  for (let index = 0; index < MEASURED_SPRITE_SHEET.frames; index += 1) {
    const source = frameRect(MEASURED_SPRITE_SHEET, index)
    const target = frameRect(FIXTURE_SHEET, index)
    composites.push({
      input: await sharp(sheet)
        .extract(source)
        .resize(FIXTURE_TILE, FIXTURE_TILE, { fit: 'cover', kernel: 'lanczos3' })
        .png()
        .toBuffer(),
      left: target.left,
      top: target.top,
    })
  }

  const out = await sharp({
    create: {
      width: FIXTURE_SHEET.cols * FIXTURE_TILE,
      height: FIXTURE_SHEET.rows * FIXTURE_TILE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ lossless: true, effort: 6 })
    .toBuffer()

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true })
  writeFileSync(FIXTURE_PATH, out)
  process.stdout.write(
    `${FIXTURE_PATH}\n  source ${url}\n  ${String(FIXTURE_SHEET.cols * FIXTURE_TILE)}×` +
      `${String(FIXTURE_SHEET.rows * FIXTURE_TILE)} · ${String(out.byteLength)} bytes lossless webp\n`,
  )
}

await main(process.argv[2] ?? FIXTURE_BLOB)
