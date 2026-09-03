/**
 * An eleven-record catalog for the canvas's tests.
 *
 * Small on purpose, and every record is here to exercise one thing the plan view
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
 *   - a **`none`** — the 8.3% of the corpus the plan view must refuse *visibly*,
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
import type { CatalogFile, DesignId } from '@/catalog'
import { CatalogFile as CatalogFileSchema } from '@/catalog'

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
 * The design a fixture *file* belongs to.
 *
 * The bridge row V4 needs in the tests: a scene helper is handed a file id,
 * because that is what a canvas test is about — which outline, which band, which
 * tint — and a placement holds an item. Every record here is its own design, so
 * the conversion is total and injective, and a test that places
 * `FIXTURE_IDS.floor1` still draws exactly `FIXTURE_IDS.floor1`.
 *
 * Throws on an id the fixture does not hold, which is what a test placing a
 * retired tile wants: those tests pass a design id directly (see
 * `plan.test.ts`'s unknown-tile case) rather than asking this to invent one.
 */
export function fixtureDesignOf(tileId: string): DesignId {
  const record = FIXTURE_CATALOG.records.find((candidate) => candidate.id === tileId)
  if (record === undefined) throw new Error(`no fixture record for ${tileId}`)
  return record.design as DesignId
}

/**
 * **Designs** by role — what a test places, since row V4.
 *
 * Every record in this fixture is its own design (eleven records, eleven
 * designs), so this map is one-to-one with {@link FIXTURE_IDS} and a test that
 * places `FIXTURE_DESIGNS.floor1` gets the record at `FIXTURE_IDS.floor1`. That
 * is a property of *this* fixture and not of the corpus, where a design averages
 * 2.28 files; a test that needs an item with two variants builds its own
 * catalog, and `assembly.test.ts` is full of them.
 *
 * {@link FIXTURE_IDS} stays because plenty of questions are still about a file:
 * which blob an instanced mesh keys on, which entry a download pack writes,
 * which record `materialOf` tints.
 */
export const FIXTURE_DESIGNS = {
  floor1: 'd-floor-1',
  floor2: 'd-floor-2',
  wall2: 'd-wall-2',
  angled: 'd-angled',
  arc: 'd-arc',
  arcFallback: 'd-arc-convex',
  column: 'd-column',
  tri: 'd-tri',
  diag: 'd-diag',
  shapeless: 'd-none',
  thickWall: 'd-thick-wall',
} as const

/** Ids by role, so a test reads as its intent rather than as a path. */
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
