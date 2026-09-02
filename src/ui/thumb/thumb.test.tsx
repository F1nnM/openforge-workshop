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
 *
 * ## What the P1 tests here prove, and what they cannot
 *
 * **jsdom applies no filters and rasterises nothing.** Every assertion below is
 * about the *plumbing*: that a `<defs>` exists, that it is mounted once however
 * many thumbnails render, that each `<filter>` carries
 * `color-interpolation-filters="sRGB"`, and that the frame's inline style points
 * at the right id. Not one of them observes a pixel. Whether the matrix produces
 * the intended colour is arithmetic, and it is asserted in
 * `src/materials/tint.test.ts`; whether a browser honours the `sRGB` attribute
 * and resolves an inline `url(#id)` against the document is a browser
 * behaviour that no unit test in this repo can reach.
 *
 * The mount is deliberately never torn down in production — see
 * `TintFilters.tsx` — so these tests remove it themselves between cases. That
 * is the one place the tests diverge from the real lifecycle, and it is why the
 * "mounted once" case renders several thumbnails in a single `render` call
 * rather than relying on state left behind by an earlier one.
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { BlobId, CatalogAssets, SpriteSheet } from '@/catalog'
import { MATERIAL_ORDER, TINT_FILTERS, tintFilterId } from '@/materials'

import { TINT_FILTER_SHEET_ID, TileThumb, sheetFrameStyle } from '.'

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

describe('the tint filter sheet', () => {
  beforeEach(() => {
    // Production never removes it. See the header note.
    document.getElementById(TINT_FILTER_SHEET_ID)?.remove()
  })

  it('is mounted by rendering a thumbnail, with no caller having to ask', () => {
    // The point of mounting from here rather than from the app shell: five
    // subtrees render this component and the fifth landed after the seam was
    // cut. None of them mounts a `<defs>`, and all five are tinted.
    expect(document.getElementById(TINT_FILTER_SHEET_ID)).toBeNull()

    render(<TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} />)

    const sheet = document.getElementById(TINT_FILTER_SHEET_ID)
    expect(sheet).not.toBeNull()
    expect(sheet?.parentElement).toBe(document.body)
    expect(sheet?.querySelectorAll('filter')).toHaveLength(TINT_FILTERS.length)
  })

  it('mounts once for a screenful, so one id never appears twice', () => {
    // A `<defs>` per thumbnail would put the same 32 ids on every card, where
    // `url(#id)` resolves silently to the first — the right picture for the
    // wrong reason.
    render(
      <>
        <TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} material="cave" />
        <TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} material="brick" />
        <TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} material="wood" />
      </>,
    )

    expect(document.querySelectorAll(`#${TINT_FILTER_SHEET_ID}`)).toHaveLength(1)
    expect(document.querySelectorAll(`#${tintFilterId('cave', 'sprite')}`)).toHaveLength(1)
  })

  it('declares sRGB interpolation on every filter, because SVG defaults to linearRGB', () => {
    // Not cosmetic. These matrices are only valid in gamma-encoded sRGB — the
    // space stl-thumb composited its Phong terms in. jsdom cannot show that the
    // attribute changes anything; it can show it is there.
    render(<TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} />)

    const filters = [...document.querySelectorAll(`#${TINT_FILTER_SHEET_ID} filter`)]
    expect(filters).toHaveLength(TINT_FILTERS.length)
    for (const filter of filters) {
      expect(filter.getAttribute('color-interpolation-filters')).toBe('sRGB')
      expect(filter.querySelector('feColorMatrix')?.getAttribute('type')).toBe('matrix')
    }
  })

  it('adds no scroll extent and nothing to announce', () => {
    // D6 cost 2,809px of scroll extent to a clipped span that escaped its clip.
    // A zero-extent absolutely-positioned host cannot repeat that, and
    // `display: none` is not used because some engines then stop resolving
    // filter references out of the subtree.
    render(<TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} />)

    const sheet = document.getElementById(TINT_FILTER_SHEET_ID)
    expect(sheet?.getAttribute('aria-hidden')).toBe('true')
    expect(sheet?.getAttribute('style')).toContain('position:absolute')
    expect(sheet?.getAttribute('style')).toContain('overflow:hidden')
    expect(sheet?.getAttribute('style')).not.toContain('display:none')
  })

  it('carries a filter for every family and both sources', () => {
    render(<TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} />)

    for (const material of MATERIAL_ORDER) {
      expect(document.getElementById(tintFilterId(material, 'sprite'))).not.toBeNull()
      expect(document.getElementById(tintFilterId(material, 'thumb'))).not.toBeNull()
    }
  })
})

describe('where the tint is applied', () => {
  it('filters the frame, keeping the geometry properties on the same element', () => {
    // The frame and not the image: `catalog.css` gives the frame no colour of
    // its own, so the output is identical, and a CSS filter rasterises the
    // element's own clipped box — the image's box is the whole 2x5 sheet.
    const { container } = render(
      <TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} material="brick" frame={7} />,
    )

    // The id, not the whole `url(...)`: jsdom serialises the reference with
    // quotes inside the parentheses and browsers are not consistent about it,
    // so the assertion is on the part that is ours.
    const frame = container.querySelector('.of-thumb-frame')
    expect(frame?.getAttribute('style')).toContain('filter:')
    expect(frame?.getAttribute('style')).toContain(tintFilterId('brick', 'sprite'))
    expect(frame?.getAttribute('style')).toContain('-200%')
    expect(container.querySelector('.of-thumb-sheet')?.getAttribute('style')).toBeNull()
  })

  it("points at the sprite chain, which is the one argument P3's switch changes", () => {
    const { container } = render(
      <TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} material="water" />,
    )

    expect(container.querySelector('.of-thumb-frame')?.getAttribute('style')).toContain(
      'of-tint-sprite-water',
    )
  })

  it('renders an untold thumbnail as unclassified rather than as the renderer blue', () => {
    // The blue is not the neutral option: 31.88 dE00 from the palette on
    // average and 14.82 from `water`. `unknown` is the palette's no-claim
    // entry, and it is what a component that was not told the material is
    // entitled to say.
    const { container } = render(<TileThumb blob={BLOB} sprite assets={ASSETS} sheet={SHEET} />)

    expect(container.querySelector('.of-thumb-frame')?.getAttribute('style')).toContain(
      'of-tint-sprite-unknown',
    )
  })

  it('leaves the well and the "no render" plate untouched, which are already token colours', () => {
    // The radial-gradient well, the plate and the library screen's shimmer are
    // correct as they are; an inherited filter over them would be a regression.
    const { container } = render(<TileThumb blob={BLOB} sprite={false} assets={ASSETS} sheet={SHEET} />)

    const well = container.querySelector('.of-thumb')
    expect(well?.getAttribute('style')).toBeNull()
    expect(container.querySelector('.of-thumb-missing')?.getAttribute('style')).toBeNull()
    expect(container.querySelector('.of-thumb-frame')).toBeNull()
  })
})
