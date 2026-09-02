/**
 * The filename grammar, the four traps, and the recipe key — without the corpus.
 *
 * `corpus.test.ts` runs all of this against the real 1,963 archived bases and is
 * skipped when the index has not been built. This file is the part that must
 * hold on a machine with no fixtures, and it is written against the specific
 * archived filenames each trap was found in, so a regression names the trap
 * rather than a count.
 */
import { describe, expect, it } from 'vitest'

import { canonicalise, fileDefaults, isFileDefaults, recipeId, recipeKey, roundValue } from './recipe'
import { OPENING_STATE, noteFor, warningFor } from './GeneratorDrawer'
import {
  BaseFilenameError,
  classifyArchiveBase,
  joinKey,
  replayIndex,
  splitBaseFilename,
  sweptRecipe,
} from './resolve'
import { PANEL_ENTRIES, panelSchema } from './schemas'
import { CONNECTIONS, CURVED_CONNECTIONS, RISER_CONNECTIONS, replaySweeps } from './sweep'
import { IDLE_MS, preflight, triangleCount } from './usePreview'

const replayed = replayIndex()
const swept = (file: string) => replayed.get(joinKey(splitBaseFilename(file)))

describe('the filename grammar', () => {
  it('splits a base into four fields', () => {
    expect(splitBaseFilename('plain#base+square.2x2.openlock+topless,magnetic+flex.stl')).toEqual({
      style: 'plain',
      morphology: 'base+square',
      size: '2x2',
      options: 'openlock+topless,magnetic+flex',
    })
  })

  it('does not split on the decimal point inside a radial size', () => {
    // The trap a `split('.')` walks into: five dot-fields for four parts.
    expect(splitBaseFilename('plain#base+curved+radial.4r22.5°.dragonlock.stl').size).toBe('4r22.5°')
  })

  it('keeps a texture style whole, including its own separators', () => {
    const parts = splitBaseFilename('cave%sandstone+2,aggregate#base,thick_wall.IL.dragonlock.stl')
    expect(parts.style).toBe('cave%sandstone+2,aggregate')
    expect(parts.morphology).toBe('base,thick_wall')
  })

  it('refuses a name that is not the grammar', () => {
    expect(() => splitBaseFilename('plain#base+square.2x2.stl')).toThrow(BaseFilenameError)
    expect(() => splitBaseFilename('nohash.2x2.openlock.stl')).toThrow(BaseFilenameError)
    expect(() => splitBaseFilename('plain#base+square.2x2.openlock+topless,magnetic+flex.3mf')).toThrow(
      BaseFilenameError,
    )
  })

  it('refuses a connector list that is not one', () => {
    expect(() => splitBaseFilename('plain#base+square.2x2.OpenLock.stl')).toThrow(/unreadable connector list/)
  })

  it('matches the two spellings of one shape to one key', () => {
    // 21 files say `base+s2w+square+corner` and 8 say `base+square+s2w+corner`.
    // An ordered key matches one and misses the other, silently.
    const a = joinKey(splitBaseFilename('plain#base+s2w+square+corner.2x2.dragonlock.stl'))
    const b = joinKey(splitBaseFilename('plain#base+square+s2w+corner.2x2.dragonlock.stl'))
    expect(a).toBe(b)
  })
})

describe('trap 1 — the filename lock name is not the -D LOCK value', () => {
  it('renders the square archive openlock with LOCK=triplex', () => {
    expect(swept('plain#base+square.2x2.openlock.stl')?.parameters.LOCK).toBe('triplex')
  })

  it('renders the square archive openlock+unsupported with LOCK=openlock', () => {
    expect(swept('plain#base+square.2x2.openlock+unsupported.stl')?.parameters.LOCK).toBe('openlock')
  })

  it('swaps those two for the curved generators', () => {
    expect(swept('plain#base+curved.2x2.openlock.stl')?.parameters.LOCK).toBe('openlock')
    expect(swept('plain#base+curved.2x2.openlock+unsupported.stl')?.parameters.LOCK).toBe('triplex')
    // Stated as the table rather than as the two files, so a table edit fails here.
    expect(CONNECTIONS[1]?.dirname).toBe('openlock')
    expect(CONNECTIONS[1]?.lock).toBe('triplex')
    expect(CURVED_CONNECTIONS[1]?.dirname).toBe('openlock')
    expect(CURVED_CONNECTIONS[1]?.lock).toBe('openlock')
  })

  it('marks the row upstream commented out, which the archive still holds', () => {
    // `("openlock+topless", …)` is `#`-commented in `bases.py` today and the
    // archive holds 19 files from it. Carrying it marked is what makes those
    // resolvable without pretending the current tables would produce them.
    expect(CONNECTIONS.find((row) => row.dirname === 'openlock+topless')?.active).toBe(false)
    expect(swept('plain#base+square.2x2.openlock+topless.stl')?.historical).toBe(true)
    expect(swept('plain#base+square.2x2.openlock+topless,magnetic+flex.stl')?.historical).toBe(false)
  })

  it('carries two LOCK values the .scad file’s own dropdown cannot express', () => {
    const options = panelSchema('bases-square.scad').parameters.find((p) => p.name === 'LOCK')?.options ?? []
    const offered = options.map((option) => String(option.value))
    expect(offered).toEqual(['openlock', 'triplex', 'infinitylock', 'dragonlock', 'none'])
    expect(swept('plain#base+square.2x2.openlock+topless,magnetic+flex.stl')?.parameters.LOCK).toBe('openlock_topless')
    expect(offered).not.toContain('openlock_topless')
    expect(RISER_CONNECTIONS[1]).toEqual({ title: 'dragonlock', lock: 'dragonlocktriplex' })
    expect(swept('plain#riser+square,low.2x2.dragonlock.stl')?.parameters.LOCK).toBe('dragonlocktriplex')
  })
})

describe('trap 2 — option order encodes PRIORITY', () => {
  it('emits the pair at a unit dimension, in that order', () => {
    expect(swept('plain#base+square.1x1.openlock,magnetic+flex.stl')?.priority).toBe('lock')
    expect(swept('plain#base+square.1x1.magnetic+flex,openlock.stl')?.priority).toBe('magnets')
  })

  it('emits one file at PRIORITY=magnets when no dimension is 1', () => {
    expect(swept('plain#base+square.2x2.openlock,magnetic+flex.stl')?.priority).toBe('magnets')
    expect(swept('plain#base+square.2x2.magnetic+flex,openlock.stl')).toBeUndefined()
  })

  it('emits the pair for a notched square, because that sweep sets flip', () => {
    expect(swept('plain#base+square.3x3+notch.openlock,magnetic+flex.stl')?.priority).toBe('lock')
    expect(swept('plain#base+square.3x3+notch.magnetic+flex,openlock.stl')?.priority).toBe('magnets')
  })

  it('pairs unconditionally for hex corners and never for inverted curves', () => {
    expect(swept('plain#base+hex+corner.120°.openlock,magnetic+flex.stl')?.priority).toBe('lock')
    expect(swept('plain#base+hex+corner.120°.magnetic+flex,openlock.stl')?.priority).toBe('magnets')
    expect(swept('plain#base+curved,inverted.3x3+2r.openlock,magnetic+flex.stl')?.priority).toBe('lock')
    expect(swept('plain#base+curved,inverted.3x3+2r.magnetic+flex,openlock.stl')).toBeUndefined()
  })

  it('forces PRIORITY=lock when a row has no magnets at all', () => {
    // `_magnet_setting` overrides the driver's argument in that case.
    expect(swept('plain#base+square.2x2.openlock.stl')?.parameters.PRIORITY).toBe('lock')
    expect(swept('plain#base+square.2x2.openlock.stl')?.parameters.MAGNET_HOLE).toBe(0)
  })
})

describe('trap 3 — every archived base is the inch basis', () => {
  it('passes SQUARE_BASIS="inch" on every non-riser row', () => {
    const rows = replaySweeps().filter((row) => !row.entry.startsWith('risers_'))
    expect(rows.every((row) => row.parameters.SQUARE_BASIS === 'inch')).toBe(true)
  })

  it('passes no basis at all for a riser, which takes the file default', () => {
    expect(Object.keys(swept('plain#riser+square,high.2x2.openlock.stl')?.parameters ?? {}).sort()).toEqual([
      'LOCK',
      'x',
      'y',
      'z',
    ])
    expect(panelSchema('risers_square.scad').parameters.find((p) => p.name === 'SQUARE_BASIS')?.initial).toBe('inch')
  })

  it('reports the three non-inch bases as unarchivable and as non-tiling', () => {
    expect(noteFor('SQUARE_BASIS', { SQUARE_BASIS: 'wyloch' })).toMatch(/No archived base uses this basis/)
    expect(noteFor('SQUARE_BASIS', { SQUARE_BASIS: 'inch' })).toBeNull()
  })

  it('preflights the two combinations the geometry refuses outright', () => {
    expect(preflight({ LOCK: 'dragonlock', SQUARE_BASIS: 'wyloch' })).toBe(
      'ERROR: dragonlock is only compatible with inch basis',
    )
    expect(preflight({ LOCK: 'infinitylock', SQUARE_BASIS: '25mm' })).toMatch(/infinitylock is only compatible/)
    expect(preflight({ LOCK: 'dragonlock', SQUARE_BASIS: 'inch' })).toBeNull()
    expect(preflight({ LOCK: 'openlock', SQUARE_BASIS: 'drc' })).toBeNull()
    expect(warningFor('LOCK', { LOCK: 'dragonlock', SQUARE_BASIS: 'drc' })).toMatch(/refuses this combination/)
  })
})

describe('trap 4 — the row kv does not accumulate', () => {
  it('leaves SUPPORTS at the file default for a row that does not set it', () => {
    // Under the accumulating reading this would be "false", and rows 5 and 6
    // would assemble one argv for two different archived files.
    expect(swept('plain#base+square.2x2.openlock,magnetic+flex.stl')?.parameters.SUPPORTS).toBeUndefined()
    expect(swept('plain#base+square.2x2.openlock+unsupported,magnetic+flex.stl')?.parameters.SUPPORTS).toBe('false')
  })

  it('keeps the two openlock magnet rows distinguishable', () => {
    const a = swept('plain#base+square.2x2.openlock,magnetic+flex.stl')
    const b = swept('plain#base+square.2x2.openlock+unsupported,magnetic+flex.stl')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(recipeKey(sweptRecipe(a!))).not.toBe(recipeKey(sweptRecipe(b!)))
  })

  it('leaves TOPLESS at the file default for dragonlock', () => {
    expect(swept('plain#base+square.2x2.dragonlock,magnetic+flex.stl')?.parameters.TOPLESS).toBeUndefined()
  })
})

describe('classification', () => {
  const classify = (file: string, sizeCode?: string) =>
    classifyArchiveBase(sizeCode === undefined ? { file } : { file, sizeCode }, replayed)

  it('calls a swept file generated', () => {
    expect(classify('plain#base+square.2x2.openlock.stl').kind).toBe('generated')
  })

  it('calls a textured style sculpted', () => {
    const result = classify('dungeon_stone#base+wall.A.dragonlock.stl', 'A')
    expect(result).toEqual({ kind: 'sculpted', texture: 'dungeon_stone' })
  })

  it('calls a letter size a size code, cross-checked against the derived one', () => {
    expect(classify('plain#base+square.E.dragonlock.stl', 'E')).toEqual({ kind: 'size-code', code: 'E' })
    expect(classify('plain#base.BA+mirror.dragonlock.stl', 'BA')).toEqual({ kind: 'size-code', code: 'BA' })
  })

  it('refuses a letter size the pipeline derived differently', () => {
    // The cross-check is the point: one reading of the file agreeing with itself
    // proves nothing, so a code that does not match the tags fails the gate.
    expect(() => classify('plain#base+square.E.dragonlock.stl', 'S')).toThrow(/derived size code/)
  })

  it('separates an unswept coordinate from an unswept shape', () => {
    expect(classify('plain#base+square.6x6.dragonlock.stl').kind).toBe('unswept-coordinate')
    expect(classify('plain#base+s-system.1x1.dragonlock.stl').kind).toBe('unswept-shape')
  })

  it('refuses a plain dimensioned base from no known sweep', () => {
    expect(() => classify('plain#base+trapdoor.2x2.dragonlock.stl')).toThrow(/no sweep this table carries/)
  })

  it('refuses an unknown size form outright', () => {
    expect(() => classify('plain#base+square.ZZ9.dragonlock.stl')).toThrow(BaseFilenameError)
  })
})

describe('the recipe', () => {
  it('fills every declared parameter, so a spelled default is the same recipe', () => {
    const bare = canonicalise('bases-square.scad', { x: 2, y: 2 })
    const spelled = canonicalise('bases-square.scad', { x: 2, y: 2, HEIGHT: 6 })
    expect(recipeKey({ v: 1, entry: 'bases-square.scad', parameters: bare })).toBe(
      recipeKey({ v: 1, entry: 'bases-square.scad', parameters: spelled }),
    )
    expect(Object.keys(bare)).toHaveLength(15)
  })

  it('drops a parameter the schema does not declare', () => {
    expect(canonicalise('bases-square.scad', { x: 2, NOPE: 4 }).NOPE).toBeUndefined()
  })

  it('rounds to 4 dp so a slider cannot fork the key', () => {
    expect(roundValue(2.00000001)).toBe(2)
    expect(roundValue(2.00005)).toBe(2.0001)
    expect(() => roundValue(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('distinguishes the number 2 from the string "2"', () => {
    const a = recipeKey({ v: 1, entry: 'x.scad', parameters: { A: 2 } })
    const b = recipeKey({ v: 1, entry: 'x.scad', parameters: { A: '2' } })
    expect(a).not.toBe(b)
  })

  it('gives a stable 8-character handle', () => {
    const key = recipeKey({ v: 1, entry: 'bases-square.scad', parameters: fileDefaults('bases-square.scad') })
    expect(recipeId(key)).toMatch(/^[0-9a-f]{8}$/)
    expect(recipeId(key)).toBe(recipeId(key))
  })

  it('knows when the values are the file defaults', () => {
    expect(isFileDefaults('bases-square.scad', fileDefaults('bases-square.scad'))).toBe(true)
    expect(isFileDefaults('bases-square.scad', OPENING_STATE['bases-square.scad'])).toBe(false)
  })
})

describe('the schemas, pinned', () => {
  it('offers a schema for every entry point the panel offers', () => {
    for (const entry of PANEL_ENTRIES) expect(panelSchema(entry).parameters.length).toBeGreaterThan(0)
  })

  it('reads 15 parameters in 8 groups for bases-square.scad', () => {
    const schema = panelSchema('bases-square.scad')
    expect(schema.parameters).toHaveLength(15)
    expect(schema.groups).toHaveLength(8)
    // S1's PROVENANCE lists 13 defaults because it writes NOTCH/NOTCH_X/NOTCH_Y
    // as one item. The export names them separately, so the panel draws three.
    expect(schema.parameters.filter((p) => p.name.startsWith('NOTCH')).map((p) => p.name)).toEqual([
      'NOTCH',
      'NOTCH_X',
      'NOTCH_Y',
    ])
  })

  it('reads 6 parameters for risers_square.scad, not the fifteen it assigns', () => {
    // The other nine are assigned below the customizer block, where a later
    // top-level assignment beats the injected one, so `-D` cannot reach them.
    expect(panelSchema('risers_square.scad').parameters.map((p) => p.name)).toEqual([
      'x',
      'y',
      'z',
      'SQUARE_BASIS',
      'LOCK',
      'SUPPORTS',
    ])
  })

  it('carries the initial value inside the enum OpenSCAD injected it into', () => {
    // `CENTER = "none"; // [grid, cube, false]` — three in the brackets, four in
    // the export, `none` first. A bracket parser cannot select the default.
    const center = panelSchema('bases-square.scad').parameters.find((p) => p.name === 'CENTER')
    expect(center?.options.map((option) => String(option.value))).toEqual(['none', 'grid', 'cube', 'false'])
    expect(center?.initial).toBe('none')
  })

  it('has every parameter’s initial value among its own options', () => {
    for (const entry of PANEL_ENTRIES) {
      for (const parameter of panelSchema(entry).parameters) {
        if (parameter.options.length === 0) continue
        expect(parameter.options.map((option) => String(option.value))).toContain(String(parameter.initial))
      }
    }
  })

  it('splits the SQUARE_BASIS labels already, so the panel must not split again', () => {
    const basis = panelSchema('bases-square.scad').parameters.find((p) => p.name === 'SQUARE_BASIS')
    expect(basis?.options.map((option) => option.value)).toEqual(['25mm', 'inch', 'wyloch', 'drc'])
    expect(basis?.options[0]?.label).toBe('25mm - Dwarven Forge/Hirstarts')
  })

  it('offers x and y dropdowns that start at 2, as the file does', () => {
    const x = panelSchema('bases-square.scad').parameters.find((p) => p.name === 'x')
    expect(x?.options.map((option) => option.value)).toEqual([2, 3, 4, 5, 6, 7, 8])
    // Which is why 147 archived bases are unreachable from the form, and why
    // `noteFor` says so rather than the panel inventing a `1`.
    expect(noteFor('x', { x: 1 })).toMatch(/unit dimension/)
  })
})

describe('the panel opens on something the archive holds', () => {
  it('has an opening state for every entry point', () => {
    for (const entry of PANEL_ENTRIES) expect(OPENING_STATE[entry]).toBeDefined()
  })

  it('opens on a recipe the sweep produced, for every entry point', () => {
    // The resolver's own map needs the corpus; what is checkable here is that
    // the opening tuple is one the sweep actually emits, which is the property
    // that makes it resolve.
    const keys = new Set(replaySweeps().map((row) => recipeKey(sweptRecipe(row))))
    for (const entry of PANEL_ENTRIES) {
      const recipe = { v: 1 as const, entry, parameters: canonicalise(entry, OPENING_STATE[entry]) }
      expect(keys.has(recipeKey(recipe))).toBe(true)
    }
  })

  it('does not open on the file defaults, and says why', () => {
    const keys = new Set(replaySweeps().map((row) => recipeKey(sweptRecipe(row))))
    for (const entry of PANEL_ENTRIES) {
      if (entry === 'risers_square.scad') continue
      const recipe = { v: 1 as const, entry, parameters: canonicalise(entry, fileDefaults(entry)) }
      expect(keys.has(recipeKey(recipe))).toBe(false)
    }
    // The risers are the exception: `run_openscad_risers` passes only x, y, z
    // and LOCK, so the file's defaults *are* an archived tuple at z=4.
    const riser = { v: 1 as const, entry: 'risers_square.scad' as const, parameters: canonicalise('risers_square.scad', fileDefaults('risers_square.scad')) }
    expect(keys.has(recipeKey(riser))).toBe(true)
  })
})

describe('the preview contract', () => {
  it('debounces at 350 ms, which is the dispatch policy and S2’s finding', () => {
    expect(IDLE_MS).toBe(350)
  })

  it('reads a triangle count from a binary STL header', () => {
    const mesh = new Uint8Array(84 + 50)
    new DataView(mesh.buffer).setUint32(80, 1, true)
    expect(triangleCount(mesh)).toBe(1)
    expect(triangleCount(new Uint8Array(10))).toBe(0)
  })
})
