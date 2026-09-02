/**
 * The bill line for a generated base — and what it is not allowed to claim.
 *
 * The line has to answer three questions and it cannot borrow any of the
 * answers from `buildBillOfTiles`, which is keyed on a `BlobId` and named by a
 * `CatalogRecord`. A generated base has neither until it has been rendered, and
 * even then its digest is one it gave itself.
 *
 * ## What it says, given that the archive is not reproducible
 *
 * **No archive provenance, ever — not even when the parameters resolve.** S4
 * measured that the vendored geometry does not reproduce the archive: the
 * published bases are ASCII STL from an older revision, and the whole connector
 * space of the archived 1×1 was searched without matching its md5 or its facet
 * count (760 published facets against 296 and 1,428). So `catalogued-match` is
 * unreachable on this corpus, S4 passes no `expectedMd5`, and the only honest
 * verdict for a rendered mesh is S3's `self-addressed`.
 *
 * That decides the line. It cites:
 *
 *   1. **the geometry, pinned** — `bases-square.scad`, Apache-2.0, at
 *      `MasterworkTools/openforge-bases@e6dbbff`. This is a claim about *source*,
 *      which is checkable and true;
 *   2. **its own digest, with the caveat attached** — S3's own sentence, that
 *      the md5 *"identifies these bytes rather than vouching for them"*, because
 *      both sides of it came from this run;
 *   3. **why it was generated at all** — no published file names these
 *      parameters, or two do and they disagree.
 *
 * And it never names a published file as the thing you are printing. An
 * `archived` resolution does not reach this module: `placeRecipe` turns that
 * into an ordinary `Placement`, it gets the catalog's own bill line, and
 * `ArchivedPlacement.note` carries {@link ARCHIVE_PROVENANCE} — the mirror-image
 * sentence, which says the file is the archive's published mesh and *not* a
 * render of these parameters.
 *
 * ## Two dedupe keys, one row apart, both right
 *
 * A bill line is **one per recipe**; a pack entry is **one per mesh digest**
 * (`pack.ts`). They are different questions. The bill is about what somebody
 * chose to print, so two recipes stay two rows even in the theoretical case
 * where they render byte-identically; the pack is about bytes, so identical
 * bytes are one entry, exactly as `buildBillOfTiles` folds 171 md5s shared by
 * 520 catalog rows.
 *
 * ## An unrendered base is a row, and a warning
 *
 * A base can be on the plan with no bytes behind it — placed, then a parameter
 * changed, or placed while the engine was still compiling. That is a real state
 * and not an error: the footprint is arithmetic, so the outline was always
 * truthful. It is a `warn` row saying the piece is on the plan and not in the
 * download, because the alternative is a download that is quietly one file
 * short — and short, unobserved, is the failure this row's whole download path
 * is arranged against.
 */
import { GRID_UNIT_MM } from '@/catalog'
import type { PlacementId } from '@/store'

import type { GeneratedFootprint } from './geometry'
import { generatedFootprint, generatedStyle } from './geometry'
import { ABSENT_NOTE, UNRENDERED_NOTE, ambiguousNote, generatedProvenance, selfAddressedNote } from './provenance'
import type { GeneratedBaseId, GeneratedPlacement, GeneratedScene } from './scene'
import { GENERATED_SHAPES, recipeHandle } from './scene'

/**
 * The facts a rendered mesh contributes — and the whole of them.
 *
 * Structural, so a caller hands over `Pick<GeneratedMesh, 'md5' | …>` from S3's
 * engine without this module importing it: `engine/index.ts` is nothing but
 * types and `import()`, and reaching it from a bill row would emit the 298 kB
 * worker chunk into the panel that lists the bill.
 *
 * `triangles` is here because zero triangles is a failure whatever OpenSCAD's
 * exit status said — the vendored geometry has not one `assert()`, an invalid
 * combination `echo`es to stderr and emits empty geometry with status 0. A row
 * that reported "ready, 0 triangles" would be reporting success.
 */
export interface GeneratedMeshFacts {
  /** The mesh's own md5, 32 lowercase hex. Self-addressed; see the module note. */
  readonly md5: string
  readonly bytes: number
  readonly triangles: number
}

/** Meshes held for this session, by the recipe that produced them. */
export type GeneratedMeshes = ReadonlyMap<GeneratedBaseId, GeneratedMeshFacts>

/** One generated base, and every copy of it the scene asked for. */
export interface GeneratedBillLine {
  /** The line's identity: the canonical recipe key, branded. */
  readonly base: GeneratedBaseId
  /** S4's 8-character handle, for the caption and the entry name. Not an identity. */
  readonly recipeId: string
  /** `Generated square base` — the shape, in the panel's own words. */
  readonly name: string
  readonly entry: GeneratedPlacement['recipe']['entry']
  /** The material family, from `src/materials` rather than from here. */
  readonly material: string
  readonly foot: GeneratedFootprint
  /** `2 × 2` in grid squares. Non-integral only on a non-inch basis. */
  readonly size: string
  /** Copies to print. The pack holds the mesh once whatever this says. */
  readonly quantity: number
  /** The scene keys that asked for it, sorted. */
  readonly placements: readonly PlacementId[]
  /** `null` until the engine has produced bytes for this recipe. */
  readonly mesh: GeneratedMeshFacts | null
  /** Every `-D` the recipe sets, canonical and sorted. Disclosed, not summarised. */
  readonly parameters: readonly { readonly name: string; readonly value: string }[]
  /** Where the bytes come from, what the digest proves, and why not the archive. */
  readonly provenance: readonly string[]
  readonly severity: 'info' | 'warn'
}

export interface GeneratedBill {
  /** By copies descending, then by name, then by recipe id — the bill panel's order. */
  readonly lines: readonly GeneratedBillLine[]
  /** Generated bases on the plan. */
  readonly placements: number
  /** Copies to print — the sum of `quantity`. */
  readonly copies: number
  /** Distinct recipes. */
  readonly recipes: number
  /**
   * Bytes the generated meshes add to the archive.
   *
   * Deliberately **not** folded into the bill's `DownloadSize` verdict, which is
   * calibrated on *fetch* cost — 512 MB is fifty median corpus tiles over the
   * network. These bytes are already in memory and cost nothing to fetch; what
   * they do change is the size of the finished ZIP, and `plan.predictedLength`
   * is where that is accounted for, exactly.
   */
  readonly bytes: number
  /** Recipes on the plan with no bytes behind them. Every one is a `warn` row. */
  readonly unrendered: number
}

export interface GeneratedBillOptions {
  readonly meshes?: GeneratedMeshes
  /**
   * Recipes the archive answers twice, by id — 27 of its 709 resolvable keys.
   *
   * Passed in rather than resolved here, because "is this ambiguous" is a fact
   * about the current catalog build and `buildBaseResolver` lives behind the
   * drawer's lazy boundary. Absent means the ordinary case, and the line then
   * says only that no published file names these parameters — which is true of
   * an ambiguous recipe too, since neither of the two was taken.
   */
  readonly ambiguous?: ReadonlyMap<GeneratedBaseId, readonly string[]>
}

/**
 * Roll a generated scene up into bill lines.
 *
 * One pass over the placements, one over the groups. An empty scene returns an
 * empty bill rather than a null — the panel renders before anything is placed.
 */
export function buildGeneratedBill(scene: GeneratedScene, options: GeneratedBillOptions = {}): GeneratedBill {
  const groups = new Map<GeneratedBaseId, { placement: GeneratedPlacement; ids: PlacementId[] }>()

  for (const [key, placement] of Object.entries(scene)) {
    const id = key as PlacementId
    const held = groups.get(placement.base)
    if (held === undefined) groups.set(placement.base, { placement, ids: [id] })
    else held.ids.push(id)
  }

  const lines = [...groups.entries()]
    .map(([base, group]) => line(base, group.placement, group.ids, options))
    .sort(byCopiesThenName)

  return {
    lines,
    placements: Object.keys(scene).length,
    copies: lines.reduce((total, one) => total + one.quantity, 0),
    recipes: lines.length,
    bytes: lines.reduce((total, one) => total + (one.mesh?.bytes ?? 0), 0),
    unrendered: lines.filter((one) => one.mesh === null).length,
  }
}

function line(
  base: GeneratedBaseId,
  placement: GeneratedPlacement,
  ids: readonly PlacementId[],
  options: GeneratedBillOptions,
): GeneratedBillLine {
  const foot = generatedFootprint(placement)
  const shape = GENERATED_SHAPES[placement.recipe.entry]
  const mesh = options.meshes?.get(base) ?? null
  const ambiguous = options.ambiguous?.get(base) ?? []
  const grid = foot.gridFootprint

  const provenance = [generatedProvenance(placement.recipe.entry)]
  provenance.push(ambiguous.length > 1 ? ambiguousNote(ambiguous) : ABSENT_NOTE)
  provenance.push(mesh === null ? UNRENDERED_NOTE : selfAddressedNote(mesh.md5))
  if (!foot.tiles) {
    provenance.push(
      `This basis is ${String(foot.basisMm)} mm to the square and the builder grid is ` +
        `${String(GRID_UNIT_MM)}, so the base occupies ${String(grid.shape === 'rect' ? grid.w : 0)} grid ` +
        'squares rather than a whole number of them and will not tile.',
    )
  }

  return {
    base,
    recipeId: recipeHandle(base),
    name: `Generated ${shape.label.toLowerCase()} base`,
    entry: placement.recipe.entry,
    material: generatedStyle(placement).label,
    foot,
    size: grid.shape === 'rect' ? `${String(grid.w)} × ${String(grid.d)}` : grid.shape,
    quantity: ids.length,
    placements: [...ids].sort(),
    mesh,
    parameters: Object.entries(placement.recipe.parameters).map(([name, value]) => ({
      name,
      value: typeof value === 'string' ? JSON.stringify(value) : String(value),
    })),
    provenance,
    severity: mesh === null || !foot.tiles ? 'warn' : 'info',
  }
}

function byCopiesThenName(a: GeneratedBillLine, b: GeneratedBillLine): number {
  return b.quantity - a.quantity || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.base < b.base ? -1 : 1)
}
