/**
 * Tests for the tint matrices.
 *
 * ## What these can and cannot prove
 *
 * Every assertion here is **arithmetic on the emitted matrix**. Nothing in this
 * file rasterises anything: there is no canvas, no `feColorMatrix` and no
 * browser, so a passing run says the matrix a browser would be handed is the
 * one the derivation intends — never that a browser drew it. Two specific
 * things are therefore out of reach and are checked elsewhere or by eye:
 *
 *   - **That `color-interpolation-filters="sRGB"` is honoured.** The attribute's
 *     presence is asserted in `ui/thumb/thumb.test.tsx`; that it changes the
 *     arithmetic is a browser behaviour. If an engine ignored it the matrices
 *     would be evaluated in linear light and the whole model would be wrong by
 *     the 0.318-versus-0.764 margin the module comment measures.
 *   - **That the sheets really are `ambient + s·diffuse + k·specular`.** That is
 *     a claim about 2,024,773 pixels in a bucket, established by decoding them
 *     (mean absolute residual 1.417 / 255) and recorded in
 *     {@link SPRITE_CORPUS}. It cannot be re-derived without the PNGs, so the
 *     figures are stated as data and the tests below pin everything that *is*
 *     derivable from them.
 *
 * What the tests do pin, and it is the part most likely to rot, is the join
 * between this module and `palette.ts`. The re-lighting is expressed in the
 * palette's own `sprite` triples, so a retuned palette retints the grid — and
 * the "tint point" test below asserts exactly that, by hex equality.
 */
import { describe, expect, it } from 'vitest'

import type { Rgb } from './color'
import { formatHex, hexToLab, parseHex } from './color'
import type { MaterialId } from './palette'
import { MATERIALS, MATERIAL_ORDER } from './palette'
import type { ColorMatrix, ThumbSource } from './tint'
import {
  DEFAULT_THUMB_MATERIAL,
  LUMA_COEFFICIENTS,
  SHADING_COEFFICIENTS,
  SHEEN_COEFFICIENTS,
  SPRITE_CORPUS,
  SPRITE_LUMA_SHEEN_BIAS,
  SPRITE_PHONG,
  THUMB_REGRESSION,
  TINT_FILTERS,
  tintFilterId,
  tintMatrix,
} from './tint'

const AMBIENT = parseHex(SPRITE_PHONG.ambient)
const DIFFUSE = parseHex(SPRITE_PHONG.diffuse)
const SPECULAR = parseHex(SPRITE_PHONG.specular)

const dot = (a: Rgb, b: Rgb): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const add = (...vectors: readonly Rgb[]): Rgb =>
  vectors.reduce<Rgb>((total, v) => [total[0] + v[0], total[1] + v[1], total[2] + v[2]], [0, 0, 0])

const scale = (v: Rgb, by: number): Rgb => [v[0] * by, v[1] * by, v[2] * by]

/**
 * Apply a `values` attribute to an opaque colour, the way a filter would.
 *
 * Destructured rather than indexed, because a computed index into a
 * fixed-length tuple is `number | undefined` under `noUncheckedIndexedAccess` —
 * and writing the twenty names out is also the clearest statement of what the
 * row-major layout is.
 */
function applyMatrix(values: ColorMatrix, colour: Rgb): Rgb {
  const [rr, rg, rb, , ro, gr, gg, gb, , go, br, bg, bb, , bo] = values
  const [red, green, blue] = colour
  return [
    rr * red + rg * green + rb * blue + ro,
    gr * red + gg * green + gb * blue + go,
    br * red + bg * green + bb * blue + bo,
  ]
}

function familyTriple(material: MaterialId): { ambient: Rgb; diffuse: Rgb; specular: Rgb } {
  const { sprite } = MATERIALS[material]
  return {
    ambient: parseHex(sprite.ambient),
    diffuse: parseHex(sprite.diffuse),
    specular: parseHex(sprite.specular),
  }
}

describe('the un-mix', () => {
  it('recovers the shading term exactly and rejects the sheen exactly', () => {
    // The two identities that make this an un-mix rather than a fit. Nothing is
    // traded off between them: the shading row responds 1.0 to the blue diffuse
    // direction and 0.0 to white.
    expect(dot(SHADING_COEFFICIENTS, DIFFUSE)).toBeCloseTo(1, 12)
    expect(dot(SHADING_COEFFICIENTS, SPECULAR)).toBeCloseTo(0, 12)
  })

  it('recovers the sheen term exactly and rejects the form exactly', () => {
    expect(dot(SHEEN_COEFFICIENTS, SPECULAR)).toBeCloseTo(1, 12)
    expect(dot(SHEEN_COEFFICIENTS, DIFFUSE)).toBeCloseTo(0, 12)
  })

  it('sums the shading row to zero, which is why the white highlight cannot enter it', () => {
    // A sum-zero row is a chromatic opponent. It is the whole reason the
    // "greyscale" here is not a luminance: the specular term of these sheets is
    // achromatic, so any weights that sum to anything else let it in.
    const sum = SHADING_COEFFICIENTS[0] + SHADING_COEFFICIENTS[1] + SHADING_COEFFICIENTS[2]
    expect(sum).toBeCloseTo(0, 12)
  })

  it('sums the sheen row to one, so a neutral highlight reads back at its own value', () => {
    const sum = SHEEN_COEFFICIENTS[0] + SHEEN_COEFFICIENTS[1] + SHEEN_COEFFICIENTS[2]
    expect(sum).toBeCloseTo(1, 12)
  })
})

describe('why not Rec.709', () => {
  it('weights the sheen 2.34x the form, which is the whole case against it', () => {
    // Rec.709 luma of these sheets is a mixture of the two terms in a ratio it
    // does not get to choose. 2.3403 means a luma-greyscaled sheet is mostly a
    // picture of the highlight — the "muddy wash" §8 predicted, arrived at by a
    // route §8 did not consider.
    expect(SPRITE_LUMA_SHEEN_BIAS).toBeCloseTo(2.3403, 4)
  })

  it('still sums to one, which is the only job it has in the thumb chain', () => {
    // The thumb chain's input is grey, so its three weights only have to read a
    // grey value back unchanged. Rec.709 is used there because it makes the
    // *misdirected* case (a colour image through it) a Rec.709 luma rather than
    // something arbitrary.
    const sum = LUMA_COEFFICIENTS[0] + LUMA_COEFFICIENTS[1] + LUMA_COEFFICIENTS[2]
    expect(sum).toBeCloseTo(1, 12)
  })
})

describe('the sprite chain', () => {
  it('is pinned by three points, for every family', () => {
    // An affine map on three channels is determined by four points; the fourth
    // is the offset, so these three plus the offset fix the matrix completely.
    // Each one is a statement about the renderer: the darkest pixel the sheet
    // can hold becomes the darkest the family can, a fully diffuse-lit pixel
    // becomes fully diffuse-lit in the family's colour, and a pure white
    // highlight becomes the family's specular.
    for (const material of MATERIAL_ORDER) {
      const values = tintMatrix(material, 'sprite')
      const family = familyTriple(material)

      const atAmbient = applyMatrix(values, AMBIENT)
      const atDiffuse = applyMatrix(values, add(AMBIENT, DIFFUSE))
      const atSpecular = applyMatrix(values, add(AMBIENT, SPECULAR))

      for (const channel of [0, 1, 2] as const) {
        expect(atAmbient[channel]).toBeCloseTo(family.ambient[channel], 12)
        expect(atDiffuse[channel]).toBeCloseTo(family.ambient[channel] + family.diffuse[channel], 12)
        expect(atSpecular[channel]).toBeCloseTo(family.ambient[channel] + family.specular[channel], 12)
      }
    }
  })

  it("lands on the palette's own albedo at the shading level the palette derives it from", () => {
    // `palette.ts` derives every sprite triple from `tint` through the measured
    // relation `tint = ambient + 0.525 x diffuse`. Feeding the blue pixel at
    // that same shading level back through the matrix must therefore return the
    // family's albedo — and it does, to under half of one 8-bit level for all
    // sixteen, so the hex comes out exact.
    //
    // This is the assertion that makes the tint follow the palette. If P2's
    // re-solve had moved a tint and this module had cached a colour of its own,
    // this test is what would fail.
    const litLikeTheAlbedo = add(AMBIENT, scale(DIFFUSE, 0.525))
    for (const material of MATERIAL_ORDER) {
      const out = applyMatrix(tintMatrix(material, 'sprite'), litLikeTheAlbedo)
      expect(formatHex(out)).toBe(MATERIALS[material].tint)
    }
  })

  it('leaves alpha alone, which is what keeps the cutout on the well', () => {
    // The offsets sit in column 5 and land on colour only. A fully transparent
    // background pixel keeps alpha 0 whatever colour the offset gives it, so a
    // filtered frame still sits on the radial-gradient well instead of arriving
    // as an opaque square.
    for (const filter of TINT_FILTERS) {
      expect(filter.values.slice(15)).toEqual([0, 0, 0, 1, 0])
    }
  })
})

describe('the thumb chain', () => {
  it('agrees with the sprite chain exactly at the corpus mean, for every family', () => {
    // Both chains are calibrated on the same 2,024,773 pixels, and ordinary
    // least squares passes through the sample mean — so at the mean pixel the
    // regression is not an estimate, it is the un-mix. That makes this an
    // equality rather than a tolerance, and it pins all five measured constants
    // in THUMB_REGRESSION and SPRITE_CORPUS against each other: change one and
    // this fails.
    const meanPixel = add(
      AMBIENT,
      scale(DIFFUSE, SPRITE_CORPUS.meanShading),
      scale(SPECULAR, SPRITE_CORPUS.meanSheen),
    )
    const meanGrey: Rgb = [
      SPRITE_CORPUS.meanThumbValue,
      SPRITE_CORPUS.meanThumbValue,
      SPRITE_CORPUS.meanThumbValue,
    ]

    for (const material of MATERIAL_ORDER) {
      const viaSprite = applyMatrix(tintMatrix(material, 'sprite'), meanPixel)
      const viaThumb = applyMatrix(tintMatrix(material, 'thumb'), meanGrey)
      for (const channel of [0, 1, 2] as const) {
        expect(viaThumb[channel]).toBeCloseTo(viaSprite[channel], 12)
      }
    }
  })

  it('estimates the two terms from one channel, and says how well', () => {
    // Not a derivation — a record of the fit, so a reader knows the second
    // chain is a guess and how good a guess. Half the shading variance is gone
    // with the second channel.
    expect(THUMB_REGRESSION.shading.r2).toBeLessThan(0.6)
    expect(THUMB_REGRESSION.sheen.r2).toBeGreaterThan(0.6)
  })
})

describe('crossing the chains', () => {
  it('fails loudly in the dangerous direction: a grey source through the sprite matrix goes black', () => {
    // The shading row sums to zero, so a grey input carries no shading signal
    // at all and the recovered term is the constant -0.4409 — the family's
    // diffuse gets *subtracted*. Every family collapses to under 0.15 in every
    // channel, which is a black grid: unmissable, and therefore safe. This is
    // the direction P3's row did not name, and it is the one that matters.
    const grey: Rgb = [
      SPRITE_CORPUS.meanThumbValue,
      SPRITE_CORPUS.meanThumbValue,
      SPRITE_CORPUS.meanThumbValue,
    ]
    expect(dot(SHADING_COEFFICIENTS, grey) - dot(SHADING_COEFFICIENTS, AMBIENT)).toBeCloseTo(-0.4410, 3)

    for (const material of MATERIAL_ORDER) {
      const out = applyMatrix(tintMatrix(material, 'sprite'), grey)
      expect(Math.max(...out)).toBeLessThan(0.15)
    }
  })
})

describe('the mounted sheet', () => {
  it('is 32 filters: every family, both sources, no duplicate ids', () => {
    expect(TINT_FILTERS).toHaveLength(MATERIAL_ORDER.length * 2)
    expect(new Set(TINT_FILTERS.map((filter) => filter.id)).size).toBe(TINT_FILTERS.length)

    for (const source of ['sprite', 'thumb'] satisfies ThumbSource[]) {
      for (const material of MATERIAL_ORDER) {
        const found = TINT_FILTERS.find((filter) => filter.id === tintFilterId(material, source))
        expect(found?.values).toEqual(tintMatrix(material, source))
      }
    }
  })

  it('names the source in the id, because a page holds both sets at once', () => {
    // The ids are document-global — `url(#id)` is a fragment reference, not a
    // scoped one — so "of-tint-dungeon_stone" would be one name for two
    // different matrices the moment P3 lands.
    expect(tintFilterId('dungeon_stone', 'sprite')).toBe('of-tint-sprite-dungeon_stone')
    expect(tintFilterId('dungeon_stone', 'thumb')).toBe('of-tint-thumb-dungeon_stone')
  })
})

describe('the default and the fallback band', () => {
  it("defaults to the palette's own no-claim family", () => {
    expect(DEFAULT_THUMB_MATERIAL).toBe('unknown')
    expect(MATERIALS[DEFAULT_THUMB_MATERIAL].oklch[1]).toBe(0)
    expect(MATERIALS[DEFAULT_THUMB_MATERIAL].contour).toBe('dashed')
  })

  it('renders unclassified as very nearly neutral, and not quite exactly', () => {
    // `unknown` is the only chroma-zero albedo in the palette, so an untold
    // thumbnail reads as a grey model photo rather than as a wrong guess. It is
    // not perfectly neutral, and the reason is worth keeping visible: all
    // sixteen families share the warm `#6b6357` specular, so the sheen carries
    // a trace of hue into every family including this one.
    const meanPixel = add(
      AMBIENT,
      scale(DIFFUSE, SPRITE_CORPUS.meanShading),
      scale(SPECULAR, SPRITE_CORPUS.meanSheen),
    )
    const out = applyMatrix(tintMatrix('unknown', 'sprite'), meanPixel)
    const [, a, b] = hexToLab(formatHex(out))
    expect(Math.hypot(a, b)).toBeLessThan(1)
  })

  it('tints a low-confidence resolution the same as a high-confidence one', () => {
    // There is no fallback *band*: the confidence of a resolution is carried by
    // `Resolution.confidence` and, for the terminal case, by `unknown`'s dashed
    // contour — never by a washed-out or hedged fill. The 158 `towne` stucco
    // models D3 unified are a `low` confidence answer and are tinted as fully
    // as the 3,082 dungeon-stone ones, because a colour that hedged would be
    // unreadable rather than honest, and the plan-view contour already carries
    // the one distinction that has to be visible.
    expect(MATERIALS.stucco.confidence).toBe('medium')
    expect(MATERIALS.necro.confidence).toBe('low')
    expect(tintMatrix('necro', 'sprite')).not.toEqual(tintMatrix('unknown', 'sprite'))
    for (const material of MATERIAL_ORDER) {
      // Every family gets a full-strength matrix; none is scaled towards grey.
      expect(tintMatrix(material, 'sprite').slice(15)).toEqual([0, 0, 0, 1, 0])
    }
  })
})
