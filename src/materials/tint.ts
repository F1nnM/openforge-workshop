/**
 * OpenForge Workshop — tinting the pre-baked sprites, in the browser, per
 * material family.
 *
 * The sheets in the bucket are rendered in `stl-thumb`'s default **blue** Phong
 * material, and the grid inherited it. architecture-plan.md §8 accepted that,
 * on the grounds that a CSS `filter` over a lit render produces a muddy wash.
 * This module is the row that revisits it, because the blue is not a neutral
 * inconsistency — it is a wrong claim:
 *
 *   mean CIEDE2000, the 16 palette albedos → the corpus-median sprite pixel
 *   (`#3375c5`) ……………………………………………………………………………… **31.88** (min 14.82, max 48.96)
 *   the same 16 → a luminance-matched neutral (`#6d6d6d`) … **18.34** (min 4.28)
 *   nearest family to the blue itself ………………………… **`water`, at 14.82 ΔE00**
 *
 * A dungeon-stone tile drawn in that blue sits 16.41 ΔE00 from
 * `dungeon_stone` and 14.82 from `water` — nearer the pool than the masonry,
 * and the 1.59 ΔE00 between those two is well under the 9.0 the palette needs
 * for two families to be told apart at all
 * (`PALETTE_INVARIANTS.minPairwise`). So the blue grid was not un-tinted, it
 * was tinted as nothing in particular. Measured over 2,105,442 opaque frame-0
 * pixels from 69 sheets, one per texture root, fetched from the live bucket.
 *
 * ── The sheets are not one blue. They are blue plus a white sheen ───────────
 *
 * `stl-thumb` composites Phong on **gamma-encoded** bytes, so every opaque
 * pixel of a sheet is
 *
 *     pixel = ambient + s · diffuse + k · specular
 *
 * with `s` the diffuse shading term and `k` the specular one, and the default
 * material's `specular` is **white**. Fitting that two-term model with the
 * documented default triple (`ambient #002142`, `diffuse #3375c8`, white
 * specular) over 2,024,773 unclipped pixels leaves a mean absolute residual of
 * **1.417 / 255** (p99 5.49, max 30.8). The one-term model — blue times a
 * scalar — leaves 10.531 / 255, because the sheen is not small: 95.8% of opaque
 * pixels carry `k > 0.02` and 19.5% carry `k > 0.10`.
 *
 * That is the whole reason a single greyscale is the wrong instrument. Any one
 * scalar extracted from `(R, G, B)` is some fixed mixture `α·s + β·k`, and for
 * **Rec.709 luma the mixture is β/α = 2.3403** — the achromatic sheen is
 * weighted 2.34× the form. Rec.601 is worse (2.3893), flat 1/3 barely better
 * (2.0788), and even a matched projection onto the blue diffuse direction is
 * 1.6671. Greyscaling these sheets with any luma is mostly greyscaling the
 * highlight.
 *
 * ── So the greyscale is two scalars, and both are exact ─────────────────────
 *
 * `s` and `k` are recovered together, by the least-squares un-mix of the two
 * known directions — {@link SHADING_COEFFICIENTS} and {@link SHEEN_COEFFICIENTS},
 * the two rows of the pseudo-inverse of `[diffuse | specular]`:
 *
 *     shading = (-1.639209, -0.129612, +1.768821)   sums to 0
 *     sheen   = (+1.121868, +0.395683, -0.517551)   sums to 1
 *
 * Those two sums are the point. The shading row **sums to exactly zero**, so it
 * is a chromatic opponent and the white sheen cannot enter it at all; the sheen
 * row is exactly orthogonal to the blue diffuse direction, so the form cannot
 * enter that one. Neither is a compromise between them — the un-mix is exact,
 * and `tint.test.ts` re-derives both from the triple and asserts the four
 * orthogonality identities rather than trusting the digits above.
 *
 * ── Then the tint is the *same renderer*, re-lit ────────────────────────────
 *
 * Re-mixing with a family's own Phong triple — `MaterialFamily.sprite`, already
 * in the palette, already re-derived from `tint` by `palette.test.ts` — gives
 *
 *     out = ambient_f + s · diffuse_f + k · specular_f
 *
 * which is exactly what `stl-thumb -m …` would have written had the sheets been
 * rendered in the family's material in the first place. So this is not a wash
 * applied over a render; it is the render, re-lit. And because `s` and `k` are
 * each affine in `(R, G, B)` and the re-mix is affine in `(s, k)`, the whole
 * thing composes to **one 4×5 `feColorMatrix` per family** — no chain, no
 * intermediate greyscale pass. The three points that pin such a matrix are
 * asserted directly: the sheet's ambient maps to the family's ambient, ambient
 * + diffuse to ambient + diffuse, ambient + white to ambient + specular.
 *
 * A consequence worth knowing: all sixteen families share `specular #6b6357`,
 * so the sheen term is identical in all sixteen matrices. Only the two other
 * columns differ.
 *
 * ── sRGB, not linearRGB, and P2's finding is the reason why ─────────────────
 *
 * SVG's default is `color-interpolation-filters: linearRGB`. Every filter here
 * overrides it to `sRGB`, and that is not a convenience — it is where the model
 * holds. Fit the best rank-2 affine subspace to the pixel cloud and measure the
 * error back in 8-bit sRGB bytes:
 *
 *     fitted in gamma-encoded sRGB … MAD **0.318** / 255   (p99 3.86)
 *     fitted in linear light ……………… MAD **0.764** / 255   (p99 8.94)
 *
 * The sheets are planar in gamma to a third of one 8-bit level, because that is
 * the space `stl-thumb` added its three terms in. P2 re-solved the palette
 * after finding the draft had applied Machado-2009 to gamma-encoded sRGB when
 * the paper derives those matrices in linear light. This is the same principle
 * and the opposite conclusion: apply a matrix in the space its coefficients were
 * derived in. P2's came from a paper that works in linear light; these come from
 * a renderer that worked in gamma.
 *
 * ── Two sources, two chains, and they must not be swapped ───────────────────
 *
 * See {@link ThumbSource}. The `/thumbs/` derivative is one channel, so the
 * un-mix cannot run on it and the second chain is a regression instead. Both
 * chains agree **exactly** at the corpus-mean pixel, by construction, and
 * `tint.test.ts` asserts that for all sixteen families.
 */
import type { Rgb } from './color'
import { parseHex } from './color'
import type { MaterialId } from './palette'
import { MATERIALS, MATERIAL_ORDER } from './palette'

/* ------------------------------------------------------------------- sources */

/**
 * Which image the filter is going to be pointed at. P3 owns the switch; this
 * type is the contract it switches on.
 *
 * - **`sprite`** — a frame of the 2×5 blue sheet. Three channels, so the
 *   two-term un-mix runs exactly. This is the only source that exists today for
 *   8,701 of 8,702 tiles.
 * - **`thumb`** — the 256px `/thumbs/` derivative. `tools/thumbnails/render.ts`
 *   applies sharp's `.greyscale()`, which is **not** gamma-space Rec.709 luma:
 *   measured against 393,157 real pixels it is Rec.709 luminance computed in
 *   *linear* light and re-encoded to sRGB (MAD 0.375 / 255, against 7.053 / 255
 *   for the gamma-space reading). One channel carries one mixture of the two
 *   terms — and being a luminance taken in linear light, not even an affine
 *   one — so `s` and `k` cannot be separated and are estimated instead, by the
 *   corpus regression in {@link THUMB_REGRESSION}.
 *
 * **Pointing a chain at the other source is not a small error.** Measured over
 * 120,000 real pixels, per family, in CIEDE2000:
 *
 *   - sprite pixels through the `thumb` matrix — the `onError` swap P3's row
 *     warns about — is a median **1.38–4.51** ΔE00 (p95 up to 10.70). Visible,
 *     survivable; the `thumb` chain is calibrated against the luma *of these
 *     same blue sheets*, which is why it is not worse.
 *   - thumbnail pixels through the `sprite` matrix is a median **10.52–73.52**
 *     ΔE00, and every family collapses towards black (`necro` lands on
 *     `#000000`). The shading row sums to zero, so a grey input yields a
 *     *negative* shading term of −0.4409 and the family's diffuse is
 *     subtracted rather than added.
 *
 * So the dangerous direction is the one the row did not name, and it fails
 * loudly: a black grid, not a muddy one.
 */
export type ThumbSource = 'sprite' | 'thumb'

/* -------------------------------------------------------------- the blue basis */

/**
 * `stl-thumb`'s default Phong material — the one every sheet in the bucket was
 * rendered with. `palette.ts` §5 records the first two; the third is white.
 *
 * These three colours are the only hand-entered numbers in the un-mix. The
 * coefficients below are computed from them.
 */
export const SPRITE_PHONG = {
  ambient: '#002142',
  diffuse: '#3375c8',
  specular: '#ffffff',
} as const

const SHEET_AMBIENT = parseHex(SPRITE_PHONG.ambient)
const SHEET_DIFFUSE = parseHex(SPRITE_PHONG.diffuse)
const SHEET_SPECULAR = parseHex(SPRITE_PHONG.specular)

const dot = (a: Rgb, b: Rgb): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Which output channel a matrix row writes. */
type Channel = 0 | 1 | 2

/**
 * The two rows of the pseudo-inverse of `[diffuse | specular]`, in closed form.
 *
 * For a 3×2 basis the normal equations are a 2×2 solve, so there is no matrix
 * library here and no iteration: `det` is the Gram determinant, and each row is
 * the Gram-weighted difference of the two directions. The identities this
 * guarantees — `shading · diffuse = 1`, `shading · specular = 0`,
 * `sheen · specular = 1`, `sheen · diffuse = 0` — are what make the un-mix
 * exact rather than a fit, and `tint.test.ts` asserts all four.
 */
function unmix(diffuse: Rgb, specular: Rgb): { shading: Rgb; sheen: Rgb } {
  const dd = dot(diffuse, diffuse)
  const ds = dot(diffuse, specular)
  const ss = dot(specular, specular)
  const det = dd * ss - ds * ds

  const row = (scaleA: number, a: Rgb, scaleB: number, b: Rgb): Rgb => [
    (scaleA * a[0] - scaleB * b[0]) / det,
    (scaleA * a[1] - scaleB * b[1]) / det,
    (scaleA * a[2] - scaleB * b[2]) / det,
  ]

  return {
    shading: row(ss, diffuse, ds, specular),
    sheen: row(dd, specular, ds, diffuse),
  }
}

const SHEET_UNMIX = unmix(SHEET_DIFFUSE, SHEET_SPECULAR)

/**
 * Recovers the diffuse shading term from a sheet pixel. Sums to zero, so the
 * white specular sheen contributes nothing: **this is the greyscale**, and it is
 * a blue-minus-red opponent rather than a luminance.
 */
export const SHADING_COEFFICIENTS: Rgb = SHEET_UNMIX.shading

/**
 * Recovers the specular term. Sums to one and is orthogonal to the blue diffuse
 * direction, so the form contributes nothing to it.
 */
export const SHEEN_COEFFICIENTS: Rgb = SHEET_UNMIX.sheen

/**
 * Rec.709 luma weights.
 *
 * Kept for two jobs, neither of which is greyscaling a sheet. They collapse the
 * three channels of the `thumb` chain's input, where the input is already grey
 * and any weights summing to 1 would agree; and they are what
 * {@link SPRITE_LUMA_SHEEN_BIAS} is measured against, which is the argument for
 * not using them on a sheet.
 */
export const LUMA_COEFFICIENTS: Rgb = [0.2126, 0.7152, 0.0722]

/**
 * How much more of the white sheen than of the form a Rec.709 greyscale of
 * these sheets carries: `β/α`, where `α` is the response to the blue diffuse
 * direction and `β` the response to white. **2.3403.** Derived, not typed.
 */
export const SPRITE_LUMA_SHEEN_BIAS =
  dot(LUMA_COEFFICIENTS, SHEET_SPECULAR) / dot(LUMA_COEFFICIENTS, SHEET_DIFFUSE)

/* ---------------------------------------------------------------- the corpus */

/**
 * What the sheets actually measure, over 69 live sheets — one per texture root
 * in the index — cropped to frame 0.
 *
 * Stated so a reviewer can see the shape of the data the `thumb` regression was
 * fitted to without re-fetching 27 MB of PNG. `meanShading` and `meanSheen` are
 * load-bearing, not decoration: they are the point the two chains are pinned to
 * agree at.
 */
export const SPRITE_CORPUS = {
  /** Sheets sampled, one per `texture|` root present in the index. */
  sheets: 69,
  /** Opaque (alpha > 250) pixels in the 69 frame-0 crops. */
  opaquePixels: 2_105_442,
  /** Of those, the ones with no channel at 255 — the ones the fit used. */
  unclippedPixels: 2_024_773,
  /** Mean absolute residual of `ambient + s·diffuse + k·white`, in 8-bit units. */
  modelResidual: 1.417,
  /** Mean diffuse shading term over the unclipped pixels. */
  meanShading: 0.494_96,
  /** Mean specular term. Nonzero on 95.8% of pixels — the sheen is not an edge case. */
  meanSheen: 0.093_369,
  /** Mean `/thumbs/`-style grey byte, 0–1, for the same pixels. */
  meanThumbValue: 0.440_19,
} as const

/**
 * `s` and `k` estimated from the single channel a `/thumbs/` derivative has.
 *
 * Ordinary least squares of each term on the grey value, over the
 * {@link SPRITE_CORPUS.unclippedPixels} pixels, with the grey value produced by
 * the same `sharp().greyscale()` call `tools/thumbnails/render.ts` makes — so
 * this is calibrated against the real derivative and not against a model of it.
 *
 * `r2` is the honest cost of the second channel being gone: **0.4993** of the
 * shading variance and 0.6128 of the sheen variance survive the collapse. A
 * thumbnail cannot be un-mixed, only guessed at, and this is how well.
 *
 * **Only the slopes are measured.** OLS passes through the sample mean, so each
 * intercept *is* `mean − slope × meanThumbValue` and is computed here rather
 * than typed. That is not tidiness: it is what makes the two chains coincide
 * exactly at the corpus mean for every family, which `tint.test.ts` asserts to
 * 1e-12. Typing the intercepts to six decimals instead left the two chains
 * 2 × 10⁻⁷ apart — nothing to look at, but a claim of exactness that was not
 * true of the numbers as shipped.
 */
const SHADING_SLOPE = 1.004_48
const SHEEN_SLOPE = 0.545_788

export const THUMB_REGRESSION = {
  shading: {
    slope: SHADING_SLOPE,
    intercept: SPRITE_CORPUS.meanShading - SHADING_SLOPE * SPRITE_CORPUS.meanThumbValue,
    r2: 0.4993,
  },
  sheen: {
    slope: SHEEN_SLOPE,
    intercept: SPRITE_CORPUS.meanSheen - SHEEN_SLOPE * SPRITE_CORPUS.meanThumbValue,
    r2: 0.6128,
  },
} as const

/* ---------------------------------------------------------------- the matrix */

/** The 20 numbers of an `feColorMatrix values` attribute, row-major, RGBA. */
export type ColorMatrix = readonly [
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
]

/**
 * Assemble the 4×5 from three colour columns and three input weights.
 *
 * The alpha row is the identity `0 0 0 1 0`, and that is the whole of the
 * cutout handling: the sheets are RGBA with a transparent background, the
 * offsets in column 5 land on colour and never on alpha, and a fully
 * transparent pixel therefore stays fully transparent whatever colour the
 * offset gives it. That is what lets the filtered frame keep sitting on the
 * radial-gradient well instead of arriving as an opaque square.
 */
function colorMatrix(columns: readonly [Rgb, Rgb, Rgb], offset: Rgb): ColorMatrix {
  const [red, green, blue] = columns
  return [
    red[0], red[1], red[2], 0, offset[0],
    green[0], green[1], green[2], 0, offset[1],
    blue[0], blue[1], blue[2], 0, offset[2],
    0, 0, 0, 1, 0,
  ]
}

/**
 * The `sprite` chain: un-mix the blue render's two terms, re-mix them with the
 * family's own triple.
 *
 * `out = ambient_f + (shading · pixel + s₀) · diffuse_f + (sheen · pixel + k₀) · specular_f`,
 * flattened into one matrix. The offset is whatever makes the sheet's own
 * ambient land on the family's ambient, which is why nothing has to clamp: a
 * pixel at the darkest the renderer can produce comes out at the darkest the
 * family can.
 */
function spriteMatrix(material: MaterialId): ColorMatrix {
  const { ambient, diffuse, specular } = MATERIALS[material].sprite
  const familyAmbient = parseHex(ambient)
  const familyDiffuse = parseHex(diffuse)
  const familySpecular = parseHex(specular)

  const row = (channel: Channel): Rgb => [
    familyDiffuse[channel] * SHADING_COEFFICIENTS[0] + familySpecular[channel] * SHEEN_COEFFICIENTS[0],
    familyDiffuse[channel] * SHADING_COEFFICIENTS[1] + familySpecular[channel] * SHEEN_COEFFICIENTS[1],
    familyDiffuse[channel] * SHADING_COEFFICIENTS[2] + familySpecular[channel] * SHEEN_COEFFICIENTS[2],
  ]

  const columns: readonly [Rgb, Rgb, Rgb] = [row(0), row(1), row(2)]
  const offset: Rgb = [
    familyAmbient[0] - dot(columns[0], SHEET_AMBIENT),
    familyAmbient[1] - dot(columns[1], SHEET_AMBIENT),
    familyAmbient[2] - dot(columns[2], SHEET_AMBIENT),
  ]

  return colorMatrix(columns, offset)
}

/**
 * The `thumb` chain: estimate both terms from the one channel, then re-mix.
 *
 * The three input weights are {@link LUMA_COEFFICIENTS}, which for a genuinely
 * grey input simply read the value back — they sum to 1. They matter only when
 * the source is *not* grey, and then they are what makes a misdirected sprite
 * come out 1.38–4.51 ΔE00 wrong rather than arbitrarily wrong. See
 * {@link ThumbSource}.
 */
function thumbMatrix(material: MaterialId): ColorMatrix {
  const { ambient, diffuse, specular } = MATERIALS[material].sprite
  const familyAmbient = parseHex(ambient)
  const familyDiffuse = parseHex(diffuse)
  const familySpecular = parseHex(specular)

  const row = (channel: Channel): Rgb => {
    const gain =
      THUMB_REGRESSION.shading.slope * familyDiffuse[channel] +
      THUMB_REGRESSION.sheen.slope * familySpecular[channel]
    return [gain * LUMA_COEFFICIENTS[0], gain * LUMA_COEFFICIENTS[1], gain * LUMA_COEFFICIENTS[2]]
  }

  const value = (channel: Channel): number =>
    familyAmbient[channel] +
    THUMB_REGRESSION.shading.intercept * familyDiffuse[channel] +
    THUMB_REGRESSION.sheen.intercept * familySpecular[channel]

  return colorMatrix([row(0), row(1), row(2)], [value(0), value(1), value(2)])
}

/** The `feColorMatrix` for one family and one source. */
export function tintMatrix(material: MaterialId, source: ThumbSource): ColorMatrix {
  return source === 'sprite' ? spriteMatrix(material) : thumbMatrix(material)
}

/* ----------------------------------------------------------------- the sheet */

/**
 * The `filter` id for one family and one source.
 *
 * `filter: url(#id)` is a **document-scoped** fragment reference, so these are
 * page-global names and have to be unambiguous across the whole app, not just
 * within a thumbnail. Both the source and the family are in the name because
 * both sets are mounted at once — see `ui/thumb/TintFilters.tsx`.
 */
export function tintFilterId(material: MaterialId, source: ThumbSource): string {
  return `of-tint-${source}-${material}`
}

/** One entry of the mounted sheet. */
export interface TintFilter {
  readonly id: string
  readonly material: MaterialId
  readonly source: ThumbSource
  readonly values: ColorMatrix
}

const SOURCES: readonly ThumbSource[] = ['sprite', 'thumb']

/**
 * Every filter the page mounts: 16 families × 2 sources = 32.
 *
 * Both sources are here although only `sprite` has any pixels to point at
 * today — 56 of 8,352 thumbnails exist, and the backfill is blocked on B1 and
 * B2. Thirty-two inert `<feColorMatrix>` elements cost nothing until something
 * references one, and it makes P3's switch a change of one argument rather than
 * a second piece of filter plumbing to build under a deadline.
 */
export const TINT_FILTERS: readonly TintFilter[] = SOURCES.flatMap((source) =>
  MATERIAL_ORDER.map((material) => ({
    id: tintFilterId(material, source),
    material,
    source,
    values: tintMatrix(material, source),
  })),
)

/**
 * What a thumbnail renders as when the caller has not said which material it is.
 *
 * `unknown`, deliberately — the same family `resolveMaterial` returns for the 89
 * tiles that carry no `texture|` tag at all. It is the palette's only chroma-zero
 * entry and its whole brief is that absence of colour means absence of a claim,
 * which is exactly the claim a component that was not told the material is in a
 * position to make. Measured at the corpus-mean pixel it lands on CIELAB
 * (35.204, 0.064, 0.762) — chroma **0.76**, so it reads as a grey model photo
 * and not as a guess. (Not exactly zero: all sixteen families share the warm
 * `#6b6357` specular, so the sheen carries a trace of hue even here.)
 *
 * The alternative default was no filter at all, i.e. leaving the blue. That was
 * rejected on the numbers at the top of this file: the blue is 31.88 ΔE00 from
 * the palette on average and 14.82 from `water`, so it is not the neutral
 * option — `unknown` is. A caller that knows better passes `material`.
 */
export const DEFAULT_THUMB_MATERIAL: MaterialId = 'unknown'
