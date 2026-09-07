/**
 * The 40 recipe templates and the 47 generated families, as data.
 *
 * **Generated. Do not edit.** `pipeline/templates.ts` reads the 20 `*.yaml`
 * fixtures beside the JSON, `pipeline/families.ts` derives the families
 * from the built corpus, and this file is what the two emit;
 * `npm run import:catalog` writes it and `pipeline/templates.test.ts` asserts the
 * committed bytes are exactly what the emitter returns, so an edit here fails the
 * suite rather than drifting quietly.
 *
 * `RECIPE_TEMPLATES` is the 40 read from the fixtures and nothing else — all
 * of them `S2W: Wall on Tile`, reaching 35.4% of the corpus.
 * `GENERATED_FAMILIES` is one
 * family per `(role, form, build)` key the emitted tags already carry, each with
 * one required slot denying `shape|base`, plus the bare-base family no such key
 * can name and which requires it.
 * `GENERATED_FAMILY_SIZES` is each family’s size control keyed by family id: a
 * placed instance adds a position’s tags to its `parentTags`, where the slot’s own
 * `constrain` block collects them, so size costs no new resolution code at all.
 * `pipeline/families.ts` carries every measurement behind all three.
 *
 * None of it is in `catalog.json`. No template carries `file_metadata`, so none is
 * an STL and none is a `CatalogRecord`; putting the 40 in the index anyway was
 * measured at +1,260 B brotli and declined. Every ref the families emit is a tag
 * the corpus already carries, so the index gains 0 B and the tag table stays at 930
 * strings. The reason both live in the bundle is that the recipe list is the one
 * part of the builder’s palette that renders before the index lands.
 *
 * 40 templates over 20 fixture files, 128 parts.
 * 47 generated families over 8417 records, 303 size positions.
 */
import type { RecipeTemplate } from './recipeWalk'

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

export const GENERATED_FAMILIES: readonly RecipeTemplate[] = [
  {
    id: 'wall-straight-separate-wall',
    name: 'Wall: Straight (Separate Wall)',
    source: 'wall|straight|separate wall',
    tags: ['role|wall', 'form|straight', 'build|separate wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|straight' }, { tag: 'build|separate wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-straight',
    name: 'Floor: Straight',
    source: 'floor|straight|-',
    tags: ['role|floor', 'form|straight'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|straight' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-curve-separate-wall',
    name: 'Wall: Curve (Separate Wall)',
    source: 'wall|curve|separate wall',
    tags: ['role|wall', 'form|curve', 'build|separate wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|curve' }, { tag: 'build|separate wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-corner-s2w',
    name: 'Wall: Corner (S2W)',
    source: 'wall|corner|s2w',
    tags: ['role|wall', 'form|corner', 'build|s2w'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|corner' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-straight',
    name: 'Wall: Straight',
    source: 'wall|straight|-',
    tags: ['role|wall', 'form|straight'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|straight' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-straight-wall-on-tile',
    name: 'Wall: Straight (Wall on Tile)',
    source: 'wall|straight|wall on tile',
    tags: ['role|wall', 'form|straight', 'build|wall on tile'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|straight' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-straight-s-system',
    name: 'Wall: Straight (S-System)',
    source: 'wall|straight|s-system',
    tags: ['role|wall', 'form|straight', 'build|s-system'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|straight' }, { tag: 'build|s-system' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-straight-thick-wall',
    name: 'Wall: Straight (Thick Wall)',
    source: 'wall|straight|thick wall',
    tags: ['role|wall', 'form|straight', 'build|thick wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|straight' }, { tag: 'build|thick wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-curve-wall-on-tile',
    name: 'Floor: Curve (Wall on Tile)',
    source: 'floor|curve|wall on tile',
    tags: ['role|floor', 'form|curve', 'build|wall on tile'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|curve' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-curve-wall-on-tile',
    name: 'Wall: Curve (Wall on Tile)',
    source: 'wall|curve|wall on tile',
    tags: ['role|wall', 'form|curve', 'build|wall on tile'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|curve' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'column-straight',
    name: 'Column: Straight',
    source: 'column|straight|-',
    tags: ['role|column', 'form|straight'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'role|column' }, { tag: 'form|straight' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-curve',
    name: 'Floor: Curve',
    source: 'floor|curve|-',
    tags: ['role|floor', 'form|curve'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|curve' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-diagonal-separate-wall',
    name: 'Wall: Diagonal (Separate Wall)',
    source: 'wall|diagonal|separate wall',
    tags: ['role|wall', 'form|diagonal', 'build|separate wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|diagonal' }, { tag: 'build|separate wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'stair-straight',
    name: 'Stair: Straight',
    source: 'stair|straight|-',
    tags: ['role|stair', 'form|straight'],
    parts: [
      {
        name: 'stair',
        tags: {
          require: [{ tag: 'role|stair' }, { tag: 'form|straight' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-straight-wall-on-tile',
    name: 'Floor: Straight (Wall on Tile)',
    source: 'floor|straight|wall on tile',
    tags: ['role|floor', 'form|straight', 'build|wall on tile'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|straight' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-straight-s2w',
    name: 'Floor: Straight (S2W)',
    source: 'floor|straight|s2w',
    tags: ['role|floor', 'form|straight', 'build|s2w'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|straight' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'riser-straight',
    name: 'Riser: Straight',
    source: 'riser|straight|-',
    tags: ['role|riser', 'form|straight'],
    parts: [
      {
        name: 'riser',
        tags: {
          require: [{ tag: 'role|riser' }, { tag: 'form|straight' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'roof-straight',
    name: 'Roof: Straight',
    source: 'roof|straight|-',
    tags: ['role|roof', 'form|straight'],
    parts: [
      {
        name: 'roof',
        tags: {
          require: [{ tag: 'role|roof' }, { tag: 'form|straight' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-corner-thick-wall',
    name: 'Wall: Corner (Thick Wall)',
    source: 'wall|corner|thick wall',
    tags: ['role|wall', 'form|corner', 'build|thick wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|corner' }, { tag: 'build|thick wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'stair-curve',
    name: 'Stair: Curve',
    source: 'stair|curve|-',
    tags: ['role|stair', 'form|curve'],
    parts: [
      {
        name: 'stair',
        tags: {
          require: [{ tag: 'role|stair' }, { tag: 'form|curve' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'column-straight-separate-wall',
    name: 'Column: Straight (Separate Wall)',
    source: 'column|straight|separate wall',
    tags: ['role|column', 'form|straight', 'build|separate wall'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'role|column' }, { tag: 'form|straight' }, { tag: 'build|separate wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'riser-curve',
    name: 'Riser: Curve',
    source: 'riser|curve|-',
    tags: ['role|riser', 'form|curve'],
    parts: [
      {
        name: 'riser',
        tags: {
          require: [{ tag: 'role|riser' }, { tag: 'form|curve' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-corner-s2w',
    name: 'Floor: Corner (S2W)',
    source: 'floor|corner|s2w',
    tags: ['role|floor', 'form|corner', 'build|s2w'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|corner' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-corner-s-system',
    name: 'Wall: Corner (S-System)',
    source: 'wall|corner|s-system',
    tags: ['role|wall', 'form|corner', 'build|s-system'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|corner' }, { tag: 'build|s-system' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-corner-wall-on-tile',
    name: 'Wall: Corner (Wall on Tile)',
    source: 'wall|corner|wall on tile',
    tags: ['role|wall', 'form|corner', 'build|wall on tile'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|corner' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-corner',
    name: 'Floor: Corner',
    source: 'floor|corner|-',
    tags: ['role|floor', 'form|corner'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|corner' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'roof-corner',
    name: 'Roof: Corner',
    source: 'roof|corner|-',
    tags: ['role|roof', 'form|corner'],
    parts: [
      {
        name: 'roof',
        tags: {
          require: [{ tag: 'role|roof' }, { tag: 'form|corner' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'decor-straight',
    name: 'Decor: Straight',
    source: 'decor|straight|-',
    tags: ['role|decor', 'form|straight'],
    parts: [
      {
        name: 'decor',
        tags: {
          require: [{ tag: 'role|decor' }, { tag: 'form|straight' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-diagonal-wall-on-tile',
    name: 'Wall: Diagonal (Wall on Tile)',
    source: 'wall|diagonal|wall on tile',
    tags: ['role|wall', 'form|diagonal', 'build|wall on tile'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|diagonal' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'column-corner-s2w',
    name: 'Column: Corner (S2W)',
    source: 'column|corner|s2w',
    tags: ['role|column', 'form|corner', 'build|s2w'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'role|column' }, { tag: 'form|corner' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-octagon-separate-wall',
    name: 'Wall: Octagon (Separate Wall)',
    source: 'wall|octagon|separate wall',
    tags: ['role|wall', 'form|octagon', 'build|separate wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|octagon' }, { tag: 'build|separate wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'stair-corner',
    name: 'Stair: Corner',
    source: 'stair|corner|-',
    tags: ['role|stair', 'form|corner'],
    parts: [
      {
        name: 'stair',
        tags: {
          require: [{ tag: 'role|stair' }, { tag: 'form|corner' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-internal-corner-s2w',
    name: 'Floor: Internal Corner (S2W)',
    source: 'floor|internal_corner|s2w',
    tags: ['role|floor', 'form|internal_corner', 'build|s2w'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|internal_corner' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-curve-s2w',
    name: 'Floor: Curve (S2W)',
    source: 'floor|curve|s2w',
    tags: ['role|floor', 'form|curve', 'build|s2w'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|curve' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-corner-wall-on-tile',
    name: 'Floor: Corner (Wall on Tile)',
    source: 'floor|corner|wall on tile',
    tags: ['role|floor', 'form|corner', 'build|wall on tile'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|corner' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-diagonal',
    name: 'Floor: Diagonal',
    source: 'floor|diagonal|-',
    tags: ['role|floor', 'form|diagonal'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|diagonal' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-diagonal-wall-on-tile',
    name: 'Floor: Diagonal (Wall on Tile)',
    source: 'floor|diagonal|wall on tile',
    tags: ['role|floor', 'form|diagonal', 'build|wall on tile'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|diagonal' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-octagon',
    name: 'Floor: Octagon',
    source: 'floor|octagon|-',
    tags: ['role|floor', 'form|octagon'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|octagon' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-hex-thick-wall',
    name: 'Wall: Hex (Thick Wall)',
    source: 'wall|hex|thick wall',
    tags: ['role|wall', 'form|hex', 'build|thick wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|hex' }, { tag: 'build|thick wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-internal-corner-wall-on-tile',
    name: 'Floor: Internal Corner (Wall on Tile)',
    source: 'floor|internal_corner|wall on tile',
    tags: ['role|floor', 'form|internal_corner', 'build|wall on tile'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|internal_corner' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'floor-internal-corner',
    name: 'Floor: Internal Corner',
    source: 'floor|internal_corner|-',
    tags: ['role|floor', 'form|internal_corner'],
    parts: [
      {
        name: 'floor',
        tags: {
          require: [{ tag: 'role|floor' }, { tag: 'form|internal_corner' }],
          deny: [{ tag: 'shape|base' }, { tag: 'build|s-system' }, { tag: 'build|s2w' }, { tag: 'build|separate wall' }, { tag: 'build|thick wall' }, { tag: 'build|wall on tile' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-internal-corner-separate-wall',
    name: 'Wall: Internal Corner (Separate Wall)',
    source: 'wall|internal_corner|separate wall',
    tags: ['role|wall', 'form|internal_corner', 'build|separate wall'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|internal_corner' }, { tag: 'build|separate wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'column-straight-thick-wall',
    name: 'Column: Straight (Thick Wall)',
    source: 'column|straight|thick wall',
    tags: ['role|column', 'form|straight', 'build|thick wall'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'role|column' }, { tag: 'form|straight' }, { tag: 'build|thick wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'column-straight-wall-on-tile',
    name: 'Column: Straight (Wall on Tile)',
    source: 'column|straight|wall on tile',
    tags: ['role|column', 'form|straight', 'build|wall on tile'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'role|column' }, { tag: 'form|straight' }, { tag: 'build|wall on tile' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'column-diagonal-separate-wall',
    name: 'Column: Diagonal (Separate Wall)',
    source: 'column|diagonal|separate wall',
    tags: ['role|column', 'form|diagonal', 'build|separate wall'],
    parts: [
      {
        name: 'column',
        tags: {
          require: [{ tag: 'role|column' }, { tag: 'form|diagonal' }, { tag: 'build|separate wall' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'wall-straight-s2w',
    name: 'Wall: Straight (S2W)',
    source: 'wall|straight|s2w',
    tags: ['role|wall', 'form|straight', 'build|s2w'],
    parts: [
      {
        name: 'wall',
        tags: {
          require: [{ tag: 'role|wall' }, { tag: 'form|straight' }, { tag: 'build|s2w' }],
          deny: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
  {
    id: 'shape-base',
    name: 'Base (Bare)',
    source: 'shape|base',
    tags: ['shape|base'],
    parts: [
      {
        name: 'base',
        tags: {
          require: [{ tag: 'shape|base' }],
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
        fulfills: [],
      },
    ],
  },
]

export const GENERATED_FAMILY_SIZES: Readonly<
  Record<string, readonly { readonly label: string; readonly tags: readonly string[] }[]>
> = {
  'wall-straight-separate-wall': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '1.5 wide', tags: ['size|width|1.5'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '2 wide by 1.5 deep', tags: ['size|width|2', 'size|depth|1.5'] }, { label: '3 wide', tags: ['size|width|3'] }, { label: '3 wide by 1.5 deep', tags: ['size|width|3', 'size|depth|1.5'] }, { label: '4 wide', tags: ['size|width|4'] }],
  'floor-straight': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '1 wide by 2 deep', tags: ['size|width|1', 'size|depth|2'] }, { label: '1 wide by 3 deep', tags: ['size|width|1', 'size|depth|3'] }, { label: '1 wide by 4 deep', tags: ['size|width|1', 'size|depth|4'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 3 deep', tags: ['size|width|2', 'size|depth|3'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide', tags: ['size|width|3'] }, { label: '3 wide by 1 deep', tags: ['size|width|3', 'size|depth|1'] }, { label: '3 wide by 2 deep', tags: ['size|width|3', 'size|depth|2'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '3 wide by 4 deep', tags: ['size|width|3', 'size|depth|4'] }, { label: '4 wide', tags: ['size|width|4'] }, { label: '4 wide by 1 deep', tags: ['size|width|4', 'size|depth|1'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 3 deep', tags: ['size|width|4', 'size|depth|3'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }, { label: '6 wide by 2 deep', tags: ['size|width|6', 'size|depth|2'] }, { label: '6 wide by 4 deep', tags: ['size|width|6', 'size|depth|4'] }, { label: '6 wide by 6 deep', tags: ['size|width|6', 'size|depth|6'] }, { label: '8 wide by 2 deep', tags: ['size|width|8', 'size|depth|2'] }, { label: '8 wide by 8 deep', tags: ['size|width|8', 'size|depth|8'] }],
  'wall-curve-separate-wall': [{ label: 'any size', tags: [] }, { label: '1.5 wide', tags: ['size|width|1.5'] }, { label: '2 wide', tags: ['size|width|2'] }],
  'wall-corner-s2w': [{ label: 'any size', tags: [] }, { label: '1.5 wide', tags: ['size|width|1.5'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }],
  'wall-straight': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '1.5 wide', tags: ['size|width|1.5'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '3 wide', tags: ['size|width|3'] }, { label: '3 wide by 1.5 deep', tags: ['size|width|3', 'size|depth|1.5'] }, { label: '4 wide', tags: ['size|width|4'] }, { label: '6 wide by 6 deep', tags: ['size|width|6', 'size|depth|6'] }],
  'wall-straight-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '1 wide by 2 deep', tags: ['size|width|1', 'size|depth|2'] }, { label: '1 wide by 3 deep', tags: ['size|width|1', 'size|depth|3'] }, { label: '1 wide by 4 deep', tags: ['size|width|1', 'size|depth|4'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 3 deep', tags: ['size|width|2', 'size|depth|3'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide', tags: ['size|width|3'] }, { label: '3 wide by 2 deep', tags: ['size|width|3', 'size|depth|2'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '3 wide by 4 deep', tags: ['size|width|3', 'size|depth|4'] }, { label: '4 wide', tags: ['size|width|4'] }, { label: '4 wide by 1 deep', tags: ['size|width|4', 'size|depth|1'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 3 deep', tags: ['size|width|4', 'size|depth|3'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'wall-straight-s-system': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '3 wide by 1 deep', tags: ['size|width|3', 'size|depth|1'] }, { label: '4 wide by 1 deep', tags: ['size|width|4', 'size|depth|1'] }],
  'wall-straight-thick-wall': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '3 wide by 1 deep', tags: ['size|width|3', 'size|depth|1'] }, { label: '4 wide by 1 deep', tags: ['size|width|4', 'size|depth|1'] }, { label: '6 wide by 2 deep', tags: ['size|width|6', 'size|depth|2'] }],
  'floor-curve-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }, { label: '6 wide by 6 deep', tags: ['size|width|6', 'size|depth|6'] }, { label: '8 wide by 8 deep', tags: ['size|width|8', 'size|depth|8'] }],
  'wall-curve-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }, { label: '6 wide by 6 deep', tags: ['size|width|6', 'size|depth|6'] }, { label: '8 wide by 8 deep', tags: ['size|width|8', 'size|depth|8'] }],
  'column-straight': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }],
  'floor-curve': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }, { label: '6 wide by 6 deep', tags: ['size|width|6', 'size|depth|6'] }],
  'wall-diagonal-separate-wall': [{ label: 'any size', tags: [] }],
  'stair-straight': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '1.5 wide', tags: ['size|width|1.5'] }, { label: '2 wide by 0.5 deep', tags: ['size|width|2', 'size|depth|0.5'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '4 wide', tags: ['size|width|4'] }],
  'floor-straight-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '1 wide by 2 deep', tags: ['size|width|1', 'size|depth|2'] }, { label: '1 wide by 3 deep', tags: ['size|width|1', 'size|depth|3'] }, { label: '1 wide by 4 deep', tags: ['size|width|1', 'size|depth|4'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 3 deep', tags: ['size|width|2', 'size|depth|3'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide', tags: ['size|width|3'] }, { label: '3 wide by 1 deep', tags: ['size|width|3', 'size|depth|1'] }, { label: '3 wide by 2 deep', tags: ['size|width|3', 'size|depth|2'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '3 wide by 4 deep', tags: ['size|width|3', 'size|depth|4'] }, { label: '4 wide', tags: ['size|width|4'] }, { label: '4 wide by 1 deep', tags: ['size|width|4', 'size|depth|1'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 3 deep', tags: ['size|width|4', 'size|depth|3'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'floor-straight-s2w': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '3 wide by 1 deep', tags: ['size|width|3', 'size|depth|1'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 1 deep', tags: ['size|width|4', 'size|depth|1'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'riser-straight': [{ label: 'any size', tags: [] }, { label: '1 wide by 0.5 deep', tags: ['size|width|1', 'size|depth|0.5'] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 0.5 deep', tags: ['size|width|2', 'size|depth|0.5'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }],
  'roof-straight': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '1 wide by 1.5 deep', tags: ['size|width|1', 'size|depth|1.5'] }, { label: '1 wide by 2 deep', tags: ['size|width|1', 'size|depth|2'] }, { label: '1 wide by 2.5 deep', tags: ['size|width|1', 'size|depth|2.5'] }, { label: '1 wide by 3 deep', tags: ['size|width|1', 'size|depth|3'] }, { label: '1 wide by 3.5 deep', tags: ['size|width|1', 'size|depth|3.5'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 1.5 deep', tags: ['size|width|2', 'size|depth|1.5'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 2.5 deep', tags: ['size|width|2', 'size|depth|2.5'] }, { label: '2 wide by 3 deep', tags: ['size|width|2', 'size|depth|3'] }, { label: '2 wide by 3.5 deep', tags: ['size|width|2', 'size|depth|3.5'] }, { label: '3 wide', tags: ['size|width|3'] }, { label: '3 wide by 1 deep', tags: ['size|width|3', 'size|depth|1'] }, { label: '3 wide by 1.5 deep', tags: ['size|width|3', 'size|depth|1.5'] }, { label: '3 wide by 2 deep', tags: ['size|width|3', 'size|depth|2'] }, { label: '3 wide by 2.5 deep', tags: ['size|width|3', 'size|depth|2.5'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '3 wide by 3.5 deep', tags: ['size|width|3', 'size|depth|3.5'] }, { label: '4 wide', tags: ['size|width|4'] }, { label: '4 wide by 1 deep', tags: ['size|width|4', 'size|depth|1'] }, { label: '4 wide by 1.5 deep', tags: ['size|width|4', 'size|depth|1.5'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 2.5 deep', tags: ['size|width|4', 'size|depth|2.5'] }, { label: '4 wide by 3 deep', tags: ['size|width|4', 'size|depth|3'] }, { label: '4 wide by 3.5 deep', tags: ['size|width|4', 'size|depth|3.5'] }, { label: '5 wide', tags: ['size|width|5'] }, { label: '6 wide', tags: ['size|width|6'] }, { label: '7 wide', tags: ['size|width|7'] }],
  'wall-corner-thick-wall': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }],
  'stair-curve': [{ label: 'any size', tags: [] }],
  'column-straight-separate-wall': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }],
  'riser-curve': [{ label: 'any size', tags: [] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '5 wide by 5 deep', tags: ['size|width|5', 'size|depth|5'] }, { label: '7 wide by 7 deep', tags: ['size|width|7', 'size|depth|7'] }],
  'floor-corner-s2w': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'wall-corner-s-system': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }],
  'wall-corner-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '3 wide', tags: ['size|width|3'] }, { label: '4 wide', tags: ['size|width|4'] }],
  'floor-corner': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'roof-corner': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '1.5 wide by 1.5 deep', tags: ['size|width|1.5', 'size|depth|1.5'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2.5 wide by 2.5 deep', tags: ['size|width|2.5', 'size|depth|2.5'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '3.5 wide by 3.5 deep', tags: ['size|width|3.5', 'size|depth|3.5'] }],
  'decor-straight': [{ label: 'any size', tags: [] }],
  'wall-diagonal-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'column-corner-s2w': [{ label: 'any size', tags: [] }],
  'wall-octagon-separate-wall': [{ label: 'any size', tags: [] }],
  'stair-corner': [{ label: 'any size', tags: [] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }],
  'floor-internal-corner-s2w': [{ label: 'any size', tags: [] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }],
  'floor-curve-s2w': [{ label: 'any size', tags: [] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'floor-corner-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'floor-diagonal': [{ label: 'any size', tags: [] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'floor-diagonal-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'floor-octagon': [{ label: 'any size', tags: [] }],
  'wall-hex-thick-wall': [{ label: 'any size', tags: [] }],
  'floor-internal-corner-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }],
  'floor-internal-corner': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }],
  'wall-internal-corner-separate-wall': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '2 wide', tags: ['size|width|2'] }],
  'column-straight-thick-wall': [{ label: 'any size', tags: [] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }],
  'column-straight-wall-on-tile': [{ label: 'any size', tags: [] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }],
  'column-diagonal-separate-wall': [{ label: 'any size', tags: [] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }],
  'wall-straight-s2w': [{ label: 'any size', tags: [] }, { label: '2 wide', tags: ['size|width|2'] }],
  'shape-base': [{ label: 'any size', tags: [] }, { label: '1 wide', tags: ['size|width|1'] }, { label: '1 wide by 1 deep', tags: ['size|width|1', 'size|depth|1'] }, { label: '1 wide by 2 deep', tags: ['size|width|1', 'size|depth|2'] }, { label: '1 wide by 3 deep', tags: ['size|width|1', 'size|depth|3'] }, { label: '1 wide by 4 deep', tags: ['size|width|1', 'size|depth|4'] }, { label: '1.5 wide', tags: ['size|width|1.5'] }, { label: '2 wide', tags: ['size|width|2'] }, { label: '2 wide by 1 deep', tags: ['size|width|2', 'size|depth|1'] }, { label: '2 wide by 1.5 deep', tags: ['size|width|2', 'size|depth|1.5'] }, { label: '2 wide by 2 deep', tags: ['size|width|2', 'size|depth|2'] }, { label: '2 wide by 3 deep', tags: ['size|width|2', 'size|depth|3'] }, { label: '2 wide by 4 deep', tags: ['size|width|2', 'size|depth|4'] }, { label: '3 wide', tags: ['size|width|3'] }, { label: '3 wide by 1 deep', tags: ['size|width|3', 'size|depth|1'] }, { label: '3 wide by 1.5 deep', tags: ['size|width|3', 'size|depth|1.5'] }, { label: '3 wide by 2 deep', tags: ['size|width|3', 'size|depth|2'] }, { label: '3 wide by 3 deep', tags: ['size|width|3', 'size|depth|3'] }, { label: '3 wide by 4 deep', tags: ['size|width|3', 'size|depth|4'] }, { label: '4 wide', tags: ['size|width|4'] }, { label: '4 wide by 1 deep', tags: ['size|width|4', 'size|depth|1'] }, { label: '4 wide by 2 deep', tags: ['size|width|4', 'size|depth|2'] }, { label: '4 wide by 3 deep', tags: ['size|width|4', 'size|depth|3'] }, { label: '4 wide by 4 deep', tags: ['size|width|4', 'size|depth|4'] }, { label: '5 wide by 5 deep', tags: ['size|width|5', 'size|depth|5'] }, { label: '6 wide by 4 deep', tags: ['size|width|6', 'size|depth|4'] }, { label: '6 wide by 6 deep', tags: ['size|width|6', 'size|depth|6'] }, { label: '7 wide by 7 deep', tags: ['size|width|7', 'size|depth|7'] }, { label: '8 wide by 2 deep', tags: ['size|width|8', 'size|depth|2'] }, { label: '8 wide by 8 deep', tags: ['size|width|8', 'size|depth|8'] }],
}
