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
 * Device pixel-ratio band, `[min, max]`.
 *
 * Uncapped dpr on a 3× phone triples the fragment cost of the AO pass for detail
 * nobody can see at 288 px. r3f takes the pair directly as `<Canvas dpr>`; a slot
 * canvas outside a `<Canvas>` clamps with {@link devicePixels}.
 */
export const DPR_BAND: readonly [number, number] = [1, 2]

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
