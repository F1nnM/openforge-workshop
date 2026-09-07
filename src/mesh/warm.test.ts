/// <reference types="node" />
/**
 * The trigger, and the four moments it has to cover.
 *
 * `tiers.ts` ships a policy whose value is zero without a call site — with no
 * conversion triggered the 3D builder draws a footprint plate for every tile in
 * every room — so this suite is the evidence that there is exactly one call
 * site, that it fires at each of the four moments a placed mesh can be missing,
 * and that it does *not* fire on the hundreds of store writes a drag emits.
 *
 * Every assertion drives the **real store** through `placeTemplate`, `fillSlot`
 * and `setLockSystem` and reads what a recording queue was asked for, so nothing
 * here can pass against a mocked subscription.
 *
 * ## The fourth moment is new, and the trigger it replaces could not see it
 *
 * The previous version reconciled on `(library, lock)` and covered three
 * moments: an item saved, an app load with a library in it, and a lock change. A
 * **share link** writes `placements` and never touched `library`, so a room
 * opened from a link drew nothing until the user happened to save one of its
 * items. So did an *armed* palette row: `PalettePanel.tsx#arm` sets the selection
 * and the tool and never adds to the library, which made "arm, place, look at
 * the room" a permanently cold room. Both are the same defect and both are
 * closed by the placement being the request.
 *
 * ## What it cannot prove
 *
 * The queue is a recorder. Nothing here fetches an STL, runs the simplifier,
 * writes IndexedDB or draws a triangle, so *"the mesh appears"* is not a claim
 * this file makes — `queue.test.ts` covers the fetch-convert-cache path and only
 * a browser can show the pixels. What is proved is exactly the seam: which blobs
 * this module asks for, in which tier, on which store event.
 */
import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { PRINT_OPTIONS } from '@/assembly'
import type { AggregateIndex, BlobId, CatalogFile as CatalogFileType, TileId } from '@/catalog'
import { CatalogFile, buildAggregateIndex, selectVariant } from '@/catalog'
import type { SlotName as SlotNameType } from '@/store'
import {
  SlotName,
  TemplateId,
  clearPlacements,
  fillSlot,
  movePlacement,
  placeTemplate,
  rotatePlacement,
  setLockSystem,
  useWorkshopStore,
} from '@/store'

import { resetMeshContext, setCatalogLoader } from './context'
import type { MeshQueue, MeshRequest } from './queue'
import { planSceneMeshes } from './tiers'
import { sceneTiles, startSceneWarming } from './warm'

let cachedFile: CatalogFileType | undefined
let cachedIndex: AggregateIndex | undefined

function catalogFile(): CatalogFileType {
  cachedFile ??= CatalogFile.parse(JSON.parse(readFileSync('public/catalog/catalog.json', 'utf8')))
  return cachedFile
}

function index(): AggregateIndex {
  cachedIndex ??= buildAggregateIndex(catalogFile())
  return cachedIndex
}

/**
 * A template id and slot names parsed here rather than imported from
 * `@/store/fixture`.
 *
 * That fixture reaches `@/generator/**` for its generated-base half, and this
 * suite needs three branded strings. Parsing them through the schema keeps the
 * mesh suite's imports to the store's own barrel and the catalog.
 */
const A_TEMPLATE = TemplateId.parse('s2w-wall-on-tile-corner-low-single-piece')
const SLOTS: readonly SlotNameType[] = ['column', 'right wall', 'left wall', 'floor', 'base'].map((name) =>
  SlotName.parse(name),
)

/** Real catalog files, so `AggregateIndex.byTile` resolves them. */
function tilesFromCorpus(count: number, from = 0): readonly TileId[] {
  return index().aggregates.slice(from, from + count).map((aggregate) => aggregate.preview)
}

function blobOf(tile: TileId): BlobId {
  const variant = index().byTile.get(tile)
  expect(variant).toBeDefined()
  return variant!.blob
}

/** An instance filling its first `tiles.length` slots with real files. */
function instanceOf(tiles: readonly TileId[], at = 0): Parameters<typeof placeTemplate>[0] {
  const fills: Record<string, { tile: TileId; pinned: boolean }> = {}
  tiles.forEach((tile, i) => {
    const slot = SLOTS[i]
    if (slot !== undefined) fills[slot] = { tile, pinned: false }
  })
  return { template: A_TEMPLATE, x: at, z: 0, rotation: 0, fills }
}

/** A queue that records what it was asked for and nothing else. */
function recordingQueue(): MeshQueue & { readonly asked: MeshRequest[] } {
  const asked: MeshRequest[] = []
  return {
    asked,
    request: (requests) => {
      asked.push(...requests)
      return Promise.resolve()
    },
    state: () => ({
      tasks: new Map(),
      eagerPending: 0,
      backgroundPending: 0,
      remainingBytes: 0,
      failed: [],
      uncached: false,
    }),
    subscribe: () => () => undefined,
    cancel: () => undefined,
    dispose: () => undefined,
  }
}

/** Let the reconcile's promise chain drain. Two turns: the context, then the plan. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

function arm(): void {
  setCatalogLoader(() => Promise.resolve(catalogFile()))
}

afterEach(() => {
  clearPlacements()
  setLockSystem('openlock')
  resetMeshContext()
  vi.restoreAllMocks()
})

describe('sceneTiles — contract C-d', () => {
  it('is every file every filled slot names, deduplicated', () => {
    const tiles = tilesFromCorpus(3)
    placeTemplate(instanceOf(tiles, 0))
    // A second instance sharing one file with the first: the set is over files,
    // not over slots, so the shared one appears once.
    placeTemplate(instanceOf([tiles[0]!, ...tilesFromCorpus(2, 10)], 4))

    const derived = sceneTiles(useWorkshopStore.getState().placements)
    expect(new Set(derived).size).toBe(derived.length)
    expect([...derived].sort()).toEqual([...new Set([...tiles, ...tilesFromCorpus(2, 10)])].sort())
  })

  it('skips an unfilled slot rather than reporting one — contract C-a', () => {
    // `placeTemplate` accepts an incomplete `fills` map by design (C-g), so an
    // instance with one of five slots filled is an ordinary state.
    placeTemplate(instanceOf(tilesFromCorpus(1)))
    expect(sceneTiles(useWorkshopStore.getState().placements)).toHaveLength(1)
  })

  it('answers an instance with no fills at all with nothing', () => {
    placeTemplate({ template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} })
    expect(sceneTiles(useWorkshopStore.getState().placements)).toEqual([])
  })

  it('answers an empty scene with nothing', () => {
    expect(sceneTiles(useWorkshopStore.getState().placements)).toEqual([])
  })
})

describe('startSceneWarming — the four moments', () => {
  it('warms a room that was already saved when the app loaded', async () => {
    // Moment 2, and the one a placement hook fires never for: nothing is placed
    // during this session, the instances came back from `localStorage`.
    const tiles = tilesFromCorpus(2)
    placeTemplate(instanceOf(tiles))
    const queue = recordingQueue()
    arm()

    const stop = startSceneWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    stop()

    const eager = queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob)
    for (const tile of tiles) expect(eager).toContain(blobOf(tile))
  })

  it('warms a template the moment it is placed, which is the arm-then-place defect', async () => {
    // Moment 1 — and the confirmation that the live defect is fixed.
    // `PalettePanel#arm` never added to the library, so on the old trigger this
    // sequence warmed nothing at all: the placement is now the request.
    const queue = recordingQueue()
    arm()
    const stop = startSceneWarming({ queueFor: () => queue })
    expect(queue.asked).toEqual([])

    const tiles = tilesFromCorpus(2, 20)
    placeTemplate(instanceOf(tiles))
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    stop()

    const eager = queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob)
    for (const tile of tiles) expect(eager).toContain(blobOf(tile))
  })

  it('re-warms when a lock change re-solves a fill onto another file', async () => {
    // Moment 3. After A1 a lock change is a *re-solve*: `setLockSystem` writes
    // the preference and C2 walks the slots calling `fillSlot`. So the item is
    // chosen for resolving to different files under the two preferences, and the
    // assertion is that the second reconcile asks for the file the first did not.
    const changed = index().aggregates.find((aggregate) => {
      const open = selectVariant(aggregate, { options: PRINT_OPTIONS, bottom: 'openlock' }).variant
      const dragon = selectVariant(aggregate, { options: PRINT_OPTIONS, bottom: 'dragonlock' }).variant
      return open.blob !== dragon.blob
    })
    expect(changed).toBeDefined()
    const open = selectVariant(changed!, { options: PRINT_OPTIONS, bottom: 'openlock' }).variant
    const dragon = selectVariant(changed!, { options: PRINT_OPTIONS, bottom: 'dragonlock' }).variant

    const id = placeTemplate(instanceOf([open.id]))
    const queue = recordingQueue()
    arm()
    const stop = startSceneWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    const first = new Set(queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob))
    expect(first).toContain(open.blob)

    setLockSystem('dragonlock')
    expect(fillSlot(id, SLOTS[0]!, dragon.id)).toBe('filled')
    await vi.waitFor(() => {
      expect(queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob)).toContain(dragon.blob)
    })
    stop()
  })

  it('warms placements a share link landed that were never converted here', async () => {
    // Moment 4, and the one the `(library, lock)` trigger could not see at all:
    // a link writes `placements` and nothing else, so on the old trigger a
    // linked room stayed cold until its items happened to be saved.
    const queue = recordingQueue()
    arm()
    const stop = startSceneWarming({ queueFor: () => queue })
    await settle()
    expect(queue.asked).toEqual([])

    // What the share codec's import does: several instances, none of them ever
    // armed, saved or placed by hand on this machine.
    const landed = [tilesFromCorpus(3, 40), tilesFromCorpus(3, 60), tilesFromCorpus(3, 80)]
    landed.forEach((tiles, at) => placeTemplate(instanceOf(tiles, at * 4)))

    await vi.waitFor(() => {
      const eager = queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob)
      for (const tile of landed.flat()) expect(eager).toContain(blobOf(tile))
    })
    stop()
  })
})

describe('startSceneWarming — the derived set is the diff', () => {
  it('does not reconcile on a drag, which is hundreds of writes to `placements`', async () => {
    // The reason the old module's one-`===`-per-slice diff does not transfer:
    // `placements` is replaced by identity on every move and rotate, so the slice
    // check is no longer a proxy for "the meshes changed". The derived file set
    // is, and this is the assertion that it short-circuits.
    const id = placeTemplate(instanceOf(tilesFromCorpus(3, 100)))
    const queue = recordingQueue()
    arm()
    const stop = startSceneWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    const settled = queue.asked.length

    for (let step = 1; step <= 40; step += 1) movePlacement(id, step * 0.5, 0)
    rotatePlacement(id, 90)
    await settle()
    stop()

    expect(queue.asked.length).toBe(settled)
  })

  it('does not reconcile when a re-solve writes the file that was already there', async () => {
    // `fillSlot` returns `'unchanged'` and hands back the identical state object,
    // so the subscription is not even woken — and if it were, the set is equal.
    const tiles = tilesFromCorpus(2, 120)
    const id = placeTemplate(instanceOf(tiles))
    const queue = recordingQueue()
    arm()
    const stop = startSceneWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    const settled = queue.asked.length

    expect(fillSlot(id, SLOTS[0]!, tiles[0]!)).toBe('unchanged')
    await settle()
    stop()

    expect(queue.asked.length).toBe(settled)
  })

  it('reconciles again when a fill changes, so the short-circuit is not a one-shot', async () => {
    // The other side of the short-circuit. A reconcile re-asks for the *whole*
    // scene rather than the delta — collapsing a blob already held is
    // `queue.request`'s job and it is documented as idempotent — so what this
    // asserts is that the second reconcile happened at all.
    const first = tilesFromCorpus(1, 140)
    const id = placeTemplate(instanceOf(first))
    const queue = recordingQueue()
    arm()
    const stop = startSceneWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })

    const second = tilesFromCorpus(1, 160)
    expect(fillSlot(id, SLOTS[1]!, second[0]!)).toBe('filled')
    await vi.waitFor(() => {
      expect(queue.asked.map((one) => one.blob)).toContain(blobOf(second[0]!))
    })
    stop()

    // The first file is in the second reconcile too; the queue is what collapses
    // it, and this recorder deliberately does not.
    expect(queue.asked.filter((one) => one.blob === blobOf(first[0]!) && one.tier === 'eager').length).toBeGreaterThan(
      1,
    )
  })
})

describe('startSceneWarming — the states it must survive', () => {
  it('resolves no catalog at all for an empty room', async () => {
    // The reason a first-time visitor to the landing screen pays nothing for
    // this: an empty scene is answered without touching the 5.6 MB index.
    const loader = vi.fn(() => Promise.resolve(catalogFile()))
    setCatalogLoader(loader)
    expect(useWorkshopStore.getState().placements).toEqual({})

    const stop = startSceneWarming({ queueFor: () => recordingQueue() })
    await settle()
    stop()

    expect(loader).not.toHaveBeenCalled()
  })

  it('resolves no catalog for a room of wholly unfilled instances', async () => {
    // The state `placeTemplate` produces when the solver found no candidate for
    // any slot — §3.2's "places anyway". `placements` is non-empty and there is
    // still nothing to convert.
    const loader = vi.fn(() => Promise.resolve(catalogFile()))
    setCatalogLoader(loader)
    placeTemplate({ template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} })

    const stop = startSceneWarming({ queueFor: () => recordingQueue() })
    await settle()
    stop()

    expect(loader).not.toHaveBeenCalled()
  })

  it('warms the fills it can resolve and skips one this build no longer holds — contract C-a', async () => {
    // A partially-filled instance whose one bad fill is a file an older catalog
    // carried; `transfer.ts` restores exactly that. It must not take the room
    // down, and it must not take the *other* fills down either — which is what
    // makes the silent skip in a caught subscription safe rather than merely
    // quiet.
    const good = tilesFromCorpus(2, 180)
    placeTemplate(instanceOf([...good, 'tiles/gone/forever.stl' as TileId]))
    const queue = recordingQueue()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    arm()

    const stop = startSceneWarming({ queueFor: () => queue })
    await vi.waitFor(() => {
      expect(queue.asked.length).toBeGreaterThan(0)
    })
    stop()

    const eager = queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob)
    for (const tile of good) expect(eager).toContain(blobOf(tile))
    // Reported by the plan, not thrown, and not warned about either: an old
    // share link is not a console error.
    expect(warn).not.toHaveBeenCalled()
    expect(planSceneMeshes(sceneTiles(useWorkshopStore.getState().placements), index()).unresolved).toEqual([
      'tiles/gone/forever.stl',
    ])
  })

  it('warns once and does not throw when the catalog cannot be fetched', async () => {
    // The subscription runs detached from any render, so an unhandled rejection
    // would surface as a console error with no stack the user could act on.
    placeTemplate(instanceOf(tilesFromCorpus(1, 200)))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setCatalogLoader(() => Promise.reject(new Error('offline')))

    const stop = startSceneWarming({ queueFor: () => recordingQueue() })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(1)
    })
    stop()
  })

  it('retries after a failed fetch rather than staying cold for the session', async () => {
    // The short-circuit is committed before the await, so a failure has to
    // release it — otherwise one network blip leaves the room permanently
    // unconverted with nothing to retry it.
    placeTemplate(instanceOf(tilesFromCorpus(1, 220)))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let attempt = 0
    setCatalogLoader(() => {
      attempt += 1
      return attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(catalogFile())
    })

    const queue = recordingQueue()
    const stop = startSceneWarming({ queueFor: () => queue })
    // Waiting on the *warning* rather than on the attempt count, and the reason
    // is `context.ts`: it un-memoises a rejected build in a `.catch` of its own,
    // so until that handler has run the next caller is handed the same rejected
    // promise. The warning is emitted from the same turn, so it is the signal
    // that the retry is actually available.
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(1)
    })

    // The same room, one more instance: the set changed, so it reconciles — and
    // it must reconcile over the *whole* scene, including the fill the failed
    // attempt had already claimed.
    const again = tilesFromCorpus(1, 240)
    placeTemplate(instanceOf(again, 4))
    await vi.waitFor(() => {
      expect(queue.asked.map((one) => one.blob)).toContain(blobOf(again[0]!))
    })
    stop()

    expect(queue.asked.map((one) => one.blob)).toContain(blobOf(tilesFromCorpus(1, 220)[0]!))
  })

  it('asks for nothing after it is stopped', async () => {
    // The teardown is not decoration: `StrictMode` mounts, unmounts and mounts
    // the effect, and the catalog resolves between the two.
    placeTemplate(instanceOf(tilesFromCorpus(1, 260)))
    const queue = recordingQueue()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    setCatalogLoader(() => gate.then(() => catalogFile()))

    const stop = startSceneWarming({ queueFor: () => queue })
    stop()
    release?.()
    await gate
    await settle()

    expect(queue.asked).toEqual([])
  })

  it('is safe to arm twice, which is what StrictMode does', async () => {
    placeTemplate(instanceOf(tilesFromCorpus(2, 280)))
    const queue = recordingQueue()
    arm()

    const first = startSceneWarming({ queueFor: () => queue })
    const second = startSceneWarming({ queueFor: () => queue })
    await settle()
    await settle()
    first()
    second()

    // Two subscriptions over one idempotent queue: the same blobs, asked for by
    // each, which `queue.request` collapses. What must not happen is a throw or a
    // subscription surviving both teardowns.
    const eager = new Set(queue.asked.filter((one) => one.tier === 'eager').map((one) => one.blob))
    expect(eager.size).toBe(2)
  })
})
