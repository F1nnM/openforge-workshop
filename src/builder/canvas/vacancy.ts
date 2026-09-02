/**
 * Where to put a piece nobody aimed. Row X9's half of the placement seam.
 *
 * Every other way into this canvas has a cursor behind it: the palette arms a
 * tile and the user clicks a cell, so *where* is a thing the user said. The
 * generator's "Place in build" has no cursor — the user is looking at a drawer
 * on the right of the stage, not at a grid cell — so something has to choose,
 * and the two obvious choices are both wrong:
 *
 *   - **The origin.** Correct on an empty plan and useless on a real one: the
 *     origin is where the first tile went, so every generated base after the
 *     first would land in conflict and have to be dragged out.
 *   - **Arm it like a palette tile.** This is the *better* answer and it is not
 *     this row's to build: `usePlanTools` arms a `TileId`, `computeGhost` takes a
 *     `CatalogRecord`, and a generated base has neither. Arming one means a
 *     second armed-thing kind threaded through the tool state, the ghost and the
 *     commit path — a row's worth of work in row 17's files, and reported rather
 *     than done here.
 *
 * So this picks the nearest free cell, which is a real answer with a stated rule:
 * **the first cell on a ring search outward from the middle of the plan where
 * the piece does not conflict with anything.** It uses the scene's own collision
 * predicate rather than a second one, so a base it places is a base
 * `buildPlanScene` will not mark in conflict — the two cannot disagree, which is
 * the property that made `ghost.ts` share `subjectsConflict` with the scene pass
 * in the first place.
 */
import type { Footprint } from '@/catalog'

import type { PlanBox, PlanPoint } from './geometry'
import { footprintShape, planGeometry, snapTo } from './geometry'
import type { OverlapSubject, PlanBand } from './overlap'
import { subjectsConflict } from './overlap'
import type { PlanScene } from './scene'
import { scenePaintOrder } from './scene'

/**
 * How far out the search goes, in grid units.
 *
 * 64 units is a 64-inch room, which is larger than anything the plan view is
 * usable at — and the bound matters because the alternative is an unbounded loop
 * on a pathological scene. Past it, {@link freeCellFor} falls back to a cell
 * that is free by construction rather than by search: just clear of the scene's
 * own bounding box, where nothing can be.
 */
export const VACANCY_SEARCH_UNITS = 64

/** The lattice the search walks. §7's coarse mode, which is where a base belongs. */
export const VACANCY_STEP = 1

/**
 * A cell where this footprint does not conflict, and the rotation it assumes.
 *
 * `rotation` is 0: a generated base is a rect and there is nothing to align it
 * with yet. Turning it is one press of `R` once it is on the plan.
 *
 * Total. A footprint the plan view cannot draw — which no generated base has,
 * every shape the panel offers being a rect — falls straight through to the
 * fallback rather than throwing, because a placement action that threw would take
 * the builder down over a shape the *bill* would have listed happily.
 */
export function freeCellFor(scene: PlanScene, foot: Footprint, band: PlanBand = 'area'): PlanPoint {
  const shape = footprintShape(foot)
  if (shape === undefined) return clearOf(scene.bounds)

  const occupied = scenePaintOrder(scene)
  const start = centreOfPlan(scene.bounds, foot)

  const fits = (at: PlanPoint): boolean => {
    const geometry = planGeometry(shape, 0, at[0], at[1])
    const subject: OverlapSubject = {
      band,
      box: geometry.box,
      parts: geometry.parts,
      axisAligned: geometry.axisAligned,
    }
    return !occupied.some((piece) => subjectsConflict(piece, subject))
  }

  // Ring by ring, so the answer is the *nearest* free cell rather than the first
  // one a row-major scan happens to reach — a base appearing two rooms to the
  // right of the plan would read as a bug even though nothing overlapped.
  for (let radius = 0; radius <= VACANCY_SEARCH_UNITS; radius += VACANCY_STEP) {
    for (const at of ring(start, radius)) {
      if (fits(at)) return lattice(at[0], at[1])
    }
  }
  return clearOf(scene.bounds)
}

/**
 * The cells at exactly this Chebyshev radius from the centre, in a stable order.
 *
 * Ordered so the search is deterministic: a test can assert *which* cell a base
 * lands in, and two users with the same plan get the same answer. Top edge left
 * to right, then bottom, then the two sides without the corners already emitted.
 */
function ring(centre: PlanPoint, radius: number): PlanPoint[] {
  const [cx, cz] = centre
  if (radius === 0) return [[cx, cz]]
  const out: PlanPoint[] = []
  for (let dx = -radius; dx <= radius; dx += VACANCY_STEP) {
    out.push([cx + dx, cz - radius], [cx + dx, cz + radius])
  }
  for (let dz = -radius + VACANCY_STEP; dz <= radius - VACANCY_STEP; dz += VACANCY_STEP) {
    out.push([cx - radius, cz + dz], [cx + radius, cz + dz])
  }
  return out
}

/**
 * The middle of what is already drawn, snapped, and offset so the *piece* is
 * centred rather than its corner.
 *
 * `x`/`z` are an anchor — the top-left of the footprint's box, which is what
 * `planGeometry` takes and what the store holds — so centring a 4×4 base on a
 * plan means putting its anchor two units up and left of the middle. Without the
 * offset a large base on an empty plan would sit down and right of everything,
 * which is visible and looks arbitrary.
 */
function centreOfPlan(bounds: PlanBox | null, foot: Footprint): PlanPoint {
  const width = foot.shape === 'rect' ? foot.w : 1
  const depth = foot.shape === 'rect' ? foot.d : 1
  if (bounds === null) return lattice(-width / 2, -depth / 2)
  return lattice(bounds.x + bounds.w / 2 - width / 2, bounds.z + bounds.d / 2 - depth / 2)
}

/**
 * Snap a pair to the lattice, folding `-0` to `+0`.
 *
 * The fold is the store's own rule and it is needed here for the store's own
 * reason: `snapTo(-0.5, 1)` is `Math.round(-0.5) * 1`, which is `-0`, and `-0`
 * survives in memory but not through `JSON.stringify` — so a scene holding one
 * would not compare equal to itself after an export and re-import.
 * `GeneratedPlacement` folds it again on the way in, so this is belt to that
 * brace; what it buys is that the *chooser* and the store agree, which is what
 * lets a test assert a coordinate rather than assert `Object.is` around one.
 */
function lattice(x: number, z: number): PlanPoint {
  return [snapTo(x, VACANCY_STEP) + 0, snapTo(z, VACANCY_STEP) + 0]
}

/**
 * A cell clear of everything drawn — free by construction, not by search.
 *
 * One unit to the right of the scene's bounding box, so nothing can be there
 * whatever the footprint. The fallback for the two cases the ring search cannot
 * answer: a footprint with no plan-view outline, and a plan so dense that 64
 * units of ring found nothing.
 */
function clearOf(bounds: PlanBox | null): PlanPoint {
  if (bounds === null) return [0, 0]
  return lattice(bounds.x + bounds.w + VACANCY_STEP, bounds.z)
}
