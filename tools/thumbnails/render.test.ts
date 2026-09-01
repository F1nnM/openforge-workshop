/**
 * The crop, against a real render.
 *
 * The assertions here are on **pixel content**, not on dimensions. A crop of the
 * wrong frame has exactly the right dimensions, which is precisely why a
 * dimensions test would pass while the catalog grid showed 8,702 tiles from the
 * wrong camera angle.
 *
 * The fixture is cut from a real sheet — `fixtures/PROVENANCE.md` says which and
 * why that one. Its ten frames are ten real camera angles of an asymmetric
 * doorway, so "the crop is frame 0" is falsifiable: measured over the fixture,
 * frame 0 sits 9.1–36.2 mean absolute per-channel difference from the other
 * nine, and the closest of them (frame 4, the opposing view of a near-symmetric
 * doorway) is still 9.1 away.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { MEASURED_SPRITE_SHEET } from '../../src/catalog'

import { neutrality } from './colour'
import { FIXTURE_SHEET, FIXTURE_TILE, loadFixtureSheet } from './fixtures/sheet'
import { cropFrame, renderThumbnail } from './render'

const sheetBytes = loadFixtureSheet()

/**
 * Frame `index` extracted straight from the fixture, with the rectangle written
 * out longhand rather than taken from `geometry.ts` — otherwise the expectation
 * and the code under test would share the bug.
 */
async function frameOf(index: number): Promise<Buffer> {
  const col = index % 5
  const row = (index - col) / 5
  return sharp(sheetBytes)
    .extract({ left: col * FIXTURE_TILE, top: row * FIXTURE_TILE, width: FIXTURE_TILE, height: FIXTURE_TILE })
    .ensureAlpha()
    .raw()
    .toBuffer()
}

/** Mean absolute per-channel difference, the measure `spriteFrames.ts` uses. */
function mad(a: Buffer, b: Buffer): number {
  expect(a.byteLength).toBe(b.byteLength)
  let total = 0
  for (let i = 0; i < a.byteLength; i += 1) total += Math.abs((a[i] as number) - (b[i] as number))
  return total / a.byteLength
}

describe('cropFrame', () => {
  it('takes the index’s default frame, pixel for pixel', async () => {
    const crop = await cropFrame(sheetBytes, { sheet: FIXTURE_SHEET })
    expect(crop.width).toBe(FIXTURE_TILE)
    expect(crop.height).toBe(FIXTURE_TILE)
    expect(Buffer.compare(crop.data, await frameOf(FIXTURE_SHEET.defaultFrame))).toBe(0)
  })

  it('is nearest to frame 0 and nowhere near the other nine', async () => {
    const crop = await cropFrame(sheetBytes, { sheet: FIXTURE_SHEET })
    const distances: number[] = []
    for (let index = 0; index < FIXTURE_SHEET.frames; index += 1) {
      distances.push(mad(crop.data, await frameOf(index)))
    }
    expect(distances[0]).toBe(0)
    for (let index = 1; index < distances.length; index += 1) {
      expect(distances[index]).toBeGreaterThan(4)
    }
    expect(distances.indexOf(Math.min(...distances))).toBe(0)
  })

  it('honours an explicit frame, so the row-major indexing is exercised on both rows', async () => {
    for (const index of [1, 4, 5, 9]) {
      const crop = await cropFrame(sheetBytes, { sheet: FIXTURE_SHEET, frame: index })
      expect(Buffer.compare(crop.data, await frameOf(index))).toBe(0)
    }
  })

  it('refuses a sheet whose size disagrees with the declared geometry', async () => {
    await expect(
      cropFrame(sheetBytes, { sheet: MEASURED_SPRITE_SHEET, label: 'fixture' }),
    ).rejects.toThrow(/fixture: sheet is 640×256, expected 2560×1024/)
  })
})

describe('renderThumbnail', () => {
  it('encodes a WebP at the requested edge, from frame 0', async () => {
    const bytes = await renderThumbnail(sheetBytes, { sheet: FIXTURE_SHEET, size: 64 })
    const meta = await sharp(bytes).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(64)
    expect(meta.hasAlpha).toBe(true)
  })

  it('carries frame 0’s content, and is nearest to it of all ten', async () => {
    const rendered = await sharp(await renderThumbnail(sheetBytes, { sheet: FIXTURE_SHEET, size: FIXTURE_TILE }))
      .ensureAlpha()
      .raw()
      .toBuffer()

    const distances: number[] = []
    for (let index = 0; index < FIXTURE_SHEET.frames; index += 1) {
      distances.push(mad(rendered, await frameOf(index)))
    }

    // Not zero, and it never will be: WebP subsamples chroma 4:2:0 outside
    // lossless mode, and a strongly blue render is exactly the content that
    // costs the most. Measured on this fixture the floor is 8.5 even at q100,
    // against 8.95 at the q80 this tool ships — so the codec, not the quality
    // setting, is what the residual is. What matters is the ranking.
    const toFrame0 = distances[0] as number
    const runnerUp = Math.min(...distances.slice(1))
    expect(distances.indexOf(Math.min(...distances))).toBe(0)
    expect(runnerUp).toBeGreaterThan(1.5 * toFrame0)
    expect(distances[3] as number).toBeGreaterThan(2.5 * toFrame0)
  })

  it('is deterministic — two encodes of one sheet are byte-identical', async () => {
    const once = await renderThumbnail(sheetBytes, { sheet: FIXTURE_SHEET, size: 64 })
    const twice = await renderThumbnail(sheetBytes, { sheet: FIXTURE_SHEET, size: 64 })
    expect(Buffer.compare(once, twice)).toBe(0)
  })

  it('gets smaller as quality drops, so the quality argument is actually applied', async () => {
    const high = await renderThumbnail(sheetBytes, { sheet: FIXTURE_SHEET, quality: 95 })
    const low = await renderThumbnail(sheetBytes, { sheet: FIXTURE_SHEET, quality: 40 })
    expect(low.byteLength).toBeLessThan(high.byteLength)
  })

  it('keeps the renderer’s blue by default and removes it on request', async () => {
    const raw = async (tone: 'blue' | 'neutral'): Promise<Buffer> =>
      sharp(await renderThumbnail(sheetBytes, { sheet: FIXTURE_SHEET, size: FIXTURE_TILE, tone }))
        .ensureAlpha()
        .raw()
        .toBuffer()

    const blue = neutrality(await raw('blue'))
    const neutral = neutrality(await raw('neutral'))

    // architecture-plan.md §8's "99.8% of opaque pixels are non-neutral", re-derived.
    expect(blue.share).toBeGreaterThan(0.95)
    expect(blue.mean.b).toBeGreaterThan(blue.mean.r)
    // Rec.709 luma leaves nothing to tint against.
    expect(neutral.share).toBeLessThan(0.01)
    expect(neutral.meanChroma).toBeLessThan(1)
  })

  it('refuses to invent a frame the sheet does not have', async () => {
    await expect(renderThumbnail(sheetBytes, { sheet: FIXTURE_SHEET, frame: 10 })).rejects.toThrow(
      /not on a 2×5 sheet/,
    )
  })
})
