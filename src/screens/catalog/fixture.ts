/**
 * A six-record catalog, for the screen's component tests.
 *
 * Small on purpose. The real index has 8,702 records and the engine's own tests
 * (`src/search/corpus.test.ts`) already assert its counts against that corpus;
 * what these tests need is a corpus whose every facet interaction is checkable by
 * hand. Six records is the smallest set that still exhibits all of it:
 *
 *   - a tile in **two** kind buckets (`floor` + `wall`), and one in **none**, so
 *     the multi-select facet and the `!other` bucket both have a subject;
 *   - a **deeper texture path** (`texture|dungeon_stone|eroded`), so prefix
 *     matching has something to match beyond a root;
 *   - two tiles with **no `build|` tag**, so "unspecified" is a real bucket;
 *   - tiles with **two connection systems**, so that facet is genuinely
 *     multi-valued;
 *   - **one tile with no sprite sheet**, mirroring the one live tile of 8,702
 *     that has none;
 *   - **filenames containing `#`, `%`, `+` and `,`** with synthesised display
 *     names that share no substring with them, so a test can tell which of the
 *     two a card is rendering. 98% of real filenames contain one of those
 *     characters and the median is 51 characters long.
 *
 * Exported as a plain object rather than as a parsed `CatalogFile`: the tests
 * hand it to a stubbed `fetch`, so it travels the same path the app's index does
 * — through `CatalogFile.parse`, which is where a fixture that drifted from the
 * schema is caught.
 */

/** The tag intern table. Indices into this are what a record's `tags` holds. */
export const FIXTURE_TAGS = [
  'shape|floor',
  'shape|wall',
  'texture|dungeon_stone',
  'texture|dungeon_stone|eroded',
  'texture|cave',
  'build|separate wall',
  'connection|openlock',
  'shape|base',
  'component|door',
  'texture|wood',
] as const

/** Display names, by ordinal — the strings a card's heading must show. */
export const FIXTURE_NAMES = [
  'Dungeon Stone Floor 2x2',
  'Dungeon Stone Eroded Wall 4x Q',
  'Cave Corner Wall IL',
  'Wood Floor Wall 1x1',
  'Tudor Rectangular Door',
  'Dungeon Stone Base 1x3',
] as const

export const FIXTURE_CATALOG = {
  version: {
    schema: 1,
    pipeline: 1,
    fixtures: '0000000000000000000000000000000000000000',
    manifest: 1,
    built: '2026-09-01T00:00:00.000Z',
  },
  assets: {
    models: 'https://objects.openforge.tools/models',
    sprites: 'https://objects.openforge.tools/sprites',
    thumbs: 'https://objects.openforge.tools/thumbs',
  },
  // The measured layout: 2 rows × 5 columns of 512 px frames, frame 0 default.
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: [...FIXTURE_TAGS],
  records: [
    {
      id: 'tiles/dungeon_stone/floors/floor/openlock/dungeon_stone%2x2#floor.openlock.stl',
      ord: 0,
      blob: '0000000000000000000000000000aaa1',
      file: 'dungeon_stone%2x2#floor.openlock.stl',
      bytes: 8_925_384,
      sprite: true,
      family: 'tiles/dungeon_stone/floors/floor/openlock',
      design: 'dfix000',
      name: FIXTURE_NAMES[0],
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      build: 'separate wall',
      texture: 'dungeon_stone',
      tags: [0, 2, 5, 6],
      foot: { shape: 'rect', w: 2, d: 2 },
    },
    {
      // The deeper texture path: filterable as `dungeon_stone|eroded`, and matched
      // by the `dungeon_stone` root too.
      id: 'tiles/dungeon_stone/separate_walls/wall/openlock/dungeon_stone%eroded+wall.4x#Q,90.openlock.stl',
      ord: 1,
      blob: '0000000000000000000000000000aaa2',
      file: 'dungeon_stone%eroded+wall.4x#Q,90.openlock.stl',
      bytes: 15_853_634,
      sprite: true,
      family: 'tiles/dungeon_stone/separate_walls/wall/openlock',
      design: 'dfix001',
      name: FIXTURE_NAMES[1],
      kinds: ['wall'],
      conn: ['openlock', 'openforge'],
      layer: 'topper',
      build: 'separate wall',
      texture: 'dungeon_stone',
      tags: [1, 3, 5, 6],
      foot: { shape: 'wall', length: 4 },
      sizeCode: 'Q',
    },
    {
      // No `build|` tag — the "unspecified" bucket. Also no derivable footprint,
      // so its size chip falls back to the `size|openlock` code.
      id: 'tiles/cave/thick_wall/wall/corner/dragonlock/cave%aggregate+2#corner.IL+corner,90.dragonlock.stl',
      ord: 2,
      blob: '0000000000000000000000000000aaa3',
      file: 'cave%aggregate+2#corner.IL+corner,90.dragonlock.stl',
      bytes: 4_627_384,
      sprite: true,
      family: 'tiles/cave/thick_wall/wall/corner/dragonlock',
      design: 'dfix002',
      name: FIXTURE_NAMES[2],
      kinds: ['wall'],
      conn: ['dragonlock'],
      layer: 'integral',
      texture: 'cave',
      tags: [1, 4],
      foot: { shape: 'none' },
      sizeCode: 'IL',
    },
    {
      // Two kind buckets at once — 19.5% of the real corpus looks like this.
      id: 'tiles/towne/wood/floor/openlock/wood%planks+a#floor,wall.1x1.openlock.stl',
      ord: 3,
      blob: '0000000000000000000000000000aaa4',
      file: 'wood%planks+a#floor,wall.1x1.openlock.stl',
      bytes: 4_307_234,
      sprite: true,
      family: 'tiles/towne/wood/floor/openlock',
      design: 'dfix003',
      name: FIXTURE_NAMES[3],
      kinds: ['floor', 'wall'],
      conn: ['openlock', 'magnetic'],
      layer: 'topper',
      build: 'wall on tile',
      texture: 'wood',
      tags: [0, 1, 9],
      foot: { shape: 'rect', w: 1, d: 1 },
    },
    {
      // The awkward one: no kind bucket, no build tag, no texture tag, and — like
      // exactly one live tile — no sprite sheet.
      id: 'tiles/tudor/components/door/tudor%rectangular#door.stl',
      ord: 4,
      blob: '0000000000000000000000000000aaa5',
      file: 'tudor%rectangular#door.stl',
      bytes: 45_284,
      sprite: false,
      family: 'tiles/tudor/components/door',
      design: 'dfix004',
      name: FIXTURE_NAMES[4],
      kinds: [],
      conn: [],
      layer: 'insert',
      tags: [8],
      foot: { shape: 'none' },
    },
    {
      id: 'tiles/dungeon_stone/bases/base/openlock/dungeon_stone%base+square.1x3.openlock.stl',
      ord: 5,
      blob: '0000000000000000000000000000aaa6',
      file: 'dungeon_stone%base+square.1x3.openlock.stl',
      bytes: 838_214,
      sprite: true,
      family: 'tiles/dungeon_stone/bases/base/openlock',
      design: 'dfix005',
      name: FIXTURE_NAMES[5],
      kinds: ['base'],
      conn: ['openlock'],
      layer: 'base',
      build: 'separate wall',
      texture: 'dungeon_stone',
      tags: [7, 2, 5, 6],
      foot: { shape: 'rect', w: 1, d: 3 },
    },
  ],
}
