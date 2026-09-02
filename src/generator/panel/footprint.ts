/**
 * What a generated base occupies, before any geometry exists — and the contract
 * row S5 places it with.
 *
 * The point of computing this here rather than measuring a mesh is that it is
 * available in the frame the parameter changed. `x`, `y` and the basis are
 * arithmetic, so the builder can draw the base's outline, refuse an overlap and
 * add a bill line while the engine is still compiling — or without ever starting
 * it, when the recipe resolved to an archived file.
 *
 * ## The footprint is in the same units as the catalog's
 *
 * `src/catalog`'s {@link Footprint} measures in **squares**, not millimetres:
 * `plain#base+square.2x2` carries `{shape:'rect', w:2, d:2}` and the archive's
 * `plain#riser+low+square.2x3` carries `{shape:'rect', w:2, d:3}`. So a square
 * base's footprint is `x` by `y` with no conversion, which is what lets a
 * generated base and a catalogued one share one placement path.
 *
 * The millimetre figures are carried alongside rather than folded in, because
 * the *grid* is where they matter: a `wyloch` base is 31.75 mm to the square on
 * a builder grid that is 25.4, so it is 1.25 squares wide and does not tile.
 * §9.8's decision is that mixed-basis builds are a builder feature and not a
 * generator one, so {@link baseFootprint} reports `tiles: false` and the drawer
 * says so rather than the panel pretending the base fits.
 */
import type { Footprint } from '@/catalog'

import type { RecipeValue } from './recipe'
import type { PanelEntry } from './schemas'

/** `SQUARE_BASIS` to millimetres, from the enum's own labels. */
export const BASIS_MM: Readonly<Record<string, number>> = {
  '25mm': 25,
  inch: 25.4,
  wyloch: 31.75,
  drc: 38.1,
}

/** The basis the builder's grid is in, and the only one the archive holds. */
export const GRID_BASIS = 'inch'

/** Half a square per `z` step, which is what `risers_*.scad`'s `z` means. */
export const RISER_STEP_SQUARES = 0.5

export interface BaseFootprint {
  /** In squares, in the catalog's own vocabulary. */
  readonly footprint: Footprint
  /** Height in millimetres. `HEIGHT` for a base, `z` half-squares for a riser. */
  readonly heightMm: number
  /** The square size the recipe asked for, in millimetres. */
  readonly basisMm: number
  /** False when the basis is not the builder grid's, so the base will not tile. */
  readonly tiles: boolean
}

function num(values: Readonly<Record<string, RecipeValue>>, name: string, fallback: number): number {
  const value = values[name]
  return typeof value === 'number' ? value : fallback
}

function str(values: Readonly<Record<string, RecipeValue>>, name: string, fallback: string): string {
  const value = values[name]
  return typeof value === 'string' ? value : fallback
}

/**
 * The footprint of one recipe.
 *
 * `NOTCH` is deliberately ignored for the *bounding* footprint: a notched 4x4 is
 * still 4x4 of grid, with one corner missing, and the catalog models it as
 * `rect` too — `plain#base+square.4x4+notch` carries `{rect, w:4, d:4}`. A
 * placement that claimed the notch would refuse a legal neighbour.
 */
export function baseFootprint(entry: PanelEntry, values: Readonly<Record<string, RecipeValue>>): BaseFootprint {
  const basis = str(values, 'SQUARE_BASIS', GRID_BASIS)
  const basisMm = BASIS_MM[basis] ?? BASIS_MM[GRID_BASIS] ?? 25.4
  const w = num(values, 'x', 2)
  const d = num(values, 'y', 2)
  const riser = entry === 'risers_square.scad'
  const heightMm = riser ? num(values, 'z', 4) * RISER_STEP_SQUARES * basisMm : num(values, 'HEIGHT', 6)
  return {
    footprint: { shape: 'rect', w, d },
    heightMm,
    basisMm,
    tiles: basis === GRID_BASIS,
  }
}
