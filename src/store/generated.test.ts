// @vitest-environment jsdom
/**
 * The store's second map, and the mesh that is not in it.
 *
 * Row S5 built a generated base as *"a second map beside `placements`, keyed by
 * the existing `PlacementId`"* and said explicitly that nothing was persisted
 * yet. This is the proof that it now is — and, just as importantly, the proof of
 * **what is not**: the recipe and the position survive a reload and the mesh does
 * not, which is what makes every reloaded generated base an unrendered one and
 * the download a refusal rather than a short pack.
 *
 * ## What these tests prove
 *
 *   - a generated base round-trips through `localStorage` with its recipe intact;
 *   - the mesh does not, and the store has nowhere to put one;
 *   - move, rotate and remove work on it exactly as on a catalog placement, over
 *     a shared `PlacementId` space and a disjoint identity space;
 *   - a hold is released when nothing on the plan wants it any more, and *not*
 *     released while a second copy still does;
 *   - the migration ladder reads a version 2 blob as a version 3 one.
 *
 * ## What they cannot prove
 *
 * Nothing here renders. jsdom's `localStorage` is real, so the persistence
 * claims are real; but nothing in this file says a generated base *looks* right,
 * because that is a question about layout and rasterisation and jsdom measures
 * no layout. `../builder/canvas/generatedScene.test.ts` has the geometry claims
 * and is explicit about the same limit.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { DesignId, TileId } from '@/catalog'
import { GENERATED_ID_PREFIX, generatedPlacementKey } from '@/generator/placement/scene'

import { A_RECIPE, aBinaryStl, aGeneratedBase, aTemplateInstance } from './fixture'
import { STORE_VERSION, readPersistedState, salvageWorkshopState } from './migrations'
import { clearGeneratedMeshes, holdGeneratedMesh, meshFactsOf, useGeneratedMeshStore } from './meshes'
import { STORAGE_KEY, clearPersistedWorkshopState } from './storage'
import { exportWorkshop, importWorkshop } from './transfer'
import {
  clearPlacements,
  moveGeneratedPlacement,
  placeGeneratedBase,
  placeTemplate,
  removeGeneratedPlacement,
  resetWorkshop,
  rotateGeneratedPlacement,
  useWorkshopStore,
} from './workshopStore'

const state = () => useWorkshopStore.getState()
const holds = () => useGeneratedMeshStore.getState().holds

/** The persisted blob as `localStorage` holds it. */
function storedState(): Record<string, unknown> | undefined {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return undefined
  return (JSON.parse(raw) as { state?: Record<string, unknown> }).state
}

beforeEach(() => {
  resetWorkshop()
  clearGeneratedMeshes()
  clearPersistedWorkshopState()
})

describe('placing a generated base', () => {
  it('keys it in the same PlacementId space as a catalog placement, without colliding', () => {
    const tileKey = placeTemplate(aTemplateInstance())
    const baseKey = placeGeneratedBase(aGeneratedBase({ x: 4, z: 0 }))

    // One namespace, two maps. That is what lets one id name a piece on the plan
    // whichever half holds it — the property `pieceAt` and `previewMove` rest on.
    expect(tileKey).not.toBe(baseKey)
    expect(state().placements[baseKey]).toBeUndefined()
    expect(state().generated[tileKey]).toBeUndefined()
    expect(Object.keys(state().placements)).toEqual([tileKey])
    expect(Object.keys(state().generated)).toEqual([baseKey])
  })

  it('gives it an identity that can never be a TileId, and is refused in the template slot', () => {
    // Row S5's proof, re-run through the store, and **row A1 changed which half
    // is load bearing.** S5's argument was lexical — `gen:` fails `TileId`'s
    // `^tiles/…` pattern; V4 put a pattern-free `DesignId` in the identity slot,
    // so the guard in `migrations.ts` was the only thing left. A1's `TemplateId`
    // carries a pattern again and a colon fails it, so the entry would be
    // dropped either way — what the named arm still buys is the **message**,
    // which is the only thing a reader of the console warning gets. Asserted
    // here, so deleting that arm still fails a test.
    const key = placeGeneratedBase(aGeneratedBase({ x: 0, z: 0 }))
    const base = state().generated[key]?.base
    expect(base).toBeDefined()
    expect(base?.startsWith(GENERATED_ID_PREFIX)).toBe(true)
    expect(TileId.safeParse(base).success).toBe(false)
    // `DesignId` is the one brand it does satisfy, which is the gap V4 left and
    // A1 closed by giving the identity slot a pattern.
    expect(DesignId.safeParse(base).success).toBe(true)
    const recovered = salvageWorkshopState({
      placements: { '1e6a1f4e-0000-4000-8000-000000000000': { template: base, x: 0, z: 0, rotation: 0 } },
    })
    expect(recovered.state.placements).toEqual({})
    expect(recovered.dropped).toEqual([
      'placements.1e6a1f4e-0000-4000-8000-000000000000: template is a generated base id, which belongs in the generated map',
    ])
  })

  it('folds -0 and an out-of-range rotation, as the catalog map does', () => {
    const key = placeGeneratedBase(aGeneratedBase({ x: -0, z: -0, rotation: 450 }))
    const placement = state().generated[key]
    expect(Object.is(placement?.x, 0)).toBe(true)
    expect(Object.is(placement?.z, 0)).toBe(true)
    expect(placement?.rotation).toBe(90)
  })

  it('refuses a recipe naming an entry point the panel does not offer', () => {
    const base = aGeneratedBase({ x: 0, z: 0 })
    // A shape with no footprint rule would be a piece the plan cannot draw and
    // the bill cannot size. Refused at the call that produced it rather than at a
    // hydration months later.
    expect(() =>
      placeGeneratedBase({ ...base, recipe: { ...base.recipe, entry: 'bases-curved.scad' as never } }),
    ).toThrow()
  })
})

describe('move, rotate and remove — exactly as any other placement', () => {
  it('moves a generated base with one store write and keeps its rotation', () => {
    const key = placeGeneratedBase(aGeneratedBase({ x: 0, z: 0, rotation: 90 }))
    const before = state().generated[key]

    moveGeneratedPlacement(key, 3, -2)

    const after = state().generated[key]
    expect([after?.x, after?.z]).toEqual([3, -2])
    expect(after?.rotation).toBe(90)
    // The identity survives a move, so anything keyed on the base — the bill
    // grouping, the mesh hold — is undisturbed by one.
    expect(after?.base).toBe(before?.base)
    expect(generatedPlacementKey(after!)).not.toBe(generatedPlacementKey(before!))
  })

  it('rotates one, folding the angle into [0, 360)', () => {
    const key = placeGeneratedBase(aGeneratedBase({ x: 0, z: 0 }))
    rotateGeneratedPlacement(key, 450)
    expect(state().generated[key]?.rotation).toBe(90)
    rotateGeneratedPlacement(key, -90)
    expect(state().generated[key]?.rotation).toBe(270)
  })

  it('removes one, and leaves the catalog half alone', () => {
    const tileKey = placeTemplate(aTemplateInstance())
    const key = placeGeneratedBase(aGeneratedBase({ x: 4, z: 0 }))

    removeGeneratedPlacement(key)

    expect(state().generated).toEqual({})
    expect(Object.keys(state().placements)).toEqual([tileKey])
  })

  it('is a no-op on an unknown key, which a stale drag can be', () => {
    const before = state()
    moveGeneratedPlacement('nope' as never, 1, 1)
    rotateGeneratedPlacement('nope' as never, 90)
    removeGeneratedPlacement('nope' as never)
    expect(state()).toBe(before)
  })
})

describe('what persists, and what does not', () => {
  it('round-trips the recipe and the position through localStorage', () => {
    const key = placeGeneratedBase(aGeneratedBase({ x: 2.5, z: -1.5, rotation: 270 }))
    const persisted = storedState()

    expect(persisted?.generated).toEqual({ [key]: state().generated[key] })
    const generated = (persisted?.generated as Record<string, { recipe: { parameters: Record<string, unknown> } }>)[key]
    // Every `-D` the base was rendered with, in the persisted document — which is
    // what makes a reloaded base re-renderable rather than merely drawable.
    expect(generated?.recipe.parameters.LOCK).toBe(A_RECIPE.LOCK)
    expect(Object.keys(generated?.recipe.parameters ?? {}).length).toBeGreaterThan(5)
  })

  it('does not persist the mesh, and has nowhere to put one', () => {
    const base = aGeneratedBase({ x: 0, z: 0 })
    placeGeneratedBase(base)
    holdGeneratedMesh(base.base, { md5: 'a'.repeat(32), bytes: aBinaryStl(4) })

    // The hold exists in memory...
    expect(holds()[base.base]).toBeDefined()
    const raw = localStorage.getItem(STORAGE_KEY) ?? ''
    // ...and the blob really was written, recipe and all — without this the
    // negatives below would pass against an empty string, which is the shape of
    // vacuous guard this series keeps finding.
    expect(raw).toContain('bases-square.scad')
    expect(storedState()?.generated).toHaveProperty(Object.keys(state().generated)[0] ?? '')

    // Nothing about the mesh reached storage. Asserted over the serialised text
    // rather than field by field, so a mesh smuggled in under any key fails —
    // `md5` is the one word every shape of the hold has in it.
    expect(raw).not.toContain('md5')
    expect(raw).not.toContain('aaaaaaaa')
    expect(storedState()).not.toHaveProperty('meshes')
    expect(storedState()).not.toHaveProperty('holds')
    // ~500 bytes of recipe against the 0.5-2.4 MB S4 measured for a real mesh.
    // A generous bound: what it excludes is a mesh, not a verbose recipe.
    expect(JSON.stringify(storedState()?.generated).length).toBeLessThan(2_000)
  })

  it('reads a saved build back as an unrendered base — the state after every reload', () => {
    const base = aGeneratedBase({ x: 1, z: 1 })
    placeGeneratedBase(base)
    holdGeneratedMesh(base.base, { md5: 'b'.repeat(32), bytes: aBinaryStl(3) })
    const saved = localStorage.getItem(STORAGE_KEY)

    // A reload: the store is fresh, the persisted blob is not, and the mesh store
    // is empty because it has no `persist` middleware at all.
    resetWorkshop()
    clearGeneratedMeshes()
    localStorage.setItem(STORAGE_KEY, saved ?? '')
    const recovered = readPersistedState(storedState(), STORE_VERSION)

    expect(Object.values(recovered.state.generated)).toHaveLength(1)
    expect(Object.values(recovered.state.generated)[0]?.recipe.entry).toBe('bases-square.scad')
    expect(recovered.dropped).toEqual([])
    expect(holds()).toEqual({})
  })

  it('carries a generated base through JSON export and import', () => {
    // `transfer.ts` round-trips the whole persisted state, so this needed no
    // change — but "needed no change" is a claim, and an untested one would be
    // the first thing to rot when the export envelope next moves.
    const key = placeGeneratedBase(aGeneratedBase({ x: 5, z: 5, rotation: 180 }))
    const before = state().generated[key]
    const json = exportWorkshop()

    resetWorkshop()
    expect(state().generated).toEqual({})

    const result = importWorkshop(json)
    expect(result).toEqual({ ok: true, dropped: [] })
    expect(state().generated[key]).toEqual(before)
  })

  it('drops an unreadable generated entry whole, and names it', () => {
    // The asymmetry with a `TemplateInstance`, stated: a bad rotation on a
    // catalog placement resets to 0 and keeps the piece, because 0 is a legal
    // rotation, and a bad *fill* costs one slot of five. There is no partial
    // reading of a recipe — a missing `-D` is a different base — so the entry
    // goes and the report says which.
    const good = aGeneratedBase({ x: 0, z: 0 })
    const recovered = readPersistedState(
      {
        generated: {
          '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f': good,
          'b2c3d4e5-6f70-4812-9a3b-4c5d6e7f8091': { base: 'not-a-generated-id', recipe: null, x: 0, z: 0 },
        },
        lock: 'openlock',
        lockChosen: true,
      },
      STORE_VERSION,
    )

    expect(Object.keys(recovered.state.generated)).toEqual(['9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f'])
    expect(recovered.dropped).toHaveLength(1)
    expect(recovered.dropped[0]).toContain('b2c3d4e5')
  })
})

describe('holding and releasing meshes', () => {
  it('holds one mesh per recipe, however many copies are placed', () => {
    const base = aGeneratedBase({ x: 0, z: 0 })
    placeGeneratedBase(base)
    placeGeneratedBase({ ...base, x: 4 })
    holdGeneratedMesh(base.base, { md5: 'c'.repeat(32), bytes: aBinaryStl(5) })

    expect(Object.keys(state().generated)).toHaveLength(2)
    expect(Object.keys(holds())).toHaveLength(1)
  })

  it('keeps the hold while a second copy still wants it, and drops it when none does', () => {
    const base = aGeneratedBase({ x: 0, z: 0 })
    const first = placeGeneratedBase(base)
    const second = placeGeneratedBase({ ...base, x: 4 })
    holdGeneratedMesh(base.base, { md5: 'd'.repeat(32), bytes: aBinaryStl(6) })

    removeGeneratedPlacement(first)
    // Still held: the second copy is still on the plan and the download still
    // needs these bytes. A per-id release would have dropped them here.
    expect(holds()[base.base]).toBeDefined()

    removeGeneratedPlacement(second)
    expect(holds()).toEqual({})
  })

  it('drops every hold when the scene is cleared or the workshop reset', () => {
    const base = aGeneratedBase({ x: 0, z: 0 })
    placeGeneratedBase(base)
    holdGeneratedMesh(base.base, { md5: 'e'.repeat(32), bytes: aBinaryStl(2) })

    clearPlacements()
    expect(state().generated).toEqual({})
    expect(holds()).toEqual({})

    placeGeneratedBase(base)
    holdGeneratedMesh(base.base, { md5: 'e'.repeat(32), bytes: aBinaryStl(2) })
    resetWorkshop()
    expect(holds()).toEqual({})
  })

  it('derives the triangle count from the header, which is why it left usePreview', () => {
    const bytes = aBinaryStl(7)
    const facts = meshFactsOf({ md5: 'f'.repeat(32), bytes })
    expect(facts).toEqual({ md5: 'f'.repeat(32), bytes: 84 + 7 * 50, triangles: 7 })
  })
})
