/**
 * The two numbers that decide how many samples the room is drawn from.
 *
 * Both were changed together to answer one report — *"the 3d render seems
 * pixelated"* — and neither is self-evidently right, so both are pinned here
 * against the specific way they were wrong before.
 *
 * The stack had **no multisampling at all**: `STAGE_GL` sets `antialias: false`
 * on the context, which is correct for a post-processing chain, and nothing set
 * `multisampling` on the `EffectComposer`, which defaults to 0. So geometry was
 * rasterised with one sample per pixel and `SMAAEffect` reconstructed every
 * silhouette from a hard-stepped image. And `DPR_BAND` had a ceiling but no
 * floor, so a display reporting `devicePixelRatio` **1.1** — the owner's — got a
 * buffer 10% larger than the CSS box to hide those steps in.
 *
 * Measured over the same 128 × 72 crop of the same tile edge, as the summed
 * absolute second difference (a hard step is a spike, an antialiased ramp is
 * spread out): **292,140** before, **235,741** with 4× MSAA alone (−19.3%), and
 * **180,530** with the dpr floor as well (−38.2%).
 */
import { describe, expect, it } from 'vitest'

import { DPR_BAND, STAGE_MSAA_SAMPLES, devicePixels, stageSamples } from './frame'

describe('the dpr band', () => {
  it('has a floor, which is the half that was missing', () => {
    const [min] = DPR_BAND
    expect(min).toBeGreaterThan(1)
    // The specific case in the report: a display at 1.1 used to back a 1164 px
    // canvas with 1280 device pixels. It now supersamples instead.
    expect(devicePixels(1164, 1.1)).toBe(2328)
    // And a plain 1× monitor — the worst case the old band left alone entirely.
    expect(devicePixels(288, 1)).toBe(576)
  })

  it('still caps, so no device renders more than it already could', () => {
    // The cap is the original reason the band exists: a 3× phone tripling the
    // AO pass's fragment cost for detail invisible at 288 px. Raising the floor
    // must not have raised the ceiling with it — this is what makes the change
    // safe to describe as "nothing renders more than before".
    const [, max] = DPR_BAND
    expect(max).toBe(2)
    expect(devicePixels(288, 3)).toBe(devicePixels(288, 2))
  })
})

describe('the composer’s sample count', () => {
  it('asks for four where the context allows it', () => {
    // 8 is what the machine this was measured on reports. Four resolves these
    // edges and costs half the target memory of eight.
    expect(stageSamples(8)).toBe(STAGE_MSAA_SAMPLES)
    expect(stageSamples(4)).toBe(4)
  })

  it('asks for nothing on WebGL 1, where maxSamples is 0', () => {
    // The guard that makes this safe to ship without a capability branch at the
    // call site: no multisampled render targets exist there, and the chain
    // degrades to exactly what it did before — SMAA alone.
    expect(stageSamples(0)).toBe(0)
  })

  it('clamps down to a context that supports fewer, rather than up', () => {
    // The direction a `Math.max` would have got backwards.
    expect(stageSamples(2)).toBe(2)
  })

  it('treats a missing or nonsense reading as no multisampling', () => {
    expect(stageSamples(Number.NaN)).toBe(0)
    expect(stageSamples(-1)).toBe(0)
  })
})
