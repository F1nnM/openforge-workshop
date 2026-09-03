// @vitest-environment jsdom
/**
 * Tests for the thumbnail: the frame arithmetic, the tint plumbing, and P3's
 * source switch.
 *
 * Row P0 moved this component out of the catalog card and left the screen-level
 * assertions where they were: `screens/catalog/catalog.test.tsx` asserts frame
 * 0's `src`, its intrinsic dimensions, `loading`/`decoding` and the "no render"
 * plate through a real catalog render, which is the right level for what the
 * screen actually mounts. What is here is what only the component knows.
 *
 * ## What these tests prove
 *
 * That the **source and everything derived from it move together**. That is the
 * whole of row P3's correctness argument, and it is assertable in jsdom because
 * it is about attributes and inline styles rather than about pixels: for each
 * source, one `<img>` class, one URL, one pair of intrinsic dimensions, one set
 * of geometry custom properties and one `url(#…)` are checked *on the same
 * render*. A change that moved one without the others would fail here.
 *
 * They also prove the fallback chain steps in the right order, that it is keyed
 * on the blob so a recycled `VirtuosoGrid` instance cannot inherit another
 * tile's 404, and that `material` and `thumb` are required — the last of those
 * at compile time rather than here, which is the point of them being required.
 *
 * ## What they cannot prove, and what was measured instead
 *
 * **jsdom applies no filters and rasterises nothing.** Not one assertion below
 * observes a pixel. Whether a matrix produces the intended colour is arithmetic
 * and lives in `src/materials/tint.test.ts`; whether a browser honours
 * `color-interpolation-filters="sRGB"` and resolves an inline `url(#id)` against
 * the document is a browser behaviour no unit test in this repo can reach.
 *
 * P1 checked the `sprite` chain against Chrome 148 rendering the real sheets.
 * **P3 could not repeat that for the `thumb` chain: there is no Chrome,
 * Chromium or Puppeteer download in this environment.** So the second chain has
 * still never rendered a real pixel in a real engine, and that is the row's one
 * unverified claim. What was done instead, offline with `sharp` over **26,499
 * opaque pixels of three real tiles** — frame 0 of the live sheets and the
 * actual `.webp` derivatives the tool stages from them, resampled to the same
 * 256×256 grid so the comparison is pixel for pixel of one mesh:
 *
 *   | family | the two chains agree | thumb pixels through the *sprite* matrix |
 *   | --- | --- | --- |
 *   | `wood` | med 0.97, p95 4.59, max 33.79 | med 24.08, 0.5% black |
 *   | `unknown` | med 1.14, p95 4.91, max 37.65 | med 20.08, 1.6% black |
 *   | `dungeon_stone` | med 2.05, p95 8.06, max 60.57 | med 37.30, 3.2% black |
 *   | `necro` | med 2.41, p95 11.10, max 73.67 | med 61.04, **81.5% black** |
 *
 * All ΔE00. Two things follow and neither was known before:
 *
 *   - **The chains agree at the corpus mean and only in the median elsewhere.**
 *     `tint.test.ts` asserts exact agreement at one point; over real pixels the
 *     p95 reaches 11.10 for `necro`, past the palette's own 9.0 legibility
 *     floor, and the tail reaches 73.67 on specular highlights. So flipping the
 *     source is **not** visually transparent — it is cheaper *and slightly
 *     different*, most on the darkest family and on the sheen.
 *   - **The black-grid failure is real at scale, not just at the mean.** P1
 *     reported `necro` landing on `#000000` for the corpus-mean pixel; over real
 *     thumbnail pixels **81.5% of them** come out black through the wrong
 *     matrix. That is what the switch has to make unrepresentable, and it is why
 *     these tests assert the filter id and the image class from the same render.
 *
 * Both figures are **recorded, not asserted**: reproducing them needs three
 * sheets from someone else's production bucket and a native `sharp`, neither of
 * which belongs in a unit test. `tools/thumbnails` is where a row that wants
 * them in CI would put them.
 *
 * The `<defs>` mount is deliberately never torn down in production — see
 * `TintFilters.tsx` — so these tests remove it themselves between cases. That
 * is the one place they diverge from the real lifecycle, and it is why the
 * "mounted once" case renders several thumbnails in a single `render` call.
 */
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { BlobId, CatalogAssets, SpriteSheet } from '@/catalog'
import { MEASURED_THUMB } from '@/catalog'
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
const OTHER = '0000000000000000000000000000aaa2' as BlobId

/** The common props, so a case states only what it is about. */
const base = { assets: ASSETS, sheet: SHEET, material: 'unknown' } as const

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
      <TileThumb {...base} blob={BLOB} sprite thumb={false} className="of-bill-thumb" />,
    )

    expect(container.querySelector('.of-thumb')?.className).toBe('of-thumb of-bill-thumb')
  })

  it('renders the well with no class of its own when none is given', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

    expect(container.querySelector('.of-thumb')?.className).toBe('of-thumb')
  })

  it('shards the sprite path by the first six hex of the md5', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

    expect(container.querySelector('.of-thumb-sheet')?.getAttribute('src')).toBe(
      'https://objects.openforge.tools/sprites/000000/0000000000000000000000000000aaa1.png',
    )
  })

  it('keeps the well without a frame for the one tile of 8,702 with neither source', () => {
    // The well is what keeps a card the same height as its neighbours, so the
    // missing case loses the image and nothing else.
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite={false} thumb={false} />)

    expect(container.querySelector('.of-thumb')).not.toBeNull()
    expect(container.querySelector('.of-thumb-frame')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('no render')
  })

  it('gives the image an empty alt, because the card title already names the tile', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

    expect(container.querySelector('.of-thumb-sheet')?.getAttribute('alt')).toBe('')
  })
})

describe('which source is shown', () => {
  it('prefers the 256px derivative when the index says one exists', () => {
    // `thumb: true` is what the whole row is for: the sheet is 529 KB and ten
    // frames to show one, the derivative is a quarter of the pixels.
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb />)

    const image = container.querySelector('img')
    expect(image?.className).toBe('of-thumb-image')
    expect(image?.getAttribute('src')).toBe(
      `https://objects.openforge.tools/thumbs/000000/0000000000000000000000000000aaa1${MEASURED_THUMB.extension}`,
    )
    expect(image?.getAttribute('width')).toBe(String(MEASURED_THUMB.size))
    expect(image?.getAttribute('height')).toBe(String(MEASURED_THUMB.size))
    expect(container.querySelector('.of-thumb-sheet')).toBeNull()
  })

  it('shows the sheet when no derivative exists, which is all 8,702 records today', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

    const image = container.querySelector('img')
    expect(image?.className).toBe('of-thumb-sheet')
    expect(image?.getAttribute('width')).toBe(String(SHEET.cols * SHEET.tile))
    expect(image?.getAttribute('height')).toBe(String(SHEET.rows * SHEET.tile))
    expect(container.querySelector('.of-thumb-image')).toBeNull()
  })

  it('shows a derivative even for a record with no sheet, rather than assuming one implies the other', () => {
    // `thumb` implies `sprite` today, because the derivative is cropped from
    // frame 0 of the sheet. That is a property of how the objects happen to be
    // produced, and this component does not depend on it.
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite={false} thumb />)

    expect(container.querySelector('.of-thumb-image')).not.toBeNull()
    expect(container.textContent).not.toContain('no render')
  })

  it('carries the sheet geometry on the sprite source and none on the derivative', () => {
    // The derivative is one square image filling a square frame: there is
    // nothing to clip, so the custom properties are absent rather than set to
    // an identity that would look like geometry.
    const sprite = render(<TileThumb {...base} blob={BLOB} sprite thumb={false} frame={7} />)
    expect(sprite.container.querySelector('.of-thumb-frame')?.getAttribute('style')).toContain('-200%')

    const thumb = render(<TileThumb {...base} blob={BLOB} sprite thumb frame={7} />)
    const style = thumb.container.querySelector('.of-thumb-frame')?.getAttribute('style')
    expect(style).not.toContain('--of-sheet')
    expect(style).toContain('filter:')
  })
})

describe('the crossing the row exists to prevent', () => {
  // Pointing the `sprite` matrix at thumbnail pixels is not a near miss: over
  // 26,499 real pixels it is a median 20.08 to 61.04 ΔE00 and turns 81.5% of a
  // `necro` tile black. See the header. These four cases are the plumbing half
  // of making that unrepresentable — the source picks the filter and the image
  // together, on the same render.
  it('points the sprite chain at the sheet', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb={false} material="necro" />)

    expect(container.querySelector('img')?.className).toBe('of-thumb-sheet')
    expect(container.querySelector('.of-thumb-frame')?.getAttribute('style')).toContain(
      tintFilterId('necro', 'sprite'),
    )
  })

  it('points the thumb chain at the derivative', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb material="necro" />)

    expect(container.querySelector('img')?.className).toBe('of-thumb-image')
    expect(container.querySelector('.of-thumb-frame')?.getAttribute('style')).toContain(
      tintFilterId('necro', 'thumb'),
    )
  })

  it('never has the sheet class and the thumb filter on one render, for any family', () => {
    // The property, stated over the whole palette rather than for one family:
    // the image class and the filter id are two readings of one variable.
    for (const material of MATERIAL_ORDER) {
      for (const thumb of [true, false]) {
        const { container } = render(
          <TileThumb {...base} blob={BLOB} sprite thumb={thumb} material={material} />,
        )
        const source = thumb ? 'thumb' : 'sprite'
        const other = thumb ? 'sprite' : 'thumb'
        const style = container.querySelector('.of-thumb-frame')?.getAttribute('style') ?? ''
        expect(style).toContain(tintFilterId(material, source))
        expect(style).not.toContain(tintFilterId(material, other))
        expect(container.querySelector('img')?.className).toBe(
          thumb ? 'of-thumb-image' : 'of-thumb-sheet',
        )
      }
    }
  })

  it('swaps the filter along with the image when a derivative 404s', () => {
    // The failure mode the row was warned about: an `onError` that changes the
    // `src` and leaves the `filter` alone. Here the fallback moves the source,
    // and the source is the only input.
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb material="necro" />)

    const before = container.querySelector('img')
    expect(before?.className).toBe('of-thumb-image')
    fireEvent.error(before as HTMLImageElement)

    const after = container.querySelector('img')
    expect(after?.className).toBe('of-thumb-sheet')
    expect(after?.getAttribute('src')).toContain('/sprites/')
    const style = container.querySelector('.of-thumb-frame')?.getAttribute('style') ?? ''
    expect(style).toContain(tintFilterId('necro', 'sprite'))
    expect(style).not.toContain(tintFilterId('necro', 'thumb'))
    // And the geometry the sheet needs arrived with it.
    expect(style).toContain('--of-sheet-cols')
  })
})

describe('the fallback chain', () => {
  it('falls through both sources to the plate rather than a broken image', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb />)

    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.of-thumb-frame')).toBeNull()
    expect(container.textContent).toContain('no render')
  })

  it('sends a sheet-only record straight to the plate, with no thumb step to waste', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

    fireEvent.error(container.querySelector('img') as HTMLImageElement)

    expect(container.textContent).toContain('no render')
  })

  it('does not carry a failure from one tile onto the next, because the grid recycles instances', () => {
    // `VirtuosoGrid` reuses component instances as rows scroll. A bare counter
    // would take the 404 this blob earned and apply it to whichever tile landed
    // in the slot next — a permanently sheet-only card with a working thumbnail.
    const { container, rerender } = render(<TileThumb {...base} blob={BLOB} sprite thumb />)

    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')?.className).toBe('of-thumb-sheet')

    rerender(<TileThumb {...base} blob={OTHER} sprite thumb />)

    expect(container.querySelector('img')?.className).toBe('of-thumb-image')
    expect(container.querySelector('img')?.getAttribute('src')).toContain(OTHER)
  })

  it('keeps a fallback for the blob that earned it across an unrelated re-render', () => {
    const { container, rerender } = render(<TileThumb {...base} blob={BLOB} sprite thumb />)

    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    rerender(<TileThumb {...base} blob={BLOB} sprite thumb className="of-pal-thumb" />)

    expect(container.querySelector('img')?.className).toBe('of-thumb-sheet')
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

    render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

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
        <TileThumb {...base} blob={BLOB} sprite thumb={false} material="cave" />
        <TileThumb {...base} blob={BLOB} sprite thumb={false} material="brick" />
        <TileThumb {...base} blob={BLOB} sprite thumb material="wood" />
      </>,
    )

    expect(document.querySelectorAll(`#${TINT_FILTER_SHEET_ID}`)).toHaveLength(1)
    expect(document.querySelectorAll(`#${tintFilterId('cave', 'sprite')}`)).toHaveLength(1)
  })

  it('declares sRGB interpolation on every filter, because SVG defaults to linearRGB', () => {
    // Not cosmetic. These matrices are only valid in gamma-encoded sRGB — the
    // space stl-thumb composited its Phong terms in. jsdom cannot show that the
    // attribute changes anything; it can show it is there.
    render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

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
    render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

    const sheet = document.getElementById(TINT_FILTER_SHEET_ID)
    expect(sheet?.getAttribute('aria-hidden')).toBe('true')
    expect(sheet?.getAttribute('style')).toContain('position:absolute')
    expect(sheet?.getAttribute('style')).toContain('overflow:hidden')
    expect(sheet?.getAttribute('style')).not.toContain('display:none')
  })

  it('carries a filter for every family and both sources', () => {
    // Both sets are mounted whether or not anything references one, which is
    // what makes this row's switch a change of argument rather than of plumbing.
    render(<TileThumb {...base} blob={BLOB} sprite thumb={false} />)

    for (const material of MATERIAL_ORDER) {
      expect(document.getElementById(tintFilterId(material, 'sprite'))).not.toBeNull()
      expect(document.getElementById(tintFilterId(material, 'thumb'))).not.toBeNull()
    }
  })
})

describe('where the tint is applied', () => {
  it('filters the frame, keeping the geometry properties on the same element', () => {
    // The frame and not the image: `thumb.css` gives the frame no colour of its
    // own, so the output is identical, and a CSS filter rasterises the element's
    // own clipped box — the sheet image's box is the whole 2×5 sheet. For the
    // 256px derivative the two boxes are the same and the saving is 1×; the
    // attachment point stays here so the source stays the only variable.
    const { container } = render(
      <TileThumb {...base} blob={BLOB} sprite thumb={false} material="brick" frame={7} />,
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

  it('tints the derivative on the frame too, never on the image', () => {
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite thumb material="water" />)

    expect(container.querySelector('.of-thumb-frame')?.getAttribute('style')).toContain(
      tintFilterId('water', 'thumb'),
    )
    expect(container.querySelector('.of-thumb-image')?.getAttribute('style')).toBeNull()
  })

  it('leaves the well and the "no render" plate untouched, which are already token colours', () => {
    // The radial-gradient well, the plate and the library screen's shimmer are
    // correct as they are; an inherited filter over them would be a regression.
    const { container } = render(<TileThumb {...base} blob={BLOB} sprite={false} thumb={false} />)

    const well = container.querySelector('.of-thumb')
    expect(well?.getAttribute('style')).toBeNull()
    expect(container.querySelector('.of-thumb-missing')?.getAttribute('style')).toBeNull()
    expect(container.querySelector('.of-thumb-frame')).toBeNull()
  })
})
