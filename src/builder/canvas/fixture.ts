/**
 * An eleven-record catalog for the canvas's tests.
 *
 * Small on purpose, and every record is here to exercise one thing the plan
 * has to get right:
 *
 *   - a **1 × 1 `rect` floor** and a **2 × 2 `rect` floor** — the two commonest
 *     shapes in a real room, and the pair that shows a snap landing on a 0.5
 *     boundary for an odd and an even extent;
 *   - a **2-unit `wall`** — the footprint whose depth is not in the data at all
 *     but is the measured 12.7 mm constant, and whose short axis is why the
 *     anchor is the corner and not the centre;
 *   - a **`rect` tile with `rotStep: 45`** — one of the 893 tiles whose angle is
 *     not a multiple of 90 and which would never tile on a 90° step;
 *   - a **`none`** — the 8.3% of the corpus the builder must refuse *visibly*,
 *     and after this row the only case it refuses at all;
 *   - a **thick wall that arrives as a `rect`** with `kinds: ['wall']`, which is
 *     the case that makes band assignment a two-stage rule rather than a
 *     footprint switch;
 *   - a **quarter-disc `arc`** at `rIn = 0` — the degenerate sector, where the
 *     inner chord collapses to the arc centre and a collision part becomes a
 *     triangle;
 *   - a **`convex` `arc` with `bandBasis: 'fallback'`** — the 462-tile population
 *     that is drawn and *marked* rather than refused, and the only record here
 *     that must produce a `placementCaveat`;
 *   - a **`column`** whose `kinds` say `column` and not `wall`, which is one of
 *     the 75 tiles the footprint-first band rule moves from `area` to `edge`;
 *   - a **`tri`** and a **`diag`**, the two cases W4 split precisely because a
 *     filled triangle and a 45° strip need different collision geometry. Both
 *     carry `rotStep: 45`, as all 130 do in the corpus.
 *
 * Exported as a plain object rather than a parsed `CatalogFile` so it travels the
 * real path through `CatalogFile.parse`, which is where a fixture that drifted
 * from the schema gets caught.
 */
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'
import type { PlacementId, SlotFill, SlotName, TemplateId, TemplateInstance } from '@/store'

import type { SlotRecords } from './catalog'
import type { Extent, SlotLayout } from './geometry'
import { footprintExtent } from './geometry'

const TAGS = [
  'shape|floor',
  'shape|wall',
  'texture|dungeon_stone',
  'texture|cut_stone',
  'texture|wood',
  'texture|cave',
  'connection|openlock',
  'size|angle|45',
  'build|thick wall',
  'shape|column',
  'shape|angled|right',
]

const tag = (name: string): number => {
  const index = TAGS.indexOf(name)
  if (index < 0) throw new Error(`fixture tag ${name} is not in the intern table`)
  return index
}

/** md5s are structural here — 32 hex characters, distinct per record. */
const blob = (n: number): string => String(n).repeat(32).slice(0, 32)

export const FIXTURE_CATALOG = {
  version: {
    schema: 1,
    pipeline: 1,
    fixtures: 'canvas-fixture',
    manifest: 1,
    built: '2026-01-01T00:00:00Z',
  },
  assets: {
    models: 'https://objects.openforge.tools/models/',
    sprites: 'https://objects.openforge.tools/sprites/',
    thumbs: 'https://objects.openforge.tools/thumbs/',
    lod: 'https://objects.openforge.tools/lod/',
  },
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: TAGS,
  records: [
    {
      id: 'tiles/dungeon_stone/floor/1x1.openlock.stl',
      ord: 0,
      blob: blob(1),
      file: '1x1.openlock.stl',
      bytes: 1_048_576,
      sprite: true,
      thumb: false,
      family: 'tiles/dungeon_stone/floor',
      design: 'd-floor-1',
      name: 'Dungeon stone floor 1×1',
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'dungeon_stone',
      tags: [tag('shape|floor'), tag('texture|dungeon_stone'), tag('connection|openlock')],
      foot: { shape: 'rect', w: 1, d: 1 },
    },
    {
      id: 'tiles/dungeon_stone/floor/2x2.openlock.stl',
      ord: 1,
      blob: blob(2),
      file: '2x2.openlock.stl',
      bytes: 4_194_304,
      sprite: true,
      thumb: false,
      family: 'tiles/dungeon_stone/floor',
      design: 'd-floor-2',
      name: 'Dungeon stone floor 2×2',
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'dungeon_stone',
      tags: [tag('shape|floor'), tag('texture|dungeon_stone'), tag('connection|openlock')],
      foot: { shape: 'rect', w: 2, d: 2 },
    },
    {
      id: 'tiles/cut_stone/wall/2.openlock.stl',
      ord: 2,
      blob: blob(3),
      file: '2.openlock.stl',
      bytes: 2_097_152,
      sprite: true,
      thumb: false,
      family: 'tiles/cut_stone/wall',
      design: 'd-wall-2',
      name: 'Cut stone wall 2',
      kinds: ['wall'],
      conn: ['openlock'],
      layer: 'topper',
      texture: 'cut_stone',
      tags: [tag('shape|wall'), tag('texture|cut_stone'), tag('connection|openlock')],
      foot: { shape: 'wall', length: 2 },
    },
    {
      id: 'tiles/wood/floor/2x1,45.openlock.stl',
      ord: 3,
      blob: blob(4),
      file: '2x1,45.openlock.stl',
      bytes: 1_572_864,
      sprite: true,
      thumb: false,
      family: 'tiles/wood/floor',
      design: 'd-angled',
      name: 'Wood angled floor 2×1',
      kinds: ['floor', 'angled'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'wood',
      tags: [tag('shape|floor'), tag('texture|wood'), tag('size|angle|45')],
      foot: { shape: 'rect', w: 2, d: 1 },
      rotStep: 45,
    },
    {
      id: 'tiles/cave/curve/r2.openlock.stl',
      ord: 4,
      blob: blob(5),
      file: 'r2.openlock.stl',
      bytes: 3_145_728,
      sprite: true,
      thumb: false,
      family: 'tiles/cave/curve',
      design: 'd-arc',
      name: 'Cave curve radius 2',
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'cave',
      tags: [tag('shape|floor'), tag('texture|cave')],
      // A quarter-disc floor sector: the `radial` band at R = 2, where R − 2
      // degenerates to 0. W1's most-measured arc shape — 11 accepted fits at
      // [0.000, 2.001] — and `radial` is a band the schema will accept a
      // `'measured'` stamp on.
      foot: { shape: 'arc', rIn: 0, rOut: 2, sweep: 90, band: 'radial', bandBasis: 'measured' },
    },
    {
      id: 'tiles/cave/hex/hex.stl',
      ord: 5,
      blob: blob(6),
      file: 'hex.stl',
      bytes: 5_242_880,
      sprite: false,
      thumb: false,
      family: 'tiles/cave/hex',
      design: 'd-none',
      name: 'Cave hex platform',
      kinds: [],
      conn: [],
      layer: 'integral',
      texture: 'cave',
      tags: [tag('texture|cave')],
      foot: { shape: 'none' },
    },
    {
      id: 'tiles/cut_stone/thick_wall/2x0.5.openlock.stl',
      ord: 6,
      blob: blob(7),
      file: '2x0.5.openlock.stl',
      bytes: 2_621_440,
      sprite: true,
      thumb: false,
      family: 'tiles/cut_stone/thick_wall',
      design: 'd-thick-wall',
      name: 'Cut stone thick wall 2',
      kinds: ['wall'],
      conn: ['openlock'],
      build: 'thick wall',
      layer: 'topper',
      texture: 'cut_stone',
      tags: [tag('shape|wall'), tag('texture|cut_stone'), tag('build|thick wall')],
      foot: { shape: 'rect', w: 2, d: 0.5 },
    },
    {
      id: 'tiles/cut_stone/curve/4r45.convex.openlock.stl',
      ord: 7,
      blob: blob(8),
      file: '4r45.convex.openlock.stl',
      bytes: 1_310_720,
      sprite: true,
      thumb: false,
      family: 'tiles/cut_stone/curve',
      design: 'd-arc-convex',
      name: 'Cut stone convex curve 4r45',
      kinds: ['wall'],
      conn: ['openlock'],
      layer: 'topper',
      texture: 'cut_stone',
      tags: [tag('shape|wall'), tag('texture|cut_stone'), tag('size|angle|45')],
      // A curved wall on the inside of the tagged radius: the `convex` band,
      // `[R - 0.5, R]` at R = 4. W1 attempted 43 convex meshes and refused all
      // 43, so the band is `fallback` and the schema will not take a `'measured'`
      // stamp on it. The pair is W2's own research measurement of `4r45`
      // ([3.500, 3.997]), rounded to the rule the band states.
      foot: { shape: 'arc', rIn: 3.5, rOut: 4, sweep: 45, band: 'convex', bandBasis: 'fallback' },
      rotStep: 45,
    },
    {
      id: 'tiles/dungeon_stone/column/col+I.openlock.stl',
      ord: 8,
      blob: blob(9),
      file: 'col+I.openlock.stl',
      bytes: 262_144,
      sprite: true,
      thumb: false,
      family: 'tiles/dungeon_stone/column',
      design: 'd-column',
      name: 'Dungeon stone column I',
      // `column` and NOT `wall`: one of the 75 tiles whose tags would file a
      // 12.70 x 12.70 mm pillar as a floor if the band rule went by kinds alone.
      kinds: ['column'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'dungeon_stone',
      tags: [tag('shape|column'), tag('texture|dungeon_stone'), tag('connection|openlock')],
      foot: { shape: 'column' },
    },
    {
      id: 'tiles/wood/angled/tri2.openlock.stl',
      ord: 9,
      blob: blob(10),
      file: 'tri2.openlock.stl',
      bytes: 786_432,
      sprite: true,
      thumb: false,
      family: 'tiles/wood/angled',
      design: 'd-tri',
      name: 'Wood right triangle 2',
      kinds: ['angled', 'floor'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'wood',
      tags: [tag('shape|angled|right'), tag('texture|wood'), tag('size|angle|45')],
      // Leg 2 is one of the two the tags state exactly - 5 tiles at 2, 4 at 4.
      foot: { shape: 'tri', leg: 2 },
      rotStep: 45,
    },
    {
      id: 'tiles/cut_stone/angled/diagPA.openlock.stl',
      ord: 10,
      blob: blob(11),
      file: 'diagPA.openlock.stl',
      bytes: 655_360,
      sprite: true,
      thumb: false,
      family: 'tiles/cut_stone/angled',
      design: 'd-diag',
      name: 'Cut stone diagonal wall PA',
      kinds: ['angled', 'wall'],
      conn: ['openlock'],
      layer: 'topper',
      texture: 'cut_stone',
      tags: [tag('shape|angled|right'), tag('texture|cut_stone'), tag('size|angle|45')],
      // Code `PA`: 2.828 = 2*sqrt(2), the diagonal of a 2 x 2 cell, against a
      // tagged `size|width|2`. The 0.5 thickness is the wall constant.
      foot: { shape: 'diag', run: 2.828 },
      rotStep: 45,
    },
  ],
}

/** The fixture, validated — the same parse the app's index goes through. */
export function fixtureCatalogFile(): CatalogFile {
  return CatalogFileSchema.parse(FIXTURE_CATALOG)
}

/**
 * Ids by role, so a test reads as its intent rather than as a path.
 *
 * **Files**, and since row A1 that is all a test needs: a `SlotFill` names an
 * exact file (decision **D1**) and `PlanCatalog.record` takes a {@link TileId},
 * so a test that wants a particular outline in a particular slot says so
 * directly. Row V4's `FIXTURE_DESIGNS` and `fixtureDesignOf` were the bridge from
 * a file id to the *item* a placement held, and both are deleted with the field
 * they bridged to — there is no aggregate hop left for them to make.
 */
export const FIXTURE_IDS = {
  floor1: 'tiles/dungeon_stone/floor/1x1.openlock.stl',
  floor2: 'tiles/dungeon_stone/floor/2x2.openlock.stl',
  wall2: 'tiles/cut_stone/wall/2.openlock.stl',
  angled: 'tiles/wood/floor/2x1,45.openlock.stl',
  arc: 'tiles/cave/curve/r2.openlock.stl',
  arcFallback: 'tiles/cut_stone/curve/4r45.convex.openlock.stl',
  column: 'tiles/dungeon_stone/column/col+I.openlock.stl',
  tri: 'tiles/wood/angled/tri2.openlock.stl',
  diag: 'tiles/cut_stone/angled/diagPA.openlock.stl',
  shapeless: 'tiles/cave/hex/hex.stl',
  thickWall: 'tiles/cut_stone/thick_wall/2x0.5.openlock.stl',
} as const

/* --------------------------------------------------------------- templates */

/**
 * A template family for the canvas's tests, and its five slot names.
 *
 * Named after the shipped family §2.1 uses as its worked example —
 * `s2w-wall-on-tile-corner-low-single-piece`, *"the requested floor plus two
 * walls plus a column in the corner, verbatim"* — but spelled out here rather
 * than imported, for the reason `src/store/schema.ts#TemplateId` gives at length:
 * the 40-entry table lives beside a screen, and `catalog.ts` sets out why the
 * canvas must not reach one.
 *
 * **Two of the five slot names contain a space.** That is not decoration: it is
 * the property `src/store/schema.ts#SlotName` refuses a slug pattern over —
 * `'right wall'` and `'left wall'` are carried by 8 of the corpus's 128 parts —
 * so a fixture without one would let a slot-name assumption through.
 */
export const FIXTURE_TEMPLATE = 'fixture-corner' as TemplateId

/**
 * A second family, for the tests about telling two apart — and, since row C6,
 * the fixture's `wall-on-tile`: `base`, `floor`, `wall`. See
 * {@link fixtureTemplateParts}.
 */
export const OTHER_FIXTURE_TEMPLATE = 'fixture-corridor' as TemplateId

/** The five slots, in the shipped family's own declared order, plus `wall`. */
export const FIXTURE_SLOTS = {
  column: 'column' as SlotName,
  rightWall: 'right wall' as SlotName,
  leftWall: 'left wall' as SlotName,
  floor: 'floor' as SlotName,
  base: 'base' as SlotName,
  /**
   * The 32-recipe convention's third part — {@link OTHER_FIXTURE_TEMPLATE}'s.
   *
   * Not one of {@link FIXTURE_TEMPLATE}'s five: `wall-on-tile` and
   * `external-corner` are different part-name **sets** and that is exactly what
   * `rules.ts` keys a convention on, so a fixture that wanted both conventions
   * needed a second family and a sixth name.
   */
  wall: 'wall' as SlotName,
}

/**
 * The part names of the two fixture families, as {@link templateSlotLayout}
 * wants them.
 *
 * The one thing the real rule needs that the canvas cannot see: a convention is
 * keyed on the part-name **set**, the 91-entry family table lives beside a
 * screen, and `catalog.ts` sets out why this directory must not reach one. So a
 * canvas test that wants the *production* rule over these eleven records builds
 * it as `templateSlotLayout(fixtureTemplateParts)`.
 *
 * The two sets are chosen to be `rules.ts`'s two wall-bearing conventions
 * verbatim — {@link FIXTURE_TEMPLATE} is `external-corner`'s five names and
 * {@link OTHER_FIXTURE_TEMPLATE} is `wall-on-tile`'s three — because a set that
 * matched neither would answer {@link ORIGIN_LAYOUT} for every slot and a test
 * over it could not tell the wiring from its absence. Any other id answers
 * `undefined`, which is the *"this build has no such recipe"* case and is a
 * state a real room reaches: C1 measured all 51 generated families reporting
 * `unknown-template` against a 40-recipe table.
 */
export function fixtureTemplateParts(template: TemplateId): readonly string[] | undefined {
  if (template === FIXTURE_TEMPLATE) {
    return [
      FIXTURE_SLOTS.base,
      FIXTURE_SLOTS.column,
      FIXTURE_SLOTS.floor,
      FIXTURE_SLOTS.leftWall,
      FIXTURE_SLOTS.rightWall,
    ]
  }
  if (template === OTHER_FIXTURE_TEMPLATE) {
    return [FIXTURE_SLOTS.base, FIXTURE_SLOTS.floor, FIXTURE_SLOTS.wall]
  }
  return undefined
}

/**
 * The cell {@link fixtureSlotLayout}'s slots are laid out inside.
 *
 * The 2 x 2 floor, which is also the fixture's `floor2` footprint — the union
 * every part of the corner nests inside, and the box the instance turns within.
 *
 * **It used to be a constant for four of the five slots and read off the fill for
 * the fifth, and row C6 closed that split.** The reason for it was a signature:
 * `catalog.ts#SlotLayoutRule` was `(template, slot, record) => SlotLayout` and
 * handed over only the record of the slot being laid out, so a rule could resolve
 * the cell exactly when the slot it was asked about *was* the cell slot, and for
 * the other four could do no better than the cell its own recipe describes. The
 * rule now takes the instance's whole {@link SlotRecords} map, so this fixture
 * reads the `floor` fill's own extent for **all five** — which is B2's rule and
 * is what keeps a lone 2 x 1 floor anchored at the placement's own `x`/`z`
 * instead of inside a 2 x 2 cell it does not fill.
 *
 * It survives as the fallback for an instance with no `floor` fill at all, where
 * there is no cell to read and the offsets below are the ones this 2 x 2 implies.
 */
export const FIXTURE_CELL = Object.freeze({ w: 2, d: 2 })

/**
 * A slot layout with **real offsets**, so a test can prove the composition.
 *
 * `originSlotLayout` — the rule in force until row B2's lands — puts every part
 * at the instance origin, which is right for `floor` and `base` and stacks the
 * rest. A canvas test written only against that could not tell a correct
 * `slotGeometry` from one that ignored `dx`/`dz` and `layout.rotation` entirely,
 * so this rule lays out a 2 × 2 corner: the floor and the base on the cell, the
 * left wall along its north edge, the right wall turned a quarter along its east
 * edge, and the column in the corner where the two meet.
 *
 * **The numbers are a fixture, not a measurement**, and they are chosen to
 * exercise four facts rather than to describe a real recipe: the offsets are
 * multiples of 0.25 and include values off the 0.5 snap lattice (§2.2),
 * `right wall` carries a yaw of its own so a part's angle is not its instance's,
 * the elevations are distinct so a renderer reading one part's height for
 * another is visible, and every part **declares the same 2 x 2 cell** so the
 * assembly is a rigid body under rotation ({@link SlotLayout.cell}). Row **B2**
 * owns the real rule.
 *
 * The five offsets are the ones B2's own `external-corner` convention produces
 * for this cell — `edge` is *"flush to the face and centred across it"* and
 * `corner` is the square where two faces meet, so nothing overhangs and the
 * union is the cell itself, 2 x 2 at the instance origin, at every rotation.
 *
 * **It is still authored, and that is deliberate now rather than forced.**
 * `catalog.ts#templateSlotLayout` is the real composition and the app runs it;
 * this stays a fixture so that a canvas test measures the *canvas* — one rule
 * whose numbers are written down, against `slotGeometry` — rather than measuring
 * B2's arithmetic a second time, which `src/template/offsets.test.ts` already
 * does over all three conventions.
 */
export function fixtureSlotLayout(
  _template: TemplateId,
  slot: SlotName,
  fills: SlotRecords = new Map(),
): SlotLayout {
  // The cell slot's own fill *is* the cell, for every slot and not just for the
  // cell slot itself — which is what the widened seam bought. See
  // {@link FIXTURE_CELL}.
  const cell = cellOf(fills.get(FIXTURE_SLOTS.floor))
  switch (slot) {
    case FIXTURE_SLOTS.base:
      return { dx: 0, dz: 0, rotation: 0, elevationMm: 0, cell }
    case FIXTURE_SLOTS.floor:
      return { dx: 0, dz: 0, rotation: 0, elevationMm: 6.35, cell }
    case FIXTURE_SLOTS.leftWall:
      return { dx: 0, dz: 0, rotation: 0, elevationMm: 12.7, cell }
    case FIXTURE_SLOTS.rightWall:
      return { dx: 1.5, dz: 0, rotation: 90, elevationMm: 12.7, cell }
    case FIXTURE_SLOTS.column:
      return { dx: 1.5, dz: 1.5, rotation: 0, elevationMm: 12.7, cell }
    default:
      // A slot this fixture has no rule for sits a quarter unit off the origin —
      // deliberately *off* the 0.5 lattice, since §2.2 says a slot offset never
      // snaps. Total rather than throwing, because `PlanCatalog.parts` walks
      // whatever the instance's fill map holds and a test is entitled to invent
      // a slot. No cell either, because a slot no recipe declares belongs to no
      // cell.
      return { dx: 0.25, dz: 0.25, rotation: 0, elevationMm: 25.4 }
  }
}

/**
 * The cell of the slot that *is* the cell: the `floor` fill's own extent.
 *
 * {@link FIXTURE_CELL} when the instance has no `floor` fill to read — a caller
 * that asks for a layout without one, and an instance that has not filled it —
 * and `undefined` for a fill with no placeable footprint, where the part is not
 * drawn at all and the whole layout is moot.
 */
function cellOf(record: CatalogRecord | undefined): Extent | undefined {
  return record === undefined ? FIXTURE_CELL : footprintExtent(record.foot)
}

/**
 * A fill map from `[slot, tileId]` pairs. Every fill `auto`, which is the
 * solver's.
 *
 * Takes **plain strings** and brands them here, which is the whole job of a
 * fixture: `SlotName` and `TileId` are opaque brands over strings, so a test
 * that had to mint them itself would be a line of casts per row. One cast here
 * beats one per call site, and it keeps the `as` out of the tests where it would
 * read as significant.
 */
export function fixtureFills(rows: readonly (readonly [string, string])[]): TemplateInstance['fills'] {
  const fills: Record<string, SlotFill> = {}
  for (const [slot, tile] of rows) fills[slot as SlotName] = { tile: tile as TileId, pinned: false }
  return fills
}

/**
 * What {@link fixtureInstance} lets a test override, families as plain strings.
 *
 * Every field is `?: T | undefined` rather than `?: T`, because this project sets
 * `exactOptionalPropertyTypes`: under it a plain `?: T` refuses an explicit
 * `undefined`, and a test that builds these rows from a tuple with an optional
 * tail hands over exactly that. Spelling both out is what lets a caller write
 * `{ template }` instead of `...(template === undefined ? {} : { template })`.
 */
export interface FixtureInstanceOptions {
  readonly x?: number | undefined
  readonly z?: number | undefined
  readonly rotation?: number | undefined
  /** Defaults to {@link FIXTURE_TEMPLATE}. Branded here, for `fixtureFills`' reason. */
  readonly template?: string | undefined
}

/**
 * One template instance, ready to put in a `placements` map.
 *
 * `id` is written into the object as well as being the map key, which is
 * `src/store/schema.ts`'s own rule and the reason it takes the key: *"the key
 * wins"*, and a fixture that let the two disagree would let a test pass against a
 * shape nothing in the app can produce.
 */
export function fixtureInstance(
  id: string,
  fills: TemplateInstance['fills'],
  over: FixtureInstanceOptions = {},
): TemplateInstance {
  return {
    id: id as PlacementId,
    template: (over.template ?? FIXTURE_TEMPLATE) as TemplateId,
    x: over.x ?? 0,
    z: over.z ?? 0,
    rotation: over.rotation ?? 0,
    fills,
  }
}
