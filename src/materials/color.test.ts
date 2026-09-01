/**
 * The colour maths, validated before anything is measured with it.
 *
 * `palette.test.ts` uses `deltaE2000` to decide whether the palette is
 * separated enough to ship. A metric that is subtly wrong will happily report a
 * comfortable number, so this suite establishes that the instrument is correct
 * first — against published reference data, not against itself.
 *
 * The load-bearing block is the Sharma–Wu–Dalal set. Their 34 pairs were
 * constructed specifically to break naive CIEDE2000 implementations: pairs
 * either side of the a* = ±2.49 hue discontinuity, achromatic samples with
 * undefined hue, and the 0/360° mean-hue wrap. An implementation that gets the
 * mean-hue branch wrong passes casual testing and fails these.
 */
import { describe, expect, it } from 'vitest'

import {
  VISION_MODELS,
  contourOklch,
  contrastRatio,
  deltaE2000,
  deltaE2000Hex,
  deltaE2000UnderVision,
  formatHex,
  hexToLab,
  hexUnderVision,
  labUnderVision,
  linearToSrgb,
  oklchToHex,
  parseHex,
  relativeLuminance,
  srgbToLinear,
} from './color'
import type { Lab } from './color'

/**
 * Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference Formula:
 * Implementation Notes, Supplementary Test Data and Mathematical Observations",
 * Table 1. `[L1, a1, b1, L2, a2, b2, expected ΔE00]`.
 */
const SHARMA: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
  [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
  [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
  [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0],
  [50, -1.1848, -84.8006, 50, 0, -82.7485, 1.0],
  [50, -0.9009, -85.5211, 50, 0, -82.7485, 1.0],
  [50, 0, 0, 50, -1, 2, 2.3669],
  [50, -1, 2, 50, 0, 0, 2.3669],
  [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
  [50, 2.49, -0.001, 50, -2.49, 0.001, 7.1792],
  [50, 2.49, -0.001, 50, -2.49, 0.0011, 7.2195],
  [50, 2.49, -0.001, 50, -2.49, 0.0012, 7.2195],
  [50, -0.001, 2.49, 50, 0.0009, -2.49, 4.8045],
  [50, -0.001, 2.49, 50, 0.001, -2.49, 4.8045],
  [50, -0.001, 2.49, 50, 0.0011, -2.49, 4.7461],
  [50, 2.5, 0, 50, 0, -2.5, 4.3065],
  [50, 2.5, 0, 73, 25, -18, 27.1492],
  [50, 2.5, 0, 61, -5, 29, 22.8977],
  [50, 2.5, 0, 56, -27, -3, 31.903],
  [50, 2.5, 0, 58, 24, 15, 19.4535],
  [50, 2.5, 0, 50, 3.1736, 0.5854, 1.0],
  [50, 2.5, 0, 50, 3.2972, 0, 1.0],
  [50, 2.5, 0, 50, 1.8634, 0.5757, 1.0],
  [50, 2.5, 0, 50, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
]

describe('deltaE2000', () => {
  it('matches all 34 Sharma–Wu–Dalal reference pairs to 1e-4', () => {
    expect(SHARMA).toHaveLength(34)
    for (const [l1, a1, b1, l2, a2, b2, expected] of SHARMA) {
      const first: Lab = [l1, a1, b1]
      const second: Lab = [l2, a2, b2]
      expect(deltaE2000(first, second)).toBeCloseTo(expected, 4)
    }
  })

  it('is symmetric, which the reference set only spot-checks', () => {
    for (const [l1, a1, b1, l2, a2, b2] of SHARMA) {
      const forward = deltaE2000([l1, a1, b1], [l2, a2, b2])
      const backward = deltaE2000([l2, a2, b2], [l1, a1, b1])
      expect(backward).toBeCloseTo(forward, 10)
    }
  })

  it('is zero for identical colours', () => {
    expect(deltaE2000Hex('#8f8c81', '#8f8c81')).toBe(0)
  })
})

describe('sRGB transfer functions', () => {
  it('round-trips every 8-bit code point', () => {
    for (let code = 0; code < 256; code += 1) {
      const encoded = code / 255
      expect(linearToSrgb(srgbToLinear(encoded))).toBeCloseTo(encoded, 12)
    }
  })

  it('anchors at the endpoints and the linear-segment join', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 12)
    // Continuity of the piecewise curve at the documented breakpoint.
    expect(0.04045 / 12.92).toBeCloseTo(Math.pow((0.04045 + 0.055) / 1.055, 2.4), 6)
  })
})

describe('hex parsing', () => {
  it('parses and re-formats losslessly', () => {
    for (const hex of ['#000000', '#ffffff', '#6b7280', '#a3d0e3', '#505050']) {
      expect(formatHex(parseHex(hex))).toBe(hex)
    }
  })

  it('rejects the shorthand and the eight-digit form rather than guessing', () => {
    // The eight-digit form is exactly the Lightning CSS minifier artefact PR 2
    // documented: `rgba(80,60,30,0.2)` ships as `#503c1e33`. Silently reading
    // the first six digits would be worse than throwing.
    expect(() => parseHex('#fff')).toThrow(/six-digit/)
    expect(() => parseHex('#503c1e33')).toThrow(/six-digit/)
    expect(() => parseHex('rgb(1,2,3)')).toThrow(/six-digit/)
  })

  it('clamps out-of-gamut channels when formatting', () => {
    expect(formatHex([-0.5, 0.5, 1.5])).toBe('#0080ff')
  })
})

describe('WCAG', () => {
  it('reproduces the reference luminances of black and white', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 12)
  })

  it('puts black on white at 21:1 and is order-independent', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 6)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 12)
  })
})

describe('OKLCH', () => {
  it('places pure white at L 1, chroma 0', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff')
    expect(oklchToHex(0, 0, 0)).toBe('#000000')
  })

  it('is hue-invariant at zero chroma', () => {
    const grey = oklchToHex(0.5, 0, 0)
    for (const hue of [0, 90, 180, 270, 359]) {
      expect(oklchToHex(0.5, 0, hue)).toBe(grey)
    }
  })

  it('clamps contour lightness at 0.36, which is the point of the rule', () => {
    // A fill lighter than L 0.5 scales freely…
    expect(contourOklch(0.718, 0.075, 91.7)[0]).toBeCloseTo(0.36, 12)
    // …and a fill already darker than the flat floor keeps its own scaling, so
    // the contour stays darker than the fill instead of haloing it.
    expect(contourOklch(0.308, 0.011, 285.8)[0]).toBeCloseTo(0.308 * 0.72, 12)
    // Chroma is always scaled; hue is always preserved.
    expect(contourOklch(0.5, 0.08, 123)[1]).toBeCloseTo(0.056, 12)
    expect(contourOklch(0.5, 0.08, 123)[2]).toBe(123)
  })
})

describe('CIELAB', () => {
  it('places the D65 white point at L* 100 with no chroma', () => {
    const [lightness, a, b] = hexToLab('#ffffff')
    expect(lightness).toBeCloseTo(100, 3)
    expect(a).toBeCloseTo(0, 2)
    expect(b).toBeCloseTo(0, 2)
  })

  it('places black at L* 0', () => {
    expect(hexToLab('#000000')[0]).toBeCloseTo(0, 6)
  })

  it('reads neutral greys as achromatic', () => {
    for (const grey of ['#505050', '#777777', '#cccccc']) {
      const [, a, b] = hexToLab(grey)
      expect(Math.hypot(a, b)).toBeLessThan(0.02)
    }
  })
})

describe('colour vision simulation', () => {
  it('covers normal vision plus the three dichromacies', () => {
    expect(VISION_MODELS).toEqual(['normal', 'protanopia', 'deuteranopia', 'tritanopia'])
  })

  it('leaves colours untouched under normal vision', () => {
    expect(hexUnderVision('#7c442b', 'normal')).toBe('#7c442b')
    expect(labUnderVision('#7c442b', 'normal')).toEqual(hexToLab('#7c442b'))
    expect(deltaE2000UnderVision('#7c442b', '#593931', 'normal')).toBeCloseTo(
      deltaE2000Hex('#7c442b', '#593931'),
      12,
    )
  })

  it('preserves neutrals under every dichromacy', () => {
    // A physiologically-based model must map an achromatic stimulus to an
    // achromatic response; a matrix transcription error usually breaks this
    // first, and it is cheap to check.
    for (const model of VISION_MODELS) {
      for (const grey of ['#000000', '#505050', '#808080', '#ffffff']) {
        const [, a, b] = labUnderVision(grey, model)
        expect(Math.hypot(a, b)).toBeLessThan(1.5)
      }
    }
  })

  it('collapses the confusion axis it is meant to collapse', () => {
    // Pure red against pure green is the protan/deutan confusion line: both
    // models must bring them far closer together than normal vision does.
    const normal = deltaE2000UnderVision('#ff0000', '#00ff00', 'normal')
    expect(deltaE2000UnderVision('#ff0000', '#00ff00', 'protanopia')).toBeLessThan(normal / 2)
    expect(deltaE2000UnderVision('#ff0000', '#00ff00', 'deuteranopia')).toBeLessThan(normal / 2)
    // And tritanopia must not: it is a blue-yellow deficiency.
    expect(deltaE2000UnderVision('#0000ff', '#ffff00', 'tritanopia')).toBeLessThan(
      deltaE2000UnderVision('#0000ff', '#ffff00', 'normal'),
    )
  })
})
