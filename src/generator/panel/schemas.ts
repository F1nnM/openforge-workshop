/**
 * The parameter schemas the panel paints from, pinned rather than fetched.
 *
 * S3 exposes `engine.schema(entry)`, which is the authority: it runs OpenSCAD's
 * own `--export-format=param` and is therefore incapable of disagreeing with
 * what `-D` does. It also costs the 10.5 MB engine, and the panel has to paint a
 * form *before* it knows whether it will need the engine at all — a resolved
 * recipe is served from the archive and never compiles anything.
 *
 * So the exports are committed here, and `engine.test.ts` re-runs the real
 * engine and compares byte-for-byte. The pin cannot drift: a change to any
 * `.scad` default, option list, group or caption fails that test with the
 * offending entry point named. That is the `.scad` half of this row's CI gate,
 * and it is strictly stronger than a hand-written table of the 13 defaults S1
 * asserts, because it covers all 15 parameters of `bases-square.scad`, all four
 * other entry points, and the option sets as well as the initial values.
 *
 * ## Two things the export does that a bracket parser would not
 *
 * **It injects the initial value into an enum that omits it.**
 * `bases-square.scad` writes `CENTER = "none"; // [grid, cube, false]` — three
 * options — and the export lists four, `none` first. A panel built from the
 * brackets would offer a dropdown that cannot select the file's own default.
 *
 * **It omits what a `-D` cannot reach.** `risers_square.scad` assigns `MAGNETS`,
 * `MAGNET_HOLE`, `PRIORITY`, `NOTCH`, `TOPLESS` and `HEIGHT` *below* its
 * customizer block, where a later top-level assignment wins over the injected
 * one. The export lists six parameters, not fifteen, so the panel cannot offer a
 * control that would silently do nothing.
 *
 * ## The size of this
 *
 * 25,405 bytes of JSON across five entry points, in the panel's lazy chunk —
 * not the entry bundle. `boundary.test.ts` holds that line.
 */
import type { ParameterSchema } from '../engine'
// A deep import into S3's tree, deliberately: `engine/index.ts` is a
// type-and-dynamic-import seam and exposes no values, while `engine/schema.ts`
// has **no imports at all** — it is a validator and a set of types. So taking
// the parser directly costs this chunk nothing and keeps one implementation of
// the descriptor shape. `boundary.test.ts` asserts that this is the only value
// import from `engine/` on the panel's eager side.
import { parseParameterExport } from '../engine/schema'

import basesSquare from './schemas/bases-square.param.json'
import basesSquareCorner from './schemas/bases-square-corner.param.json'
import basesSquareInternalCorner from './schemas/bases-square-internal_corner.param.json'
import basesSquareWall from './schemas/bases-square-wall.param.json'
import risersSquare from './schemas/risers_square.param.json'

/**
 * The entry points this panel offers, and the reason it is five and not sixteen.
 *
 * §8's v1 list plus `bases-square-internal_corner.scad`, which is the same
 * geometry family at no extra cost. They are the archive's biggest base families
 * and the cheapest geometry in the set — pure CSG on primitives, no `$fn=200`
 * arcs, no `import()`. The curved, radial, hex and diagonal entry points are
 * real and the engine renders them; they are not offered here because their
 * cross-parameter guards and footprints are not yet written, and offering a
 * shape whose footprint the builder cannot place would put a base on the grid
 * that nothing snaps to.
 *
 * `bases-wall-primary.scad` is not vendored at all, and that is permanent: nine
 * of its ten `TEXTURE` values `import()` a blank STL, upstream ships 36 of them
 * at 82.9 MiB, and a customizer enum cannot disable an individual value. **So
 * the panel must not imply every base is parametric.** Textured and sculpted
 * bases come from the archive's 728 pre-generated textured base files or not at
 * all, and `GeneratorDrawer.tsx` says so with a link to them.
 */
export const PANEL_ENTRIES = [
  'bases-square.scad',
  'bases-square-wall.scad',
  'bases-square-corner.scad',
  'bases-square-internal_corner.scad',
  'risers_square.scad',
] as const

export type PanelEntry = (typeof PANEL_ENTRIES)[number]

/** A short label for the shape chips. */
export const ENTRY_LABELS: Readonly<Record<PanelEntry, string>> = {
  'bases-square.scad': 'Square',
  'bases-square-wall.scad': 'Wall',
  'bases-square-corner.scad': 'Corner',
  'bases-square-internal_corner.scad': 'Internal corner',
  'risers_square.scad': 'Riser',
}

const RAW: Readonly<Record<PanelEntry, unknown>> = {
  'bases-square.scad': basesSquare,
  'bases-square-wall.scad': basesSquareWall,
  'bases-square-corner.scad': basesSquareCorner,
  'bases-square-internal_corner.scad': basesSquareInternalCorner,
  'risers_square.scad': risersSquare,
}

/**
 * Validated through S3's parser, not cast.
 *
 * The same `parseParameterExport` the worker uses, so the descriptors the panel
 * renders are shaped by exactly one implementation — including the `kind`
 * derivation that stops a three-element vector from arriving as a number input.
 */
export const PANEL_SCHEMAS: Readonly<Record<PanelEntry, ParameterSchema>> = Object.fromEntries(
  PANEL_ENTRIES.map((entry) => [entry, parseParameterExport(JSON.stringify(RAW[entry]), entry)]),
) as Readonly<Record<PanelEntry, ParameterSchema>>

export function panelSchema(entry: PanelEntry): ParameterSchema {
  return PANEL_SCHEMAS[entry]
}

export function isPanelEntry(entry: string): entry is PanelEntry {
  return (PANEL_ENTRIES as readonly string[]).includes(entry)
}
