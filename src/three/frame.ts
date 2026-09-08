/**
 * The frame every 3D surface in this app shares, as numbers — and **nothing
 * imports a renderer to read it**.
 *
 * These values used to live in `Stage.tsx`, which is their natural home right up
 * until a second surface needs them. Two now do:
 *
 *  - `subjects.ts` and `SharedPreview.tsx` — the shared canvas's registry and its
 *    per-card slot — need the camera position, the orbit band and the device
 *    pixel-ratio cap. They must stay **free of three.js**, because a catalog card
 *    renders a slot and a card is in the entry chunk: one static import of
 *    `Stage.tsx` from that side of the line would move three, r3f, drei,
 *    `postprocessing` and n8ao — ~420 kB gzipped — into the bundle every visitor
 *    downloads, with nothing failing. `boundary.test.ts` asserts it.
 *  - `geometry.ts` normalises meshes to {@link VIEW_RADIUS} and re-exports it, so
 *    the modules that already import it from there keep working.
 *
 * So the numbers are here and the *reasoning* stays where it was measured:
 * `Stage.tsx` says why the camera sits at 3.0 rather than at the 3.49 a bounding
 * sphere would need, and `geometry.ts` says why every mesh is normalised at all.
 * This file is the one place both can read them from.
 */

/**
 * Bounding-sphere radius every model is scaled to. The AO radius is tuned
 * against it.
 *
 * One number for the whole corpus is what makes a single tuned occlusion radius
 * correct for a 25 mm floor tile and a 300 mm boss door — see `geometry.ts`.
 */
export const VIEW_RADIUS = 1

/** Vertical field of view, in degrees. */
export const CAMERA_FOV = 32

export const CAMERA_NEAR = 0.05

/** Far plane. A unit-radius subject at {@link CAMERA_DISTANCE} is nowhere near it. */
export const CAMERA_FAR = 40

/** Camera distance for a unit-radius model. `Stage.tsx` explains the choice of 3.0. */
export const CAMERA_DISTANCE = 3.0

/**
 * Where the camera starts: a three-quarter view from above.
 *
 * The direction is a unit vector to within 2 × 10⁻⁴, so the eye sits at
 * {@link CAMERA_DISTANCE} from the origin. `subjects.ts` reads this and converts
 * it to spherical coordinates, which is what makes a shared-canvas slot's first
 * frame identical to the detail drawer's first frame.
 */
export const CAMERA_POSITION: readonly [number, number, number] = [
  CAMERA_DISTANCE * 0.52,
  CAMERA_DISTANCE * 0.46,
  CAMERA_DISTANCE * 0.72,
]

/** Nearest the orbit may come. drei's `minDistance`, and the shared canvas's clamp. */
export const ORBIT_MIN_DISTANCE = VIEW_RADIUS * 1.5

/** Furthest the orbit may go. drei's `maxDistance`, and the shared canvas's clamp. */
export const ORBIT_MAX_DISTANCE = VIEW_RADIUS * 9

/** How fast a drag rotates. drei's `rotateSpeed`; `subjects.ts` mirrors the gesture. */
export const ORBIT_ROTATE_SPEED = 0.9

/**
 * Device pixel-ratio band, `[min, max]`. Both ends are 2, and each is a separate
 * argument.
 *
 * **The cap** is the original one and its reason is unchanged: uncapped dpr on a
 * 3× phone triples the fragment cost of the AO pass for detail nobody can see at
 * 288 px.
 *
 * **The floor** is new, and it is the other half of the same thought. The band
 * had a ceiling to stop a dense display over-sampling and nothing at all to stop
 * a sparse one under-sampling — so a 1× monitor rendered the room at exactly CSS
 * size, with one sample per pixel and a morphological pass to tidy up after it.
 * Measured on the owner's display, `devicePixelRatio` is **1.1**: a 1164 × 713
 * canvas backed onto 1280 × 784, and the result reads as pixelated because it
 * very nearly is. Held at 2 the same canvas backs onto 2327 × 1425 and the
 * downsample to CSS size is a supersample.
 *
 * The two ends meeting is what makes this safe to state plainly: **no device now
 * renders more than the cap already allowed it to**. A retina screen is where it
 * always was; what changed is that a cheap monitor is no longer given the worst
 * image of the lot. Measured over a 671-frame orbit drag at 2×, the frame
 * interval was 16.7 ms at both the median and p90 — vsync, with the GPU not the
 * limit — and `frameloop="demand"` means even that is only paid while a pointer
 * is down.
 *
 * A single value would express this better than a pair, and the pair is kept
 * because it is the shape of the two APIs that consume it: r3f takes it directly
 * as `<Canvas dpr>`, and a slot canvas outside a `<Canvas>` clamps into it with
 * {@link devicePixels}.
 */
export const DPR_BAND: readonly [number, number] = [2, 2]

/**
 * Samples for the composer's multisampled render target. Requires WebGL 2.
 *
 * **The stack had no multisampling at all, and that is what "pixelated" was.**
 * `STAGE_GL` sets `antialias: false` on the context, correctly — a
 * post-processing chain resolves through its own render targets and the
 * context's multisample buffer never participates. What was missing is the other
 * half of that trade: `EffectComposer`'s own `multisampling`, which defaults to
 * **0**. So the geometry was rasterised once with no coverage sampling anywhere,
 * and `SMAAEffect` was left to reconstruct every silhouette in screen space from
 * a hard-stepped image.
 *
 * SMAA is good at that and it is not enough here. A dungeon tile is a box: its
 * edges are long, near-straight and high-contrast against a light parchment
 * ground, which is the case morphological AA reconstructs least well — and the
 * builder's ground grid puts thin diagonal lines across the whole frame. Nor is
 * device pixel ratio covering for it. Measured on the owner's display,
 * `devicePixelRatio` is **1.1**: a 1164 × 713 CSS canvas backs onto 1280 × 784,
 * so {@link DPR_BAND}'s cap of 2 never binds and there is almost no supersampling
 * to hide a step in.
 *
 * **Four**, and the number is a trade rather than a maximum. The reported
 * `MAX_SAMPLES` is 8 on the machine this was measured on; 4× MSAA resolves the
 * geometric edges this scene is made of, and going to 8 doubles the target's
 * memory and resolve bandwidth for a difference that is not visible at these
 * sizes. It is clamped against the context's real `maxSamples` at the call site,
 * which is what makes it safe on WebGL 1 — `maxSamples` is 0 there, MSAA is
 * unavailable, and the chain degrades to exactly what it does today.
 *
 * The cost lands where it is cheapest: every canvas in this project is
 * `frameloop="demand"`, so this is paid per interaction and not sixty times a
 * second, and MSAA shades once per *pixel* rather than once per sample — so the
 * N8AO pass, which runs on the resolved buffer, costs exactly what it did.
 */
export const STAGE_MSAA_SAMPLES = 4

/**
 * {@link STAGE_MSAA_SAMPLES}, clamped to what this context can actually do.
 *
 * `WebGLCapabilities.maxSamples` is **0 on WebGL 1**, where multisampled render
 * targets do not exist; asking for four there would set `samples` on a target
 * that ignores it, which is harmless but is a claim the code would be making
 * without checking. A function rather than an inline `Math.min` so the WebGL 1
 * path is a tested behaviour and not a comment — `frame.test.ts`.
 *
 * Also clamps *down* to a context that supports fewer than four, which is the
 * case a `Math.max` would have got backwards.
 */
export function stageSamples(maxSamples: number): number {
  if (!Number.isFinite(maxSamples) || maxSamples <= 0) return 0
  return Math.min(STAGE_MSAA_SAMPLES, Math.floor(maxSamples))
}

/**
 * CSS pixels → backing-store pixels, under {@link DPR_BAND}.
 *
 * The slot canvas and the shared drawing buffer have to agree on this, or the
 * copy between them is scaled by the ratio of two different dpr assumptions and
 * every preview is soft. Taking the ratio as an argument rather than reading
 * `window.devicePixelRatio` keeps this callable from a test.
 */
export function devicePixels(css: number, ratio: number): number {
  const [min, max] = DPR_BAND
  const clamped = Math.min(max, Math.max(min, Number.isFinite(ratio) ? ratio : min))
  return Math.max(1, Math.round(css * clamped))
}
