/**
 * The crop arithmetic, against the real declared geometry.
 *
 * `render.test.ts` proves the crop lands on the right *pixels* of a real sheet.
 * This file proves the rectangles are right for the real 512 px, 2×5 layout the
 * importer stamps — including the two failure modes that would otherwise be
 * silent: a column-major reading of the grid, and a sheet whose dimensions do
 * not match what the index claims.
 */
import { describe, expect, it } from 'vitest'

import { MEASURED_SPRITE_SHEET } from '../../src/catalog'

import { assertSheetExtent, frameRect, sheetExtent } from './geometry'

describe('sheetExtent', () => {
  it('is 2560×1024 for the measured layout', () => {
    expect(sheetExtent(MEASURED_SPRITE_SHEET)).toEqual({ width: 2560, height: 1024 })
  })
})

describe('frameRect', () => {
  it('puts the default frame at the top-left 512×512', () => {
    expect(frameRect(MEASURED_SPRITE_SHEET, MEASURED_SPRITE_SHEET.defaultFrame)).toEqual({
      left: 0,
      top: 0,
      width: 512,
      height: 512,
    })
  })

  it('lays the ten frames out row-major, five across then five across', () => {
    const lefts = Array.from({ length: 10 }, (_, i) => frameRect(MEASURED_SPRITE_SHEET, i).left)
    const tops = Array.from({ length: 10 }, (_, i) => frameRect(MEASURED_SPRITE_SHEET, i).top)
    expect(lefts).toEqual([0, 512, 1024, 1536, 2048, 0, 512, 1024, 1536, 2048])
    expect(tops).toEqual([0, 0, 0, 0, 0, 512, 512, 512, 512, 512])
  })

  it('is not column-major — frame 1 is to the right of frame 0, not below it', () => {
    const zero = frameRect(MEASURED_SPRITE_SHEET, 0)
    const one = frameRect(MEASURED_SPRITE_SHEET, 1)
    expect(one.left).toBeGreaterThan(zero.left)
    expect(one.top).toBe(zero.top)
  })

  it('covers the sheet exactly, with no overlap and no gap', () => {
    const covered = new Set<string>()
    for (let i = 0; i < MEASURED_SPRITE_SHEET.frames; i += 1) {
      const rect = frameRect(MEASURED_SPRITE_SHEET, i)
      expect(rect.left + rect.width).toBeLessThanOrEqual(2560)
      expect(rect.top + rect.height).toBeLessThanOrEqual(1024)
      covered.add(`${String(rect.left)},${String(rect.top)}`)
    }
    expect(covered.size).toBe(MEASURED_SPRITE_SHEET.frames)
  })

  it('refuses a frame that is not on the sheet', () => {
    expect(() => frameRect(MEASURED_SPRITE_SHEET, 10)).toThrow(/not on a 2×5 sheet/)
    expect(() => frameRect(MEASURED_SPRITE_SHEET, -1)).toThrow(/not on a 2×5 sheet/)
    expect(() => frameRect(MEASURED_SPRITE_SHEET, 1.5)).toThrow(/not on a 2×5 sheet/)
  })

  it('refuses a frame count the grid cannot hold', () => {
    expect(() => frameRect({ ...MEASURED_SPRITE_SHEET, frames: 15 }, 12)).toThrow(/row 2 of a 2-row sheet/)
  })
})

describe('assertSheetExtent', () => {
  it('accepts the declared size', () => {
    expect(() => {
      assertSheetExtent({ width: 2560, height: 1024 }, MEASURED_SPRITE_SHEET, 'blob')
    }).not.toThrow()
  })

  it('names the object and both sizes when a sheet disagrees', () => {
    expect(() => {
      assertSheetExtent({ width: 1280, height: 512 }, MEASURED_SPRITE_SHEET, 'deadbeef')
    }).toThrow(/deadbeef: sheet is 1280×512, expected 2560×1024/)
  })

  it('rejects an undecodable sheet rather than treating it as zero-sized', () => {
    expect(() => {
      assertSheetExtent({}, MEASURED_SPRITE_SHEET, 'deadbeef')
    }).toThrow(/sheet is \?×\?/)
  })
})
