/**
 * A nine-record catalog for the builder panels' tests.
 *
 * Small on purpose, and every record earns its place by being the subject of one
 * assertion the panels have to get right:
 *
 *   - **`FLOOR_1X1`** — a plain integral floor. The control: placeable, needs no
 *     base, warns about nothing.
 *   - **`FLOOR_2X2`** — a `connection|openforge` topper with size code `A`, and
 *     **`BASE_2X2`** the base that carries it. Together they are the auto-insert
 *     rule: placing the floor puts *two* lines in the bill, one of which the user
 *     did not place.
 *   - **`WALL_NO_BASE`** — an openforge topper whose size code (`ZZ`) no base
 *     answers to. This is the `no-matching-base` warning, which stands in for the
 *     86 live corpus tiles in that state (129 until row D4's re-key), and it is
 *     the note the panel must not swallow: printed alone it is a wall with
 *     nothing to stand on.
 *   - **`SLAB`** — the one footprint the plan view refuses: `none`, 8.3% of the
 *     corpus. The palette must grey it and offer no control for it. **`ARC`** is
 *     its control and used to be its twin — row W6 made annular sectors
 *     placeable, so the pair now proves that the refusal is `none` alone rather
 *     than everything curved.
 *   - **`TWIN`** — a second catalog path over `FLOOR_1X1`'s md5. 171 live md5s are
 *     shared by 520 rows, and the bill must show one line and charge for one
 *     download.
 *   - **`BIG`** (600 MB) and **`HUGE`** (1.5 GB) — the two download thresholds.
 *     `BIG` alone trips `large` at 512 MB; the pair trips `huge` at 2 GB. Both are
 *     far past the 108.9 MB largest live file, deliberately: a fixture that needed
 *     fifty placements to cross a threshold would make the threshold test a
 *     performance test.
 *
 * `assets.models` is the real bucket URL, because `originalStlUrl` refuses
 * anything that is not exactly `…/models/{md5[0:6]}/{md5}.stl` — so a fixture with
 * a fake base would fail in `buildArchivePlan` rather than in the assertion.
 *
 * Exported as a plain object rather than a parsed `CatalogFile`, so it travels the
 * real path through `CatalogFile.parse` where a fixture that drifted from the
 * schema gets caught.
 *
 * ## Two recipes, added by row A8
 *
 * A placement is a template instance, so a test that wants a bill needs a recipe
 * and an {@link AssemblyContext} as well as records. {@link ONE_SLOT_TEMPLATE}
 * and {@link TWO_SLOT_TEMPLATE} are the smallest pair that covers what the panels
 * assert — one file per instance, and more parts than placements — and
 * {@link fixtureContext} is the context over whichever catalog a block parsed.
 *
 * They are declared here rather than in each suite because three files build a
 * bill over these records (`panels.test.tsx`, `generated.test.tsx` and
 * `screens/builder/builder.test.tsx`) and a fourth copy of a one-slot recipe is
 * how the copies drift.
 */
import type { AssemblyContext, AssemblyTemplate } from '@/assembly'
import type { CatalogFile, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'
import { createCompositionIndex } from '@/composition'
import type { PlacementId, SlotName, TemplateId, TemplateInstance } from '@/store'

const TAGS = [
  'shape|floor',
  'shape|wall',
  'shape|base',
  'texture|dungeon_stone',
  'texture|cave',
  'connection|openlock',
  'connection|openforge',
  'build|separate wall',
  'build|wall on tile',
] as const

const tag = (name: (typeof TAGS)[number]): number => TAGS.indexOf(name)

/** 32 hex characters, distinct per md5 — and `TWIN` shares `FLOOR_1X1`'s. */
const blob = (n: number): string => String(n).repeat(32).slice(0, 32)

/** Every id the tests name, so no test spells a catalog path twice. */
export const FIXTURE_IDS = {
  floor1: 'tiles/dungeon_stone/floors/floor/openlock/dungeon_stone#floor.1x1.openlock.stl',
  floor2: 'tiles/dungeon_stone/floors/floor/openforge/dungeon_stone#floor.2x2.openforge.stl',
  base2: 'tiles/bases/dungeon_stone/base/openlock/dungeon_stone#base.A.openlock.stl',
  wallNoBase: 'tiles/cave/separate_walls/wall/openforge/cave#wall.2x.ZZ.openforge.stl',
  arc: 'tiles/bases/plain/curved/plain#base+curved.2r90.dragonlock.stl',
  slab: 'tiles/cave/components/column/cave#column.col+L.openforge.stl',
  twin: 'tiles/dungeon_stone/starter/floor/openlock/dungeon_stone#floor.1x1.openlock.stl',
  big: 'tiles/mines/floors/floor/openlock/mine#floor.4x4.openlock.stl',
  huge: 'tiles/mines/floors/floor/openforge/mine#floor.4x4.openforge.stl',
} as const

/**
 * Every design the tests name, keyed the same way as {@link FIXTURE_IDS}.
 *
 * Row V1 made the library and the selection channel design-keyed and row V3 made
 * a palette row an item, so a test that files a tile or arms one now spells a
 * design rather than a path. Nine records, nine designs, and the mapping is
 * one-to-one **except** for {@link MIXED_INTEGRAL}, which joins `floor2`'s.
 */
export const FIXTURE_DESIGNS = {
  floor1: 'd-floor-1',
  floor2: 'd-floor-2',
  base2: 'd-base-2',
  wallNoBase: 'd-wall-zz',
  arc: 'd-arc',
  slab: 'd-slab',
  twin: 'd-floor-twin',
  big: 'd-big',
  huge: 'd-huge',
} as const

/** The display names, so an assertion can name a row without repeating a string. */
export const FIXTURE_NAMES = {
  floor1: 'Dungeon Stone Floor 1x1',
  floor2: 'Dungeon Stone Floor 2x2',
  base2: 'Dungeon Stone Base 2x2 A',
  wallNoBase: 'Cave Wall 2x ZZ',
  arc: 'Plain Curved Base 2r90',
  slab: 'Cave Column L',
  twin: 'Dungeon Stone Starter Floor 1x1',
  big: 'Mine Floor 4x4',
  huge: 'Mine Openforge Floor 4x4',
} as const

export const FIXTURE_CATALOG = {
  version: {
    schema: 1,
    pipeline: 1,
    fixtures: 'builder-panels-fixture',
    manifest: 1,
    built: '2026-01-01T00:00:00.000Z',
  },
  assets: {
    models: 'https://objects.openforge.tools/models',
    sprites: 'https://objects.openforge.tools/sprites',
    thumbs: 'https://objects.openforge.tools/thumbs',
    lod: 'https://objects.openforge.tools/lod',
  },
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: [...TAGS],
  records: [
    {
      id: FIXTURE_IDS.floor1,
      ord: 0,
      blob: blob(1),
      file: 'dungeon_stone#floor.1x1.openlock.stl',
      bytes: 1_000_000,
      sprite: true,
      thumb: false,
      family: 'tiles/dungeon_stone/floors/floor/openlock',
      design: 'd-floor-1',
      name: FIXTURE_NAMES.floor1,
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      build: 'separate wall',
      texture: 'dungeon_stone',
      tags: [tag('shape|floor'), tag('texture|dungeon_stone'), tag('connection|openlock')],
      foot: { shape: 'rect', w: 1, d: 1 },
    },
    {
      id: FIXTURE_IDS.floor2,
      ord: 1,
      blob: blob(2),
      file: 'dungeon_stone#floor.2x2.openforge.stl',
      bytes: 8_000_000,
      sprite: true,
      thumb: false,
      family: 'tiles/dungeon_stone/floors/floor/openforge',
      design: 'd-floor-2',
      name: FIXTURE_NAMES.floor2,
      kinds: ['floor'],
      conn: ['openforge'],
      layer: 'topper',
      build: 'separate wall',
      texture: 'dungeon_stone',
      tags: [tag('shape|floor'), tag('texture|dungeon_stone'), tag('connection|openforge')],
      foot: { shape: 'rect', w: 2, d: 2 },
      sizeCode: 'A',
    },
    {
      id: FIXTURE_IDS.base2,
      ord: 2,
      blob: blob(3),
      file: 'dungeon_stone#base.A.openlock.stl',
      bytes: 500_000,
      sprite: true,
      thumb: false,
      family: 'tiles/bases/dungeon_stone/base/openlock',
      design: 'd-base-2',
      name: FIXTURE_NAMES.base2,
      kinds: ['base', 'floor'],
      conn: ['openlock'],
      layer: 'base',
      build: 'separate wall',
      texture: 'dungeon_stone',
      tags: [tag('shape|base'), tag('texture|dungeon_stone'), tag('connection|openlock')],
      foot: { shape: 'rect', w: 2, d: 2 },
      sizeCode: 'A',
    },
    {
      id: FIXTURE_IDS.wallNoBase,
      ord: 3,
      blob: blob(4),
      file: 'cave#wall.2x.ZZ.openforge.stl',
      bytes: 3_000_000,
      sprite: true,
      thumb: false,
      family: 'tiles/cave/separate_walls/wall/openforge',
      design: 'd-wall-zz',
      name: FIXTURE_NAMES.wallNoBase,
      kinds: ['wall'],
      conn: ['openforge'],
      layer: 'topper',
      build: 'wall on tile',
      texture: 'cave',
      tags: [tag('shape|wall'), tag('texture|cave'), tag('connection|openforge')],
      foot: { shape: 'wall', length: 2 },
      sizeCode: 'ZZ',
    },
    {
      id: FIXTURE_IDS.arc,
      ord: 4,
      blob: blob(5),
      file: 'plain#base+curved.2r90.dragonlock.stl',
      bytes: 1_200_000,
      sprite: true,
      thumb: false,
      family: 'tiles/bases/plain/curved',
      design: 'd-arc',
      name: FIXTURE_NAMES.arc,
      kinds: ['base'],
      conn: ['dragonlock'],
      layer: 'base',
      texture: 'plain',
      tags: [tag('shape|base')],
      // A concave curved wall base: the band lies *outside* the tagged radius of
      // 2, which is the case a fixture keyed on a single radius could not express.
      foot: { shape: 'arc', rIn: 2, rOut: 2.5, sweep: 90, band: 'concave', bandBasis: 'measured' },
    },
    {
      id: FIXTURE_IDS.slab,
      ord: 5,
      blob: blob(6),
      file: 'cave#column.col+L.openforge.stl',
      bytes: 900_000,
      sprite: false,
      thumb: false,
      family: 'tiles/cave/components/column',
      design: 'd-slab',
      name: FIXTURE_NAMES.slab,
      kinds: ['column'],
      conn: ['openforge'],
      layer: 'integral',
      texture: 'cave',
      tags: [tag('texture|cave'), tag('connection|openforge')],
      foot: { shape: 'none' },
      sizeCode: 'L',
    },
    {
      // Same md5 as `floor1`, filed under a second catalog path. The bill must
      // publish one line for both and charge 1 MB, not 2.
      id: FIXTURE_IDS.twin,
      ord: 6,
      blob: blob(1),
      file: 'dungeon_stone#floor.1x1.openlock.stl',
      bytes: 1_000_000,
      sprite: true,
      thumb: false,
      family: 'tiles/dungeon_stone/starter/floor/openlock',
      // Its **own** design, though it shares `floor1`'s md5. Row A2 searches
      // aggregates, and a shared design would merge the two into one item — so
      // the twin would stop being a searchable row of its own, which is the
      // thing this record exists to be. It would also break A1's hoisting
      // invariant, which `pipeline/aggregate.ts` fails the build on: the two
      // carry *different display names*, and 0 of the 3,822 live aggregates
      // hold two.
      design: 'd-floor-twin',
      name: FIXTURE_NAMES.twin,
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      build: 'separate wall',
      texture: 'dungeon_stone',
      tags: [tag('shape|floor'), tag('texture|dungeon_stone'), tag('connection|openlock')],
      foot: { shape: 'rect', w: 1, d: 1 },
    },
    {
      id: FIXTURE_IDS.big,
      ord: 7,
      blob: blob(7),
      file: 'mine#floor.4x4.openlock.stl',
      bytes: 600_000_000,
      sprite: true,
      thumb: false,
      family: 'tiles/mines/floors/floor/openlock',
      design: 'd-big',
      name: FIXTURE_NAMES.big,
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      build: 'separate wall',
      texture: 'mine',
      tags: [tag('shape|floor'), tag('connection|openlock')],
      foot: { shape: 'rect', w: 4, d: 4 },
    },
    {
      id: FIXTURE_IDS.huge,
      ord: 8,
      blob: blob(8),
      file: 'mine#floor.4x4.openforge.stl',
      bytes: 1_500_000_000,
      sprite: true,
      thumb: false,
      family: 'tiles/mines/floors/floor/openforge',
      design: 'd-huge',
      name: FIXTURE_NAMES.huge,
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      build: 'separate wall',
      texture: 'mine',
      tags: [tag('shape|floor'), tag('connection|openlock')],
      foot: { shape: 'rect', w: 4, d: 4 },
    },
  ],
}

/** The fixture, through the real parse. */
export function fixtureCatalogFile(): CatalogFile {
  return CatalogFileSchema.parse(FIXTURE_CATALOG)
}

/* -------------------------------------------------- the two-sided item (V3) */

/**
 * A second variant of `FLOOR_2X2`'s design: the same tile, printed as one part.
 *
 * **The nine records above cannot express the bug row V3 fixes.** Every one of
 * them is its own design, so `TileAggregate.preview` and `selectVariant` can only
 * ever name the same file, and a palette that showed the wrong one would still
 * pass. The live corpus has **931 items (24.4%)** carrying both an `integral` and
 * a `topper`, and on **all 931** those two functions disagree — that is the whole
 * of what the owner saw as *"a tile with an integrated base"* in the sidebar.
 *
 * So this record joins `d-floor-2`, making it the corpus's `both` class:
 *
 *   - `preview` is the **topper** (`FIXTURE_IDS.floor2`), by row V5's rule — a
 *     sprite-carrying topper first;
 *   - `selectVariant({ bottom: 'openlock' })` is **this** record, by §5.2's rule
 *     — prefer one part over two.
 *
 * Every hoisted facet is copied from `floor2` deliberately rather than left to
 * drift: `pipeline/aggregate.ts` fails the build when an aggregate holds two
 * names, footprints, textures, size codes, builds or kind lists, and a fixture
 * that broke A1's invariant would be testing an item the importer cannot emit.
 * What differs is exactly the connection axis and its consequences — `layer`,
 * `conn`, `blob`, `bytes`, `file`, `family`, `id`, `ord`.
 *
 * It is a **separate** export rather than a tenth entry in `FIXTURE_CATALOG`,
 * because that object is shared with `generated.test.tsx`, `builder.test.tsx` and
 * the canvas suites, and a tenth record would change bill totals, search counts
 * and the starter set in three files that are not asking about aggregation.
 */
export const MIXED_INTEGRAL = {
  id: 'tiles/dungeon_stone/floors/floor/openlock/dungeon_stone#floor.2x2.openlock.stl',
  ord: 9,
  blob: blob(9),
  file: 'dungeon_stone#floor.2x2.openlock.stl',
  bytes: 9_000_000,
  sprite: true,
  thumb: false,
  family: 'tiles/dungeon_stone/floors/floor/openlock',
  design: FIXTURE_DESIGNS.floor2,
  name: FIXTURE_NAMES.floor2,
  kinds: ['floor'],
  conn: ['openlock'],
  layer: 'integral',
  build: 'separate wall',
  texture: 'dungeon_stone',
  tags: [tag('shape|floor'), tag('texture|dungeon_stone'), tag('connection|openlock')],
  foot: { shape: 'rect', w: 2, d: 2 },
  sizeCode: 'A',
}

/** The nine records plus {@link MIXED_INTEGRAL}, through the real parse. */
export function mixedCatalogFile(): CatalogFile {
  return CatalogFileSchema.parse({
    ...FIXTURE_CATALOG,
    records: [...FIXTURE_CATALOG.records, MIXED_INTEGRAL],
  })
}

/* --------------------------------------------------- the recipes (row A8) */

/**
 * A one-slot recipe: an instance of it is exactly one file.
 *
 * `tags: {}` on the part is deliberate and is not a shortcut — a slot with no
 * `require`, `deny` or `accept` admits **every** record, because `candidatesFor`
 * starts from the whole document list when the require set is empty. So every
 * fill below is admissible and no `fill-off-slot` note appears in any bill these
 * fixtures produce, which keeps the panels' tests about panels rather than about
 * C1's constraint semantics (`src/composition` covers those with 69 ported tests
 * of its own).
 */
export const ONE_SLOT = 'model' as SlotName
export const ONE_SLOT_TEMPLATE_ID = 'panels-one-slot' as TemplateId
export const ONE_SLOT_TEMPLATE: AssemblyTemplate = {
  id: ONE_SLOT_TEMPLATE_ID,
  tags: [],
  parts: [{ name: ONE_SLOT, tags: {} }],
}

/**
 * A two-slot recipe, for the one thing a one-slot one cannot express: a bill
 * whose `parts` exceeds its `placements`.
 *
 * That is the ordinary case in the real build — the 40 shipped templates declare
 * 3 to 5 parts each, 128 over 40 — and it is what the panel's "parts to print"
 * subline is for. Two rather than five because two is enough to make the
 * inequality true, and every extra slot is another fill every test has to supply.
 */
export const TWO_SLOTS = ['floor', 'wall'].map((name) => name as SlotName)
export const TWO_SLOT_TEMPLATE_ID = 'panels-two-slot' as TemplateId
export const TWO_SLOT_TEMPLATE: AssemblyTemplate = {
  id: TWO_SLOT_TEMPLATE_ID,
  tags: [],
  parts: TWO_SLOTS.map((name) => ({ name, tags: {} })),
}

/**
 * The context `resolveInstance` and `buildBillOfTiles` require, over one catalog.
 *
 * Both fields are required arguments rather than defaulted options, which is row
 * A3's point: a resolution with no template has no slots to walk, and one with no
 * composition index cannot say whether a fill belongs in its slot, so a caller
 * that has not decided is a compile error rather than a quiet half-answer.
 *
 * The composition index is built per call and that is fine here — these are
 * nine- to thirteen-record catalogs. The app shares one through
 * `compositionIndexFor`'s `WeakMap`, because over the real corpus it is 10.7 ms
 * and 409,432 bytes.
 */
export function fixtureContext(catalog: CatalogFile): AssemblyContext {
  const byId = new Map<string, AssemblyTemplate>([
    [ONE_SLOT_TEMPLATE_ID, ONE_SLOT_TEMPLATE],
    [TWO_SLOT_TEMPLATE_ID, TWO_SLOT_TEMPLATE],
  ])
  return { templates: (id) => byId.get(id), composition: createCompositionIndex(catalog) }
}

let minted = 0

/**
 * One instance, filled from the files given: a `TemplateInstance` ready for the
 * store or for `buildBillOfTiles`.
 *
 * The recipe follows the **number of entries** — one is {@link ONE_SLOT_TEMPLATE},
 * two is {@link TWO_SLOT_TEMPLATE} — so a test names what it wants printed and
 * never a family.
 *
 * **`null` leaves that slot open**, which is contract **C-g** written as a
 * fixture: §3.2 places a template with a part still empty, so
 * `anInstance([file, null])` is the state `slot-unfilled`,
 * `BillOfTiles.complete` and `useArchiveDownload`'s refusal are all about, and it
 * is the *only* way to produce it — the recipe still declares two slots, so an
 * instance with one entry would be a complete one-slot instance instead.
 *
 * The id is minted per call so two instances are never the same key, and it is
 * deliberately *not* stable across runs of the module — nothing asserts an id,
 * and a fixed one would let a test pass while the store overwrote an entry.
 */
export function anInstance(
  tiles: readonly (string | null)[],
  at: { x?: number; z?: number; rotation?: number } = {},
): TemplateInstance {
  const slots = tiles.length > 1 ? TWO_SLOTS : [ONE_SLOT]
  const filled = tiles.flatMap((tile, index) =>
    tile === null ? [] : [[slots[index] ?? ONE_SLOT, { tile: tile as TileId, pinned: false }] as const],
  )
  minted += 1
  return {
    id: `fixture-p${String(minted)}` as PlacementId,
    template: tiles.length > 1 ? TWO_SLOT_TEMPLATE_ID : ONE_SLOT_TEMPLATE_ID,
    x: at.x ?? 0,
    z: at.z ?? 0,
    rotation: at.rotation ?? 0,
    fills: Object.fromEntries(filled),
  }
}
