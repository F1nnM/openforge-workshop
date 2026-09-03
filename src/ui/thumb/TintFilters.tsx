/**
 * The one `<defs>` on the page, and the hook that guarantees it is there.
 *
 * `src/materials/tint.ts` works out *what* the 32 `feColorMatrix` filters are.
 * This file is only about *where they live*, which turned out to be the harder
 * half.
 *
 * ## One mount, not one per thumb
 *
 * `filter: url(#id)` is a **document-scoped fragment reference**. One mount
 * anywhere in the page serves every thumbnail in it, and a `<defs>` per thumb
 * would put the same 32 ids on a screenful of cards — where `url(#id)` silently
 * resolves to whichever came first. That looks right, for the wrong reason, and
 * leaves sixty duplicate ids behind.
 *
 * So the question is not scope, it is **reachability**: which single mount point
 * cannot be forgotten. `TileThumb` is the answer, because it is the one module
 * every thumbnail-rendering subtree instantiates. When row P0 cut it out of the
 * catalog card there were four such subtrees; `screens/detail/slots/SlotFills.tsx`
 * landed afterwards and is a fifth, and it inherits the filters without knowing
 * they exist. That is the property an app-shell mount does not have.
 *
 * ## Why this is DOM and not JSX
 *
 * The sheet is static: it takes no props, holds no state, and is derived from
 * the palette at module load. Rendering it from React means choosing which
 * instance of a component that mounts sixty times owns it, and every version of
 * that choice has a hole:
 *
 *   - **Every instance renders it** — sixty duplicate ids, as above.
 *   - **An elected instance renders it, portalled to `document.body`** — the
 *     election changes when the elected card scrolls out of the grid, and the
 *     re-election lands in a later commit than the unmount, so there is a paint
 *     with no `<defs>` in the document. A dangling `url(#id)` renders the
 *     element unfiltered (Filter Effects 1 §7.1), so that paint is a flash of
 *     the raw blue.
 *   - **A second React root, refcounted** — `root.unmount()` from a cleanup
 *     effect runs inside another root's commit, which React warns about, and
 *     `root.render()` is asynchronous, so the very first thumbnail can paint
 *     before the filters exist.
 *
 * Building 32 inert elements once, synchronously, in a layout effect has none of
 * those problems and no teardown at all. It is deliberately **never removed**:
 * it is 32 elements of inert DOM, it is needed again the instant any thumbnail
 * mounts, and a lifecycle that cannot run is a lifecycle that cannot be wrong.
 * {@link useTintFilters} is idempotent by id, so calling it from sixty cards
 * does the work once.
 *
 * ## `sRGB`, spelled out, because the default is wrong here
 *
 * Every `<filter>` carries `color-interpolation-filters="sRGB"`. SVG's default
 * is `linearRGB`, and these matrices are only valid in gamma-encoded sRGB —
 * that is the space `stl-thumb` added its Phong terms in, and the space the
 * pixel cloud is planar in to 0.318 of one 8-bit level (against 0.764 in linear
 * light). See the module comment in `src/materials/tint.ts`.
 *
 * The filter region is pinned to the source box (`0%`/`0%`/`100%`/`100%`)
 * rather than left at SVG's default `-10%` … `120%`, which reserves 44% more
 * surface than the element occupies. `feColorMatrix` is per-pixel and spreads
 * nothing, so there is no reason to pay for the margin.
 *
 * ## What a browser confirmed, because no unit test here can
 *
 * jsdom applies no filters, so the tests around this file assert plumbing and
 * `tint.test.ts` asserts arithmetic. The two claims that are neither were
 * checked against Chrome 148 rendering the real sheets through these exact
 * filters, and compared pixel for pixel with the same matrices applied offline:
 *
 *   - **the browser agrees with the derivation** — mean absolute difference
 *     0.002–0.020 of one 8-bit level across six families, worst pixel 2;
 *   - **`sRGB` is load-bearing and honoured** — flipping the same filters to
 *     SVG's default `linearRGB` moves the output 20.5–44.7 8-bit levels, a
 *     median CIELAB lightness error of 6.5–18.5 L*.
 *
 * The transparent background composited cleanly onto the well's gradient in
 * that check, with no fringe and no opaque plate, which is the alpha row of
 * every matrix doing its job.
 *
 * `url(#id)` inside a **bundled external stylesheet** has historically resolved
 * against the stylesheet's URL rather than the document's in WebKit, which
 * would have broken a CSS-side reference in production while working in dev.
 * That hazard is sidestepped rather than tested: `TileThumb` puts the `filter`
 * in the inline `style` object it already builds for the frame, so the
 * reference is always resolved against the document.
 */
import { useLayoutEffect } from 'react'

import { TINT_FILTERS } from '@/materials'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** The id of the single `<svg>` holding every tint filter. */
export const TINT_FILTER_SHEET_ID = 'of-tint-filters'

/**
 * Coefficients are written to six decimals. The largest coefficient in the set
 * is under 1.1, so the worst rounding error reaches an output channel at 1e-6 —
 * 0.00026 of one 8-bit level, four orders of magnitude below anything visible,
 * in exchange for roughly halving the size of the attribute.
 */
const PRECISION = 6

function formatValues(values: readonly number[]): string {
  return values.map((value) => String(Number(value.toFixed(PRECISION)))).join(' ')
}

function buildSheet(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('id', TINT_FILTER_SHEET_ID)
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  // Out of flow with zero extent, so it adds no scroll extent and cannot widen
  // a flex or grid parent. Not `display: none`, which stops some engines
  // resolving filter references out of the subtree at all.
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
  // Nothing in here is content. `focusable` is for the IE/Edge-era behaviour of
  // putting SVG roots in the tab order, which some assistive stacks still honour.
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const defs = document.createElementNS(SVG_NS, 'defs')
  for (const filter of TINT_FILTERS) {
    const element = document.createElementNS(SVG_NS, 'filter')
    element.setAttribute('id', filter.id)
    element.setAttribute('color-interpolation-filters', 'sRGB')
    element.setAttribute('x', '0%')
    element.setAttribute('y', '0%')
    element.setAttribute('width', '100%')
    element.setAttribute('height', '100%')

    const matrix = document.createElementNS(SVG_NS, 'feColorMatrix')
    matrix.setAttribute('type', 'matrix')
    matrix.setAttribute('values', formatValues(filter.values))

    element.append(matrix)
    defs.append(element)
  }

  svg.append(defs)
  return svg
}

/**
 * Make sure the page has the tint filters. Idempotent, and safe to call from
 * every thumbnail.
 *
 * A layout effect rather than a passive one: it runs before the browser paints,
 * so even a thumbnail whose image is already in the memory cache cannot paint
 * one frame of un-tinted blue.
 */
export function useTintFilters(): void {
  useLayoutEffect(() => {
    if (document.getElementById(TINT_FILTER_SHEET_ID) !== null) return
    document.body.append(buildSheet())
  }, [])
}
