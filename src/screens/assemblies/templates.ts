/**
 * The 40 recipe templates, as data.
 *
 * **Generated. Do not edit.** `corpus.test.ts` asserts this file is
 * byte-identical to `printTemplatesModule(readTemplateFixtures())`, so an edit
 * here fails the suite rather than drifting quietly. `fixtures.ts` carries the
 * provenance: what the 40 are, why they are not in `catalog.json`, and the
 * round-trip proof that the reader which produced them lost nothing.
 *
 * 40 templates over 20 fixture files, 128 parts.
 */
import type { RecipeTemplate } from './assembly'

export const RECIPE_TEMPLATES: readonly RecipeTemplate[] = [
  {
    id: 's2w-wall-on-tile-corner-low-single-piece',
    name: 'S2W: Wall on Tile: Corner: Low (Single Piece)',
    source: 'blueprints.s2w.corner.low.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'shape|corner|low'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'shape|column|corner' }, { tag: 'shape|column|low' }, { tag: 'build|s2w' }, { tag: 'size|column_shape|L' }],
          constrain: [{ tag: 'connection|side', siblings: ['right wall', 'left wall'] }],
        },
        fulfills: [],
      },
      {
        name: 'right wall',
        tags: {
          require: [{ tag: 'build|s2w' }, { tag: 'shape|corner|right' }, { tag: 'shape|wall|low' }, { tag: 'connection|openforge' }, { tag: 'size|width|2' }],
          constrain: [{ tag: 'connection|side', siblings: ['column', 'left wall'] }],
        },
        fulfills: ['base'],
      },
      {
        name: 'left wall',
        tags: {
          require: [{ tag: 'build|s2w' }, { tag: 'shape|corner|left' }, { tag: 'shape|wall|low' }, { tag: 'connection|openforge' }, { tag: 'size|width|2' }],
          constrain: [{ tag: 'connection|side', siblings: ['right wall', 'column'] }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|corner' }, { tag: 'build|s2w' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }, { tag: 'connection|openforge' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-corner-low-modular',
    name: 'S2W: Wall on Tile: Corner: Low (Modular)',
    source: 'blueprints.s2w.corner.low.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'shape|corner|low'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'shape|column|low' }, { tag: 'size|column_shape|L' }],
          deny: [{ tag: 'build|s2w' }],
          constrain: [{ tag: 'connection|side', siblings: ['right wall', 'left wall'] }],
        },
        fulfills: [],
      },
      {
        name: 'right wall',
        tags: {
          require: [{ tag: 'shape|wall|low' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'connection|side', siblings: ['column', 'left wall'] }],
        },
        fulfills: [],
      },
      {
        name: 'left wall',
        tags: {
          require: [{ tag: 'shape|wall|low' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'connection|side', siblings: ['right wall', 'column'] }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|corner' }, { tag: 'build|s2w' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }, { tag: 'connection|openforge' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'build|s2w' }, { tag: 'shape|base|corner' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'shape|base|wall' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'connection', siblings: ['right wall', 'left wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-corner-any-single-piece',
    name: 'S2W: Wall on Tile: Corner (Any, Single Piece)',
    source: 'blueprints.s2w.corner.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'shape|corner'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'shape|column|corner' }, { tag: 'build|s2w' }, { tag: 'size|column_shape|L' }],
          deny: [{ tag: 'shape|column|low' }],
          constrain: [{ tag: 'connection|side', siblings: ['right wall', 'left wall'] }],
        },
        fulfills: [],
      },
      {
        name: 'right wall',
        tags: {
          require: [{ tag: 'build|s2w' }, { tag: 'shape|corner|right' }, { tag: 'connection|openforge' }, { tag: 'size|width|2' }],
          deny: [{ tag: 'shape|column|low' }],
          constrain: [{ tag: 'connection|side', siblings: ['column', 'left wall'] }],
        },
        fulfills: ['base'],
      },
      {
        name: 'left wall',
        tags: {
          require: [{ tag: 'build|s2w' }, { tag: 'shape|corner|left' }, { tag: 'connection|openforge' }, { tag: 'size|width|2' }],
          deny: [{ tag: 'shape|column|low' }],
          constrain: [{ tag: 'connection|side', siblings: ['right wall', 'column'] }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|corner' }, { tag: 'build|s2w' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }, { tag: 'connection|openforge' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-corner-any-modular',
    name: 'S2W: Wall on Tile: Corner (Any, Modular)',
    source: 'blueprints.s2w.corner.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'shape|corner'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'size|column_shape|L' }],
          deny: [{ tag: 'build|s2w' }, { tag: 'shape|column|low' }],
          constrain: [{ tag: 'connection|side', siblings: ['right wall', 'left wall'] }],
        },
        fulfills: [],
      },
      {
        name: 'right wall',
        tags: {
          require: [{ tag: 'shape|wall' }, { tag: 'size|width|1.5' }],
          deny: [{ tag: 'shape|column|low' }],
          constrain: [{ tag: 'connection|side', siblings: ['column', 'left wall'] }],
        },
        fulfills: [],
      },
      {
        name: 'left wall',
        tags: {
          require: [{ tag: 'shape|wall' }, { tag: 'size|width|1.5' }],
          deny: [{ tag: 'shape|column|low' }],
          constrain: [{ tag: 'connection|side', siblings: ['right wall', 'column'] }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|corner' }, { tag: 'build|s2w' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|corner' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'shape|base|wall' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'connection', siblings: ['right wall', 'left wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-internal-corner-low-single-piece',
    name: 'S2W: Wall on Tile: Internal Corner: Low (Single Piece)',
    source: 'blueprints.s2w.internal_corner.low.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'shape|internal_corner|low'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'shape|column|corner' }, { tag: 'shape|column|low' }, { tag: 'build|s2w' }, { tag: 'size|column_shape|L' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|internal_corner' }, { tag: 'build|s2w' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-internal-corner-low-modular',
    name: 'S2W: Wall on Tile: Internal Corner: Low (Modular)',
    source: 'blueprints.s2w.internal_corner.low.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'shape|corner'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'shape|column|low' }, { tag: 'size|column_shape|L' }],
          deny: [{ tag: 'build|s2w' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|internal_corner' }, { tag: 'build|s2w' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'build|s2w' }, { tag: 'shape|base|internal_corner' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'shape|base|wall' }, { tag: 'shape|option|notch' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-internal-corner-single-piece',
    name: 'S2W: Wall on Tile: Internal Corner (Single Piece)',
    source: 'blueprints.s2w.internal_corner.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'shape|internal_corner'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'shape|column|corner' }, { tag: 'build|s2w' }, { tag: 'size|column_shape|L' }],
          deny: [{ tag: 'shape|column|low' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|internal_corner' }, { tag: 'build|s2w' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-internal-corner-modular',
    name: 'S2W: Wall on Tile: Internal Corner (Modular)',
    source: 'blueprints.s2w.internal_corner.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'shape|corner'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'size|column_shape|L' }],
          deny: [{ tag: 'shape|column|low' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|internal_corner' }, { tag: 'build|s2w' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|internal_corner' }, { tag: 'size|width|2' }, { tag: 'size|depth|2' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'shape|base|wall' }, { tag: 'shape|option|notch' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-arrow-slit-single-piece',
    name: 'S2W: Wall on Tile: Wall: Arrow Slit (Single Piece)',
    source: 'blueprints.s2w.wall.arrow_slit.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|arrow_slit', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|arrow_slit' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-arrow-slit-modular',
    name: 'S2W: Wall on Tile: Wall: Arrow Slit (Modular)',
    source: 'blueprints.s2w.wall.arrow_slit.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|arrow_slit', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|arrow_slit' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-boss-door-single-piece',
    name: 'S2W: Wall on Tile: Wall: Boss Door (Single Piece)',
    source: 'blueprints.s2w.wall.boss_door.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|boss_door', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|boss_door' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-boss-door-modular',
    name: 'S2W: Wall on Tile: Wall: Boss Door (Modular)',
    source: 'blueprints.s2w.wall.boss_door.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|boss_door', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|boss_door' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-arched-door-single-piece',
    name: 'S2W: Wall on Tile: Wall: Arched Door (Single Piece)',
    source: 'blueprints.s2w.wall.door+arched.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|door|arched', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|door|arched' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-arched-door-modular',
    name: 'S2W: Wall on Tile: Wall: Arched Door (Modular)',
    source: 'blueprints.s2w.wall.door+arched.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|door|arched', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|door|arched' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-rectangular-door-single-piece',
    name: 'S2W: Wall on Tile: Wall: Rectangular Door (Single Piece)',
    source: 'blueprints.s2w.wall.door+rectangle.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|door|rectangular', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|door|rectangular' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-rectangular-door-modular',
    name: 'S2W: Wall on Tile: Wall: Rectangular Door (Modular)',
    source: 'blueprints.s2w.wall.door+rectangle.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|door|rectangular', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|door|rectangular' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-drain-single-piece',
    name: 'S2W: Wall on Tile: Wall: Drain (Single Piece)',
    source: 'blueprints.s2w.wall.drain.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|drain', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|drain' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-drain-modular',
    name: 'S2W: Wall on Tile: Wall: Drain (Modular)',
    source: 'blueprints.s2w.wall.drain.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|drain', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|drain' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-grate-single-piece',
    name: 'S2W: Wall on Tile: Wall: Grate (Single Piece)',
    source: 'blueprints.s2w.wall.grate.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|grate', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|grate' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-grate-modular',
    name: 'S2W: Wall on Tile: Wall: Grate (Modular)',
    source: 'blueprints.s2w.wall.grate.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|grate', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|grate' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-magnetic-single-piece',
    name: 'S2W: Wall on Tile: Wall: Magnetic (Single Piece)',
    source: 'blueprints.s2w.wall.magnetic.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|magnetic', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|magnetic' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-magnetic-modular',
    name: 'S2W: Wall on Tile: Wall: Magnetic (Modular)',
    source: 'blueprints.s2w.wall.magnetic.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|magnetic', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|magnetic' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-niche-single-piece',
    name: 'S2W: Wall on Tile: Wall: Niche (Single Piece)',
    source: 'blueprints.s2w.wall.niche.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|niche', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|niche' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-niche-modular',
    name: 'S2W: Wall on Tile: Wall: Niche (Modular)',
    source: 'blueprints.s2w.wall.niche.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|niche', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|niche' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-portcullis-single-piece',
    name: 'S2W: Wall on Tile: Wall: Portcullis (Single Piece)',
    source: 'blueprints.s2w.wall.portcullis.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|portcullis', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|portcullis' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-portcullis-modular',
    name: 'S2W: Wall on Tile: Wall: Portcullis (Modular)',
    source: 'blueprints.s2w.wall.portcullis.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|portcullis', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|portcullis' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-secret-door-single-piece',
    name: 'S2W: Wall on Tile: Wall: Secret Door (Single Piece)',
    source: 'blueprints.s2w.wall.secret_door.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|secret_door', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|secret_door' }, { tag: 'interface|secret_door|bottom' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-secret-door-modular',
    name: 'S2W: Wall on Tile: Wall: Secret Door (Modular)',
    source: 'blueprints.s2w.wall.secret_door.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|secret_door', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|secret_door' }, { tag: 'interface|secret_door|bottom' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-torch-single-piece',
    name: 'S2W: Wall on Tile: Wall: Torch (Single Piece)',
    source: 'blueprints.s2w.wall.torch.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|torch', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|torch' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-torch-modular',
    name: 'S2W: Wall on Tile: Wall: Torch (Modular)',
    source: 'blueprints.s2w.wall.torch.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|torch', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|torch' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-low-wall-single-piece',
    name: 'S2W: Wall on Tile: Wall: Low Wall (Single Piece)',
    source: 'blueprints.s2w.wall.wall+low.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|wall|low', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'shape|wall|low' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }, { tag: 'component|secret_door' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-low-wall-modular',
    name: 'S2W: Wall on Tile: Wall: Low Wall (Modular)',
    source: 'blueprints.s2w.wall.wall+low.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|wall|low', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'shape|wall|low' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }, { tag: 'component|secret_door' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-wall-single-piece',
    name: 'S2W: Wall on Tile: Wall: Wall (Single Piece)',
    source: 'blueprints.s2w.wall.wall.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|wall', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|wall' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-wall-modular',
    name: 'S2W: Wall on Tile: Wall: Wall (Modular)',
    source: 'blueprints.s2w.wall.wall.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|wall', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|wall' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-arched-window-single-piece',
    name: 'S2W: Wall on Tile: Wall: Arched Window (Single Piece)',
    source: 'blueprints.s2w.wall.window+arched.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|window|arched', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|window|arched' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-arched-window-modular',
    name: 'S2W: Wall on Tile: Wall: Arched Window (Modular)',
    source: 'blueprints.s2w.wall.window+arched.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|window|arched', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|window|arched' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-square-window-single-piece',
    name: 'S2W: Wall on Tile: Wall: Square Window (Single Piece)',
    source: 'blueprints.s2w.wall.window+square.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'component|window|square', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|window|square' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-square-window-modular',
    name: 'S2W: Wall on Tile: Wall: Square Window (Modular)',
    source: 'blueprints.s2w.wall.window+square.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'component|window|square', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'component|window|square' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-any-single-piece',
    name: 'S2W: Wall on Tile: Wall (Any, Single Piece)',
    source: 'blueprints.s2w.wall.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|single_piece', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'shape|wall' }, { tag: 'connection|openforge' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: ['base'],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|square' }],
          deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 's2w-wall-on-tile-wall-any-modular',
    name: 'S2W: Wall on Tile: Wall (Any, Modular)',
    source: 'blueprints.s2w.wall.yaml',
    tags: ['object|tile', 'object|tile|wall_on_tile', 'build|s2w', 'build|s2w|modular', 'shape|wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'build|separate wall' }, { tag: 'shape|wall' }],
          deny: [{ tag: 'shape|curved' }, { tag: 'size|width|1.5' }],
          constrain: [{ tag: 'size|width' }],
        },
        fulfills: [],
      },
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'shape|floor' }, { tag: 'shape|floor|wall' }, { tag: 'build|s2w' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }, { tag: 'shape|base|wall' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base|corner' }, { tag: 'shape|option|notch' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }, { tag: 'connection', siblings: ['wall'] }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
        },
        fulfills: [],
      },
    ],
  },
]
