// @vitest-environment jsdom
/**
 * Tests for the extracted thumbnail.
 *
 * Row P0 moved this component out of the catalog card, and the tests that cover
 * it stayed where they were: `screens/catalog/catalog.test.tsx` asserts frame 0's
 * `src`, its intrinsic dimensions, `loading`/`decoding` and the "no render" plate
 * through a real catalog render, which is the right level for the thing the
 * screen actually mounts, and moving those assertions would have made a seam row
 * look like a behaviour change.
 *
 * What is here is what only the component knows and no screen exercises: the
 * frame arithmetic away from frame 0, and the class merge the two builder panels
 * depend on. Both are things the next two rows are about to edit — P3 gives the
 * 256px derivative its own geometry, P1 puts a filter on the sheet — so this is
 * the file those rows extend.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { BlobId, CatalogAssets, SpriteSheet } from '@/catalog'

import { TileThumb, sheetFrameStyle } from '.'

const SHEET: SpriteSheet = { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 }

const ASSETS: CatalogAssets = {
  models: 'https://objects.openforge.tools/models',
  sprites: 'https://objects.openforge.tools/sprites',
  thumbs: 'https://objects.openforge.tools/thumbs',
  lod: 'https://objects.openforge.tools/lod',
}

const BLOB = '0000000000000000000000000000aaa1' as BlobId

describe('sheetFrameStyle', () => {
  it('offsets by whole frames, so a percentage is one column or one row', () => {
    // Frame 7 of a 2×5 sheet is the third cell of the second row.
    expect(sheetFrameStyle(SHEET, 7)).toEqual({
      '--of-sheet-cols': '5',
      '--of-sheet-rows': '2',
      '--of-sheet-x': '-200%',
      '--of-sheet-y': '-100%',
    })
  })

  it("falls back to the sheet's own default frame, not to a hardcoded 0", () => {
    // The layout is index data, not a constant: a sheet whose default is not 0
    // has to render that frame, or a future derivative would silently show the
    // wrong angle.
    expect(sheetFrameStyle({ ...SHEET, defaultFrame: 3 })).toMatchObject({
      '--of-sheet-x': '-300%',
      '--of-sheet-y': '0%',
    })
  })

  it('reads the grid from the sheet, so a different layout needs no code change', () => {
    expect(sheetFrameStyle({ rows: 1, cols: 1, tile: 256, frames: 1, defaultFrame: 0 }, 0)).toMatchObject({
      '--of-sheet-cols': '1',
      '--of-sheet-rows': '1',
    })
  })
})

describe('TileThumb', () => {
  it("keeps the well class and appends the caller's, which is how the panels size it", () => {
    // `of-bill-thumb` and `of-pal-thumb` are 44px and 40px wells in a narrow
    // column; they override the 4:3 aspect ratio and must land on the same
    // element as `.of-thumb`.
    const { container } = render(
      <TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} className="of-bill-thumb" />,
    )

    expect(container.querySelector('.of-thumb')?.className).toBe('of-thumb of-bill-thumb')
  })

  it('renders the well with no class of its own when none is given', () => {
    const { container } = render(<TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} />)

    expect(container.querySelector('.of-thumb')?.className).toBe('of-thumb')
  })

  it('shards the sprite path by the first six hex of the md5', () => {
    const { container } = render(<TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} />)

    expect(container.querySelector('.of-thumb-sheet')?.getAttribute('src')).toBe(
      'https://objects.openforge.tools/sprites/000000/0000000000000000000000000000aaa1.png',
    )
  })

  it('keeps the well without a frame for the one tile of 8,702 that has no sheet', () => {
    // The well is what keeps a card the same height as its neighbours, so the
    // missing case loses the image and nothing else.
    const { container } = render(<TileThumb blob={BLOB} sprite={false} assets={ASSETS} sheet={SHEET} />)

    expect(container.querySelector('.of-thumb')).not.toBeNull()
    expect(container.querySelector('.of-thumb-frame')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('no render')
  })

  it('gives the sheet an empty alt, because the card title already names the tile', () => {
    const { container } = render(<TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} />)

    expect(container.querySelector('.of-thumb-sheet')?.getAttribute('alt')).toBe('')
  })
})
