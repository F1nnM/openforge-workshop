/**
 * Measuring how blue the sheets actually are, so the tone decision is evidence.
 *
 * architecture-plan.md §8 records that `stl-thumb` renders in a default blue
 * Phong material (ambient `#002142`, diffuse peaking `#3375c8`) and that 99.8%
 * of opaque pixels are non-neutral. That figure is what rules out CSS-tinting
 * the existing PNGs, and it is equally the thing that decides whether the
 * cropped WebP should keep the colour or drop it — so this tool re-derives it
 * from every sheet it touches rather than trusting the inherited number.
 *
 * "Non-neutral" is defined as chroma above a threshold, where chroma is
 * `max(r,g,b) − min(r,g,b)` on the 0–255 scale. That is a crude measure and
 * deliberately so: it needs no colour-space conversion, it is exactly what
 * "this pixel is not grey" means, and the threshold is explicit so the number
 * cannot be quietly tuned to a nicer answer.
 */

export interface Neutrality {
  /** Pixels with alpha at or above the opacity threshold. */
  opaque: number
  /** Of those, how many carry chroma above the threshold. */
  nonNeutral: number
  /** `nonNeutral / opaque`, or 0 when the frame is entirely transparent. */
  share: number
  /** Mean chroma over the opaque pixels, 0–255. */
  meanChroma: number
  /** Mean channel values over the opaque pixels — the render's average colour. */
  mean: { r: number; g: number; b: number }
}

export interface NeutralityOptions {
  /** Alpha at or above which a pixel counts. Default 128. */
  alphaThreshold?: number
  /** Chroma above which a pixel is non-neutral. Default 8, ~3% of the scale. */
  chromaThreshold?: number
}

/**
 * Chroma statistics over a raw RGBA buffer.
 *
 * @throws when the buffer is not a whole number of RGBA pixels, because a
 * silently misaligned read would produce a plausible wrong answer.
 */
export function neutrality(rgba: Buffer, options: NeutralityOptions = {}): Neutrality {
  if (rgba.length % 4 !== 0) {
    throw new Error(`raw buffer of ${String(rgba.length)} bytes is not a whole number of RGBA pixels`)
  }
  const alphaThreshold = options.alphaThreshold ?? 128
  const chromaThreshold = options.chromaThreshold ?? 8

  let opaque = 0
  let nonNeutral = 0
  let chromaTotal = 0
  let rTotal = 0
  let gTotal = 0
  let bTotal = 0

  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] as number
    if (a < alphaThreshold) continue
    const r = rgba[i] as number
    const g = rgba[i + 1] as number
    const b = rgba[i + 2] as number
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    opaque += 1
    chromaTotal += chroma
    rTotal += r
    gTotal += g
    bTotal += b
    if (chroma > chromaThreshold) nonNeutral += 1
  }

  if (opaque === 0) {
    return { opaque: 0, nonNeutral: 0, share: 0, meanChroma: 0, mean: { r: 0, g: 0, b: 0 } }
  }
  return {
    opaque,
    nonNeutral,
    share: nonNeutral / opaque,
    meanChroma: chromaTotal / opaque,
    mean: { r: rTotal / opaque, g: gTotal / opaque, b: bTotal / opaque },
  }
}

/** Pool per-sheet results into one corpus-level figure. */
export function poolNeutrality(parts: readonly Neutrality[]): Neutrality {
  const opaque = parts.reduce((total, part) => total + part.opaque, 0)
  if (opaque === 0) return { opaque: 0, nonNeutral: 0, share: 0, meanChroma: 0, mean: { r: 0, g: 0, b: 0 } }
  const nonNeutral = parts.reduce((total, part) => total + part.nonNeutral, 0)
  const weighted = (pick: (part: Neutrality) => number): number =>
    parts.reduce((total, part) => total + pick(part) * part.opaque, 0) / opaque
  return {
    opaque,
    nonNeutral,
    share: nonNeutral / opaque,
    meanChroma: weighted((part) => part.meanChroma),
    mean: {
      r: weighted((part) => part.mean.r),
      g: weighted((part) => part.mean.g),
      b: weighted((part) => part.mean.b),
    },
  }
}
