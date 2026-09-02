/**
 * A parsed index whose compositions reproduce every branch row C2 has to render.
 *
 * `CatalogFile.parse` runs over it, so a fixture that drifts from the schema
 * fails in the tests rather than rendering something the real index could never
 * produce — A5's rule for `detail.test.tsx`, and the same reason applies harder
 * here, because a `PartSlot` the schema would strip is exactly the kind of
 * silent loss C1 warned about.
 *
 * Each record exists for one branch, and the branches are the corpus's:
 *
 *   - **`wallTowne`** — a base slot alive in its initial state beside a torch
 *     slot with two candidate items, one of which *closes the base slot*. This
 *     is the corpus's dead end in miniature: `constrain: [{ tag: 'texture' }]`
 *     collects `texture|dungeon_stone` from the wall and `texture|towne` from the
 *     picked torch, keeps both because neither is a prefix of the other, and no
 *     base carries both. 416 of 4,330 item picks in the live archive do exactly
 *     this.
 *   - **`wallLow`** — the *rescue*. Its base slot is empty before anything is
 *     picked (the wall contributes `shape|wall|low` and no base is low), and
 *     filling its `top` slot with a piece carrying `shape|wall` makes the base
 *     slot resolvable: `filterSpecificTags` keeps the **most general** survivor,
 *     so `shape|wall|low` is dropped in favour of `shape|wall`. Three picks in
 *     the live archive behave this way.
 *   - **`danglingRef`** — a slot naming a tag the table does not hold, which is
 *     `unknownRefs` and not "nothing matched". **0 live slots**, and the
 *     distinction is a different sentence to show a user.
 *   - **`contradiction`** — requires and denies the same tag. **9 live slots**
 *     are unsatisfiable this way, one of them on `shape|wall` exactly like this.
 *   - **`pairedGrate`** — two slots sharing a `PartSlot.id`. **6 live slots on 3
 *     files**: the left and right halves of one widened corner grate.
 *   - **`baseOnly`** — a `base` slot and nothing else, so the picker must render
 *     nothing at all. **2,031 of 8,702 files** are this case.
 *   - **`plainFloor`** — no config whatsoever. **5,666 files.**
 *   - **`archway`** — two accessory slots where filling one *narrows* the other
 *     without emptying it, and a `{ filter }` entry that decides which of the
 *     parent's tags is inherited. **This case does not occur in the live
 *     archive**: over all 33,221 sibling-effect observations in the corpus a
 *     pick is either inert (94.0%) or fatal (6.0%), and **0 of the 4,760
 *     accessory-to-accessory observations narrow anything**. It is in the
 *     fixture because the mechanism is the row's whole subject and a machine
 *     that only ever grey-outs would pass a test suite that never exercised the
 *     narrowing path. The measurement is in `slots.test.ts`, against the corpus.
 */
import type { CatalogFile as CatalogFileType } from '@/catalog'
import { CatalogFile } from '@/catalog'

/** Ordinals, named so an assertion reads as a case. */
export const ORD = {
  wallTowne: 100,
  wallLow: 101,
  danglingRef: 102,
  contradiction: 103,
  pairedGrate: 104,
  baseOnly: 105,
  plainFloor: 106,
  archway: 107,

  torchStone: 200,
  torchStoneFlex: 201,
  torchTowne: 202,
  baseStone: 203,
  baseWall: 204,
  topWall: 205,
  grateLeft: 206,
  grateRight: 207,
  topTowne: 208,
} as const

const TAGS = [
  'shape|wall',
  'shape|wall|low',
  'shape|base',
  'texture|dungeon_stone',
  'texture|towne',
  'component|torch',
  'component|top',
  'component|grate',
  'size|width|2',
]

const T = {
  wall: 0,
  wallLow: 1,
  base: 2,
  stone: 3,
  towne: 4,
  torch: 5,
  top: 6,
  grate: 7,
  width2: 8,
} as const

function tile(overrides: Record<string, unknown> & { design: string }): Record<string, unknown> {
  return {
    blob: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    bytes: 1_200_000,
    sprite: true,
    thumb: false,
    kinds: ['wall'],
    conn: ['openforge'],
    layer: 'topper',
    texture: 'dungeon_stone',
    foot: { shape: 'wall', length: 2 },
    ...overrides,
  }
}

export const SLOT_CATALOG: CatalogFileType = CatalogFile.parse({
  version: {
    schema: 1,
    pipeline: 1,
    fixtures: 'deadbeef',
    manifest: 1,
    built: '2026-09-01T00:00:00.000Z',
  },
  assets: {
    models: 'https://objects.openforge.tools/models',
    sprites: 'https://objects.openforge.tools/sprites',
    thumbs: 'https://objects.openforge.tools/thumbs',
    lod: 'https://objects.openforge.tools/lod',
  },
  sprite: { rows: 2, cols: 5, tile: 512, frames: 10, defaultFrame: 0 },
  tags: TAGS,
  records: [
    /* ---------------------------------------------------------- the parents */

    tile({
      id: 'tiles/dungeon_stone/walls/torchwall/stone%torchwall.2x.openforge.stl',
      ord: ORD.wallTowne,
      design: 'd-torchwall',
      file: 'stone%torchwall.2x.openforge.stl',
      family: 'tiles/dungeon_stone/walls/torchwall',
      name: 'Dungeon Stone Torch Wall 2x',
      tags: [T.wall, T.stone, T.width2],
      config: {
        parts: [
          // Alive before anything is picked: one base carries
          // `texture|dungeon_stone`. Closed by picking the towne torch.
          { name: 'base', tags: { require: [{ tag: 'shape|base' }], constrain: [{ tag: 'texture' }] } },
          { name: 'torch', optional: true, tags: { require: [{ tag: 'component|torch' }] } },
        ],
      },
    }),

    tile({
      id: 'tiles/dungeon_stone/walls/secret/stone%secret+low.openforge.stl',
      ord: ORD.wallLow,
      design: 'd-secret',
      file: 'stone%secret+low.openforge.stl',
      family: 'tiles/dungeon_stone/walls/secret',
      name: 'Dungeon Stone Secret Door Low',
      tags: [T.wallLow, T.stone, T.width2],
      config: {
        parts: [
          // Empty in its initial state — the wall is `shape|wall|low` and no
          // base is. Opened by the `top` slot's only candidate.
          { name: 'base', tags: { require: [{ tag: 'shape|base' }], constrain: [{ tag: 'shape' }] } },
          { name: 'top', tags: { require: [{ tag: 'component|top' }] } },
        ],
      },
    }),

    tile({
      id: 'tiles/dungeon_stone/walls/statue/stone%statue.stl',
      ord: ORD.danglingRef,
      design: 'd-statue',
      file: 'stone%statue.stl',
      family: 'tiles/dungeon_stone/walls/statue',
      name: 'Dungeon Stone Statue Niche',
      layer: 'integral',
      tags: [T.wall, T.stone],
      config: { parts: [{ name: 'statue', tags: { require: [{ tag: 'component|statue' }] } }] },
    }),

    tile({
      id: 'tiles/dungeon_stone/walls/broken/stone%broken.stl',
      ord: ORD.contradiction,
      design: 'd-broken',
      file: 'stone%broken.stl',
      family: 'tiles/dungeon_stone/walls/broken',
      name: 'Dungeon Stone Broken Section',
      layer: 'integral',
      tags: [T.wall, T.stone],
      config: {
        parts: [
          {
            name: 'broken_section',
            tags: { require: [{ tag: 'shape|wall' }], deny: [{ tag: 'shape|wall' }] },
          },
        ],
      },
    }),

    tile({
      id: 'tiles/cut_stone/s2w/corner/grate%corner.2x2.openforge.stl',
      ord: ORD.pairedGrate,
      design: 'd-grate-corner',
      file: 'grate%corner.2x2.openforge.stl',
      family: 'tiles/cut_stone/s2w/corner',
      name: 'Cut Stone Widened Grate Corner',
      tags: [T.wall, T.stone, T.width2],
      foot: { shape: 'rect', w: 2, d: 2 },
      config: {
        parts: [
          { name: 'grate (left)', id: 'grate', tags: { require: [{ tag: 'component|grate' }] } },
          { name: 'grate (right)', id: 'grate', tags: { require: [{ tag: 'component|grate' }] } },
        ],
      },
    }),

    tile({
      id: 'tiles/dungeon_stone/walls/plain/stone%plain.openforge.stl',
      ord: ORD.baseOnly,
      design: 'd-plain-wall',
      file: 'stone%plain.openforge.stl',
      family: 'tiles/dungeon_stone/walls/plain',
      name: 'Dungeon Stone Plain Wall',
      tags: [T.wall, T.stone],
      config: { parts: [{ name: 'base', tags: { require: [{ tag: 'shape|base' }] } }] },
    }),

    tile({
      id: 'tiles/dungeon_stone/floors/floor/stone%floor.1x1.stl',
      ord: ORD.plainFloor,
      design: 'd-floor',
      file: 'stone%floor.1x1.stl',
      family: 'tiles/dungeon_stone/floors/floor',
      name: 'Dungeon Stone Floor 1x1',
      kinds: ['floor'],
      layer: 'integral',
      tags: [T.stone],
      foot: { shape: 'rect', w: 1, d: 1 },
    }),

    tile({
      id: 'tiles/dungeon_stone/arches/archway/stone%archway.2x.openforge.stl',
      ord: ORD.archway,
      design: 'd-archway',
      file: 'stone%archway.2x.openforge.stl',
      family: 'tiles/dungeon_stone/arches/archway',
      name: 'Dungeon Stone Archway 2x',
      tags: [T.wall, T.stone, T.width2],
      config: {
        parts: [
          { name: 'torch', optional: true, tags: { require: [{ tag: 'component|torch' }] } },
          // The `{ filter }` entry drops the parent's own texture from what the
          // `{ tag: 'texture' }` entry inherits, so this slot starts wide and is
          // narrowed only by what a sibling contributes. Two items before a
          // torch is picked, one after a towne torch, still two after a
          // dungeon_stone one — the filter removes that tag in either direction.
          {
            name: 'lintel',
            optional: true,
            tags: {
              require: [{ tag: 'component|top' }],
              constrain: [{ tag: 'texture' }, { filter: 'texture|dungeon_stone' }],
            },
          },
        ],
      },
    }),

    /* ----------------------------------------------------- what fills them */

    // Two files of ONE item, so a grid card must stand for both: C1's "grid on
    // items, then selectVariant".
    tile({
      id: 'tiles/dungeon_stone/inserts/torch/stone%torch.stl',
      ord: ORD.torchStone,
      design: 'd-torch-stone',
      file: 'stone%torch.stl',
      family: 'tiles/dungeon_stone/inserts/torch',
      name: 'Dungeon Stone Torch',
      kinds: [],
      layer: 'insert',
      tags: [T.torch, T.stone],
      foot: { shape: 'none' },
      config: { fulfills: [{ part: 'torch' }] },
    }),
    tile({
      id: 'tiles/dungeon_stone/inserts/torch/stone%torch.flex.stl',
      ord: ORD.torchStoneFlex,
      design: 'd-torch-stone',
      file: 'stone%torch.flex.stl',
      family: 'tiles/dungeon_stone/inserts/torch',
      name: 'Dungeon Stone Torch',
      kinds: [],
      layer: 'insert',
      bytes: 1_400_000,
      tags: [T.torch, T.stone],
      foot: { shape: 'none' },
      config: { fulfills: [{ part: 'torch' }] },
    }),
    tile({
      id: 'tiles/towne/inserts/torch/towne%torch.stl',
      ord: ORD.torchTowne,
      design: 'd-torch-towne',
      file: 'towne%torch.stl',
      family: 'tiles/towne/inserts/torch',
      name: 'Towne Torch',
      kinds: [],
      layer: 'insert',
      texture: 'towne',
      tags: [T.torch, T.towne],
      foot: { shape: 'none' },
      config: { fulfills: [{ part: 'torch' }] },
    }),

    tile({
      id: 'tiles/dungeon_stone/bases/base/stone%base.2x.stl',
      ord: ORD.baseStone,
      design: 'd-base-stone',
      file: 'stone%base.2x.stl',
      family: 'tiles/dungeon_stone/bases/base',
      name: 'Dungeon Stone Base 2x',
      kinds: ['base'],
      conn: ['openlock'],
      layer: 'base',
      tags: [T.base, T.stone, T.width2],
    }),
    // `shape|wall` and not `shape|wall|low`, which is what makes `wallLow`'s
    // base slot empty until its `top` slot generalises the requirement.
    tile({
      id: 'tiles/dungeon_stone/bases/wallbase/stone%wallbase.2x.stl',
      ord: ORD.baseWall,
      design: 'd-base-wall',
      file: 'stone%wallbase.2x.stl',
      family: 'tiles/dungeon_stone/bases/wallbase',
      name: 'Dungeon Stone Wall Base 2x',
      kinds: ['base'],
      conn: ['openlock'],
      layer: 'base',
      tags: [T.base, T.wall, T.stone, T.width2],
    }),

    tile({
      id: 'tiles/dungeon_stone/inserts/top/stone%top.stl',
      ord: ORD.topWall,
      design: 'd-top',
      file: 'stone%top.stl',
      family: 'tiles/dungeon_stone/inserts/top',
      name: 'Dungeon Stone Secret Door Top',
      kinds: [],
      layer: 'insert',
      tags: [T.top, T.wall, T.stone],
      foot: { shape: 'none' },
      config: { fulfills: [{ part: 'top' }] },
    }),

    tile({
      id: 'tiles/towne/inserts/top/towne%top.stl',
      ord: ORD.topTowne,
      design: 'd-top-towne',
      file: 'towne%top.stl',
      family: 'tiles/towne/inserts/top',
      name: 'Towne Secret Door Top',
      kinds: [],
      layer: 'insert',
      texture: 'towne',
      tags: [T.top, T.wall, T.towne],
      foot: { shape: 'none' },
      config: { fulfills: [{ part: 'top' }] },
    }),

    tile({
      id: 'tiles/cut_stone/inserts/grate/grate%left.stl',
      ord: ORD.grateLeft,
      design: 'd-grate-left',
      file: 'grate%left.stl',
      family: 'tiles/cut_stone/inserts/grate',
      name: 'Cut Stone Grate Left',
      kinds: [],
      layer: 'insert',
      tags: [T.grate, T.stone],
      foot: { shape: 'none' },
      config: { fulfills: [{ part: 'grate (left)' }] },
    }),
    tile({
      id: 'tiles/cut_stone/inserts/grate/grate%right.stl',
      ord: ORD.grateRight,
      design: 'd-grate-right',
      file: 'grate%right.stl',
      family: 'tiles/cut_stone/inserts/grate',
      name: 'Cut Stone Grate Right',
      kinds: [],
      layer: 'insert',
      tags: [T.grate, T.stone],
      foot: { shape: 'none' },
      config: { fulfills: [{ part: 'grate (right)' }] },
    }),
  ],
})

/** The parents, by the branch each one exists for. */
export const PARENT = {
  wallTowne: 'tiles/dungeon_stone/walls/torchwall/stone%torchwall.2x.openforge.stl',
  wallLow: 'tiles/dungeon_stone/walls/secret/stone%secret+low.openforge.stl',
  danglingRef: 'tiles/dungeon_stone/walls/statue/stone%statue.stl',
  contradiction: 'tiles/dungeon_stone/walls/broken/stone%broken.stl',
  pairedGrate: 'tiles/cut_stone/s2w/corner/grate%corner.2x2.openforge.stl',
  baseOnly: 'tiles/dungeon_stone/walls/plain/stone%plain.openforge.stl',
  plainFloor: 'tiles/dungeon_stone/floors/floor/stone%floor.1x1.stl',
  archway: 'tiles/dungeon_stone/arches/archway/stone%archway.2x.openforge.stl',
} as const

/** What fills them. */
export const FILL = {
  torchStone: 'tiles/dungeon_stone/inserts/torch/stone%torch.stl',
  torchStoneFlex: 'tiles/dungeon_stone/inserts/torch/stone%torch.flex.stl',
  torchTowne: 'tiles/towne/inserts/torch/towne%torch.stl',
  topWall: 'tiles/dungeon_stone/inserts/top/stone%top.stl',
  topTowne: 'tiles/towne/inserts/top/towne%top.stl',
} as const
