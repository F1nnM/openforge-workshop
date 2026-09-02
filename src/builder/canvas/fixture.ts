/**
 * A seven-record catalog for the canvas's tests.
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
 *   - an **`arc`** and a **`none`** — the 29.1% of the corpus the plan view must
 *     refuse *visibly*;
 *   - a **thick wall that arrives as a `rect`** with `kinds: ['wall']`, which is
 *     the case that makes band assignment a two-stage rule rather than a
 *     footprint switch.
 *
 * Exported as a plain object rather than a parsed `CatalogFile` so it travels the
 * real path through `CatalogFile.parse`, which is where a fixture that drifted
 * from the schema gets caught.
 */
import type { CatalogFile } from '@/catalog'
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
      family: 'tiles/cave/curve',
      design: 'd-arc',
      name: 'Cave curve radius 2',
      kinds: ['floor'],
      conn: ['openlock'],
      layer: 'integral',
      texture: 'cave',
      tags: [tag('shape|floor'), tag('texture|cave')],
      foot: { shape: 'arc', radius: 2, angle: 90 },
    },
    {
      id: 'tiles/cave/hex/hex.stl',
      ord: 5,
      blob: blob(6),
      file: 'hex.stl',
      bytes: 5_242_880,
      sprite: false,
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
  ],
}

/** The fixture, validated — the same parse the app's index goes through. */
export function fixtureCatalogFile(): CatalogFile {
  return CatalogFileSchema.parse(FIXTURE_CATALOG)
}

/** Ids by role, so a test reads as its intent rather than as a path. */
export const FIXTURE_IDS = {
  floor1: 'tiles/dungeon_stone/floor/1x1.openlock.stl',
  floor2: 'tiles/dungeon_stone/floor/2x2.openlock.stl',
  wall2: 'tiles/cut_stone/wall/2.openlock.stl',
  angled: 'tiles/wood/floor/2x1,45.openlock.stl',
  arc: 'tiles/cave/curve/r2.openlock.stl',
  shapeless: 'tiles/cave/hex/hex.stl',
  thickWall: 'tiles/cut_stone/thick_wall/2x0.5.openlock.stl',
} as const
