/**
 * OpenForge Workshop — colour maths for the material registry.
 *
 * This is the *instrument*, not the palette. It exists because the palette in
 * `palette.ts` makes numeric claims — "no two families are closer than 9 ΔE00,
 * under normal vision and under three colour vision deficiencies" — and a claim
 * that nothing re-derives is a comment, not a guarantee. `palette.test.ts`
 * re-derives every one of them from the shipped hex literals using the
 * functions here, so editing a hex either keeps the claim true or fails CI.
 *
 * **No dependencies, by requirement.** Not three.js, not a colour library.
 * architecture-plan.md §4 withdrew TSL node materials, and §9's registry has to
 * be consumable from three places that cannot agree on a renderer: the v1
 * plan-view canvas (2D fills), a later `MeshStandardMaterial`, and the
 * build-time sprite renderer. So this module is arithmetic over numbers, and
 * nothing in `src/materials/` imports a renderer.
 *
 * **Colours come from `tokens.ts`, never from `getComputedStyle`.** PR 2
 * measured why: Lightning CSS rewrites the two `rgba()` tokens to eight-digit
 * hex at build time (`rgba(80,60,30,0.2)` ships as `#503c1e33`), which
 * `THREE.Color.setStyle()` cannot parse. The palette test imports `color` from
 * `@/tokens` for the same reason.
 *
 * ── Conventions, stated because they change the answer ──────────────────────
 *
 * - Hex strings are sRGB, `#rrggbb`, and are the authoritative form. Everything
 *   else is derived.
 * - CIELAB is D65-referred, using the sRGB primaries and the CIE 1931 2° white
 *   point. Not D50: the palette is judged on a screen, against screen tokens.
 * - `deltaE2000` is CIEDE2000 with kL = kC = kH = 1. It is validated against
 *   all 34 Sharma–Wu–Dalal (2005) test vectors in `color.test.ts` before
 *   `palette.test.ts` uses it to judge anything — an unvalidated metric that
 *   reports a comfortable number is worse than no metric.
 * - Colour vision deficiency uses the Machado, Oliveira & Fernandes (2009)
 *   matrices at severity 1.0, applied in **linear** sRGB, which is the space
 *   the paper derives them in. See `CVD_MATRICES` for what that costs.
 */

/** sRGB, gamma-encoded, each channel 0–1. */
export type Rgb = readonly [number, number, number]

/** Linear-light sRGB, each channel 0–1 (and briefly outside it, mid-simulation). */
export type LinearRgb = readonly [number, number, number]

/** CIELAB D65: L* 0–100, a*, b*. */
export type Lab = readonly [number, number, number]

type Matrix3 = readonly [Rgb, Rgb, Rgb]

/* ------------------------------------------------------------------- parsing */

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * Parse `#rrggbb` to gamma-encoded sRGB 0–1.
 *
 * Six-digit hex only. The three-digit and eight-digit forms are deliberately
 * rejected rather than handled: every colour this module sees is either a
 * palette literal from `palette.ts` or a token from `tokens.ts`, both of which
 * are six-digit by contract, and the eight-digit form is exactly the
 * minifier artefact PR 2 warned about. Failing loudly on one is the point.
 */
export function parseHex(hex: string): Rgb {
  if (!HEX_PATTERN.test(hex)) {
    throw new Error(`not a six-digit sRGB hex colour: ${hex}`)
  }
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Format gamma-encoded sRGB 0–1 as `#rrggbb`, clamping out-of-gamut channels. */
export function formatHex(rgb: Rgb): string {
  const channels = rgb.map((channel) =>
    Math.round(clamp01(channel) * 255)
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${channels.join('')}`
}

/* ------------------------------------------------------- transfer functions */

/** sRGB electro-optical transfer function, gamma-encoded → linear-light. */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
}

/** The inverse: linear-light → gamma-encoded. */
export function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055
}

function hexToLinear(hex: string): LinearRgb {
  const [r, g, b] = parseHex(hex)
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
}

function applyMatrix(matrix: Matrix3, vector: readonly [number, number, number]): [number, number, number] {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ]
}

/* ------------------------------------------------------------------ WCAG */

/**
 * WCAG 2.1 relative luminance.
 *
 * The coefficients are WCAG's own (0.2126 / 0.7152 / 0.0722), not the sRGB
 * matrix's slightly different Y row. They differ in the fifth decimal and the
 * success criterion is defined on these, so these are what a contrast claim
 * has to be computed from.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1–21. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/* ------------------------------------------------------------------- OKLCH */

const OKLAB_TO_LMS: Matrix3 = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
]

const LMS_TO_LINEAR: Matrix3 = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
]

/**
 * OKLCH → `#rrggbb`.
 *
 * OKLCH is the **authoring** space for this palette: `MaterialFamily.oklch` is
 * the edited value and `MaterialFamily.tint` is its sRGB projection. The
 * palette test asserts that projection for all 16 families, so the two cannot
 * silently disagree.
 *
 * It is also what derives the silhouette contour. §9's rule is
 * `oklch(min(0.36, L × 0.72), C × 0.70, H)` — see `contourOklch`.
 *
 * @param lightness perceptual lightness, 0–1
 * @param chroma    0 upward; the palette caps at 0.086
 * @param hue       degrees
 */
export function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180
  const lab: [number, number, number] = [
    lightness,
    chroma * Math.cos(radians),
    chroma * Math.sin(radians),
  ]
  const lms = applyMatrix(OKLAB_TO_LMS, lab)
  const cubed: [number, number, number] = [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]
  const linear = applyMatrix(LMS_TO_LINEAR, cubed)
  return formatHex([linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])])
}

/**
 * The silhouette contour for a fill, in OKLCH.
 *
 * architecture-plan.md §9: on a light ground, meeting WCAG 1.4.11's 3:1 with
 * fills alone would force every material below L* 50, which turns plaster,
 * sandstone and ice into wrong guesses. The 3:1 obligation is therefore carried
 * by a dedicated dark contour, and the fill band is freed.
 *
 * **`Math.min` is load-bearing, not defensive.** A flat 0.36 would sit *above*
 * `metal`'s own fill lightness (0.308) and draw a halo round the darkest family
 * instead of a contour. `palette.test.ts` asserts that specific failure so the
 * clamp cannot be "simplified" away.
 */
export function contourOklch(
  lightness: number,
  chroma: number,
  hue: number,
): readonly [number, number, number] {
  return [Math.min(0.36, lightness * 0.72), chroma * 0.7, hue]
}

/* ------------------------------------------------------------------ CIELAB */

/** sRGB primaries → XYZ, D65 (Lindbloom's sRGB/D65 matrix). */
const LINEAR_TO_XYZ: Matrix3 = [
  [0.4123907993, 0.3575843394, 0.1804807884],
  [0.2126390059, 0.7151686788, 0.0721923154],
  [0.0193308187, 0.1191947798, 0.9505321522],
]

/** CIE 1931 2° D65 white point, the reference the sRGB matrix above is chromatically adapted to. */
const D65: readonly [number, number, number] = [0.9504559271, 1, 1.0890577508]

const LAB_EPSILON = 216 / 24389
const LAB_KAPPA = 841 / 108

function labTransfer(ratio: number): number {
  return ratio > LAB_EPSILON ? Math.cbrt(ratio) : LAB_KAPPA * ratio + 4 / 29
}

/** Linear-light sRGB → CIELAB D65. */
export function linearRgbToLab(rgb: LinearRgb): Lab {
  const xyz = applyMatrix(LINEAR_TO_XYZ, rgb)
  const fx = labTransfer(xyz[0] / D65[0])
  const fy = labTransfer(xyz[1] / D65[1])
  const fz = labTransfer(xyz[2] / D65[2])
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** `#rrggbb` → CIELAB D65. */
export function hexToLab(hex: string): Lab {
  return linearRgbToLab(hexToLinear(hex))
}

/* --------------------------------------------------------------- CIEDE2000 */

/**
 * CIEDE2000 colour difference, kL = kC = kH = 1.
 *
 * Written out rather than pulled from a package: the registry ships with no
 * dependencies, and this is the one number the whole palette rests on, so it
 * should be inspectable here. `color.test.ts` runs all 34 Sharma–Wu–Dalal
 * (2005) test vectors — including the discontinuity cases around a* = ±2.49
 * that a naive mean-hue implementation gets wrong — and every one matches to
 * 1e-4 before `palette.test.ts` is allowed to draw a conclusion from it.
 */
export function deltaE2000(first: Lab, second: Lab): number {
  const [l1, a1, b1] = first
  const [l2, a2, b2] = second

  const c1 = Math.hypot(a1, b1)
  const c2 = Math.hypot(a2, b2)
  const cMean = (c1 + c2) / 2
  const cMean7 = Math.pow(cMean, 7)
  const g = 0.5 * (1 - Math.sqrt(cMean7 / (cMean7 + Math.pow(25, 7))))

  const a1p = (1 + g) * a1
  const a2p = (1 + g) * a2
  const c1p = Math.hypot(a1p, b1)
  const c2p = Math.hypot(a2p, b2)

  // Hue of an achromatic sample is undefined; CIEDE2000 defines it as 0 so the
  // ΔH' term drops out via the c1p·c2p = 0 guards below.
  const h1p = c1p === 0 ? 0 : ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360
  const h2p = c2p === 0 ? 0 : ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360

  const deltaLp = l2 - l1
  const deltaCp = c2p - c1p

  let deltaHueDeg = 0
  if (c1p * c2p !== 0) {
    deltaHueDeg = h2p - h1p
    if (deltaHueDeg > 180) deltaHueDeg -= 360
    else if (deltaHueDeg < -180) deltaHueDeg += 360
  }
  const deltaHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((deltaHueDeg * Math.PI) / 360)

  const lMeanP = (l1 + l2) / 2
  const cMeanP = (c1p + c2p) / 2

  let hMeanP: number
  if (c1p * c2p === 0) {
    hMeanP = h1p + h2p
  } else if (Math.abs(h1p - h2p) <= 180) {
    hMeanP = (h1p + h2p) / 2
  } else {
    hMeanP = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2
  }

  const t =
    1 -
    0.17 * Math.cos(((hMeanP - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hMeanP * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hMeanP + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hMeanP - 63) * Math.PI) / 180)

  const deltaTheta = 30 * Math.exp(-Math.pow((hMeanP - 275) / 25, 2))
  const cMeanP7 = Math.pow(cMeanP, 7)
  const rc = 2 * Math.sqrt(cMeanP7 / (cMeanP7 + Math.pow(25, 7)))
  const rt = -Math.sin((2 * deltaTheta * Math.PI) / 180) * rc

  const sl = 1 + (0.015 * Math.pow(lMeanP - 50, 2)) / Math.sqrt(20 + Math.pow(lMeanP - 50, 2))
  const sc = 1 + 0.045 * cMeanP
  const sh = 1 + 0.015 * cMeanP * t

  const termL = deltaLp / sl
  const termC = deltaCp / sc
  const termH = deltaHp / sh
  return Math.sqrt(termL * termL + termC * termC + termH * termH + rt * termC * termH)
}

/** `#rrggbb` pair → CIEDE2000. */
export function deltaE2000Hex(first: string, second: string): number {
  return deltaE2000(hexToLab(first), hexToLab(second))
}

/* ----------------------------------------------------- colour vision models */

/**
 * The four vision conditions the palette is simultaneously separated under.
 *
 * Dichromacy is not an edge case here: the registry's whole job is to make 16
 * greys, browns and blue-greys distinguishable at thumbnail scale, and a
 * separation that only holds for trichromats has not done that job. §9 records
 * that the six-entry map this palette replaced measured a minimum of 5.42 ΔE00
 * with every entry inside a 15° hue band the parchment ground itself occupies.
 */
export type VisionModel = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia'

export const VISION_MODELS: readonly VisionModel[] = [
  'normal',
  'protanopia',
  'deuteranopia',
  'tritanopia',
]

/**
 * Machado, Oliveira & Fernandes (2009), "A Physiologically-based Model for
 * Simulation of Color Vision Deficiency", severity 1.0.
 *
 * **Applied in linear sRGB**, which is the space the paper derives them in.
 * This is the one place where the convention visibly changes the answer, so it
 * is stated rather than assumed: applying the same matrices to gamma-encoded
 * sRGB — as several browser and JS implementations do — moves the palette's
 * worst-case minimum by about 0.3 ΔE00 and changes *which pair* is worst
 * (`cut_stone`/`necro` under deuteranopia in linear light; `wood`/`brick` under
 * protanopia in gamma-encoded light). `palette.test.ts` pins the measured
 * numbers under this convention, and `palette.ts` records what the design pass
 * reported under its own.
 */
const CVD_MATRICES: Readonly<Record<Exclude<VisionModel, 'normal'>, Matrix3>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

/**
 * A colour as perceived under one vision model, in CIELAB.
 *
 * Returned as Lab rather than hex on purpose: quantising the simulated colour
 * back to 8-bit hex before measuring throws away up to 0.1 ΔE00 of the very
 * quantity being measured, and the simulated colour is never displayed.
 */
export function labUnderVision(hex: string, model: VisionModel): Lab {
  const linear = hexToLinear(hex)
  if (model === 'normal') return linearRgbToLab(linear)
  const simulated = applyMatrix(CVD_MATRICES[model], linear)
  return linearRgbToLab([clamp01(simulated[0]), clamp01(simulated[1]), clamp01(simulated[2])])
}

/** A colour as perceived under one vision model, as `#rrggbb`. For eyeballing, not measuring. */
export function hexUnderVision(hex: string, model: VisionModel): string {
  if (model === 'normal') return hex.toLowerCase()
  const simulated = applyMatrix(CVD_MATRICES[model], hexToLinear(hex))
  return formatHex([
    linearToSrgb(clamp01(simulated[0])),
    linearToSrgb(clamp01(simulated[1])),
    linearToSrgb(clamp01(simulated[2])),
  ])
}

/** CIEDE2000 between two hex colours, both seen under the same vision model. */
export function deltaE2000UnderVision(first: string, second: string, model: VisionModel): number {
  return deltaE2000(labUnderVision(first, model), labUnderVision(second, model))
}
