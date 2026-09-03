/**
 * The recipe: what is persisted, and the key that resolves it.
 *
 * **Persist the recipe, never the mesh.** A base in a build document is an entry
 * point plus a parameter set, ~200 bytes of JSON against 0.5–2.4 MB of STL, and
 * it survives an engine upgrade as a cache miss rather than as a broken link.
 * The plan's §4.3 is the argument: OpenSCAD is not byte-deterministic across
 * versions — Manifold's maintainer, on openscad#4931, *"There is no guarantee
 * that the output is the same across versions/compilers"* — so content-addressing
 * a generated mesh would orphan every stored id on the next engine bump.
 *
 * ## Canonicalisation fills defaults rather than dropping them
 *
 * The plan proposed omitting parameters equal to their default, so that
 * `{x:2,y:2}` and `{x:2,y:2,HEIGHT:6}` hash alike. This does the same job the
 * other way round: {@link canonicalise} expands a parameter set to **every**
 * parameter the pinned schema declares, filling from the schema's own `initial`.
 * Two reasons it is the better direction here.
 *
 * The archive's tuples are *partial* — upstream's `bases.py` passes eight `-D`s
 * for a square and leaves seven at the file's default — and the panel's tuples
 * are *complete*. Dropping defaults makes those two agree only if both sides
 * know the same default table; filling makes them agree because both sides read
 * the same pinned export. And a dropped key is invisible: if a `.scad` default
 * moves, a stored recipe silently changes meaning, whereas a filled one records
 * what it meant. `engine.test.ts` re-derives the pin from the real engine, so
 * the table cannot drift either way.
 *
 * ## The key is a canonical string, and the id is a digest of it
 *
 * {@link recipeKey} returns the canonical text, and it is what the resolver's
 * map is keyed on — so two distinct recipes cannot collide onto one archived
 * file no matter how weak a hash is. {@link recipeId} is an 8-character digest
 * *of that string*, for the places a human-sized handle is needed: the bill's
 * row identity, the download filename, the STL header's provenance field. It is
 * FNV-1a, not SHA-256, and it is deliberately not called a hash of the recipe:
 * nothing branches on it, and the thing that decides identity is the string.
 */
import type { ParameterAssignment, ParameterSchema } from '../engine'

import type { PanelEntry } from './schemas'
import { isPanelEntry, panelSchema } from './schemas'

/** What a control writes and what `-D` takes. */
export type RecipeValue = ParameterAssignment

/**
 * One generated base, as a build document stores it.
 *
 * `entry` is a bare `.scad` filename because that is what the engine's flat
 * virtual filesystem addresses; a path here would break every `include`.
 */
export interface BaseRecipe {
  readonly v: 1
  readonly entry: string
  readonly parameters: Readonly<Record<string, RecipeValue>>
}

export class RecipeError extends Error {
  override readonly name = 'RecipeError'
}

/** Numbers round to 4 dp before they are compared or keyed. */
export function roundValue(value: RecipeValue): RecipeValue {
  if (typeof value !== 'number') return value
  if (!Number.isFinite(value)) throw new RecipeError(`${String(value)} is not a finite parameter value`)
  return Math.round(value * 10_000) / 10_000
}

function sameValue(a: RecipeValue, b: RecipeValue): boolean {
  return literal(a) === literal(b)
}

/** One parameter as canonical text. Distinguishes `2` from `"2"`, which `-D` does. */
function literal(value: RecipeValue): string {
  const rounded = roundValue(value)
  if (typeof rounded === 'number') return String(rounded)
  if (typeof rounded === 'boolean') return rounded ? 'true' : 'false'
  if (typeof rounded === 'string') return JSON.stringify(rounded)
  return `[${rounded.map((entry) => String(roundValue(entry))).join(',')}]`
}

/**
 * Every parameter the schema declares, filled from `values` where present.
 *
 * A value for a name the schema does not declare is **dropped**, not carried:
 * that is OpenSCAD's own parameter-set rule for a saved preset, and it is what
 * lets upstream add a parameter without invalidating stored recipes. A value the
 * schema declares but the caller omitted takes the schema's `initial`.
 */
export function canonicalise(
  entry: string,
  values: Readonly<Record<string, RecipeValue>>,
  schema?: ParameterSchema,
): Readonly<Record<string, RecipeValue>> {
  const declared = schema ?? (isPanelEntry(entry) ? panelSchema(entry) : undefined)
  if (declared === undefined) {
    // No pin for this entry point, so there is no default table to fill from and
    // the honest canonical form is what the caller actually set, ordered. The
    // panel never reaches here — `PANEL_ENTRIES` all have pins, asserted in
    // `recipe.test.ts` — but the sweep replay does, for the ten entry points the
    // archive contains and this panel does not yet offer.
    return Object.fromEntries(
      Object.keys(values)
        .sort()
        .map((name) => [name, roundValue(values[name] ?? 0)]),
    )
  }
  const out: Record<string, RecipeValue> = {}
  for (const parameter of [...declared.parameters].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const given = values[parameter.name]
    out[parameter.name] = roundValue(given ?? parameter.initial)
  }
  return out
}

/** The canonical text the resolver keys on. Stable, sorted, and readable. */
export function recipeKey(recipe: BaseRecipe, schema?: ParameterSchema): string {
  const canonical = canonicalise(recipe.entry, recipe.parameters, schema)
  const body = Object.entries(canonical)
    .map(([name, value]) => `${name}=${literal(value)}`)
    .join(' ')
  return `v1 ${recipe.entry} ${body}`
}

/**
 * An 8-character handle for a recipe key.
 *
 * FNV-1a over the canonical string, twice with different offsets so the handle
 * is 32 bits wider than one pass. **Not an integrity digest and nothing branches
 * on it** — see the module note. Synchronous, because the resolver runs during a
 * keystroke and `crypto.subtle` is not.
 */
export function recipeId(key: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ (code + index), 0x85ebca6b) >>> 0
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 8)
}

/** True when every value in `values` equals the schema's own initial. */
export function isFileDefaults(entry: PanelEntry, values: Readonly<Record<string, RecipeValue>>): boolean {
  const schema = panelSchema(entry)
  return schema.parameters.every((parameter) => {
    const given = values[parameter.name]
    return given === undefined || sameValue(given, parameter.initial)
  })
}

/** The schema's own initial values, as a starting parameter set. */
export function fileDefaults(entry: PanelEntry): Record<string, RecipeValue> {
  const out: Record<string, RecipeValue> = {}
  for (const parameter of panelSchema(entry).parameters) out[parameter.name] = parameter.initial
  return out
}
