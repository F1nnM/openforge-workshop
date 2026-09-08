// @vitest-environment jsdom
/**
 * The mesh store's one hard behaviour: **the room survives an edit**.
 *
 * Every address this hook loads is derived from the scene, so placing a tile
 * adds one and deleting the last copy of one removes it. The hook used to be a
 * single effect keyed on that set, which meant every edit tore the effect down —
 * disposing every geometry the room held and republishing an empty map — and
 * built it again from nothing. On screen that was the whole room flashing away
 * and coming back on each placement and each delete, which is what sent someone
 * looking.
 *
 * So the first test here is not a unit test of a helper; it is that symptom,
 * written down. It records **every state the hook publishes** across a set
 * change and fails if any one of them has dropped an address that was already
 * loaded. That assertion fails on the old shape at the first published state and
 * passes on the reconciling one, which is the only reason to have it.
 *
 * The rest guard the parts of "reconcile" that could each silently become
 * "restart" again: that a new address costs exactly one new request and not a
 * whole room's worth, that an address leaving the set is disposed rather than
 * leaked, that a terminal answer is not re-asked on the next edit, and that the
 * one thing which *does* still invalidate everything — a change of source — is
 * still wired.
 *
 * The bytes are the real fixture, `fixtures/wall-8180da93.plain.glb` — the
 * uncompressed twin of the store's own object, so this file exercises the actual
 * `GLTFLoader` path without needing the meshopt decoder's WASM under jsdom.
 * `contract.test.ts` is where the format itself is checked; here it is only a
 * body that parses.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { BlobId } from '@/catalog'

import type { LodGeometry } from './loadLod'
import { useLodStore } from './useLodStore'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const GLB = readFileSync(join(FIXTURES, 'wall-8180da93.plain.glb'))

const A = '8180da93549154744c37f8370a82738f' as BlobId
const B = 'a6881f5ce657e9bb6d514a3d27fa88d8' as BlobId
const C = 'f1e2ff0bc747302d95adc5c0cf694678' as BlobId

const ASSETS = { lod: 'https://bucket-openforge-workshop.mfinn.de/lod' }
const OTHER_ASSETS = { lod: 'https://objects.openforge.tools/lod' }

/** The md5 out of a `/lod/{shard}/{md5}.glb` URL. */
function blobOf(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1, -'.glb'.length)
}

interface Store {
  readonly fetchImpl: typeof fetch
  /** Every address requested, in order, including repeats. */
  readonly asked: string[]
}

/**
 * A `/lod/` that answers with the fixture, except for the addresses named.
 *
 * `asked` is the whole point of several tests below: a reconciling store asks
 * for an address once, and a restarting one asks again on every edit.
 */
function store(status: Readonly<Record<string, number>> = {}): Store {
  const asked: string[] = []
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const blob = blobOf(url)
    asked.push(blob)
    const code = status[blob]
    if (code !== undefined) return Promise.resolve(new Response(null, { status: code }))
    return Promise.resolve(
      new Response(GLB.buffer.slice(GLB.byteOffset, GLB.byteOffset + GLB.byteLength), {
        status: 200,
        headers: { 'content-type': 'model/gltf-binary' },
      }),
    )
  }
  return { fetchImpl, asked }
}

interface Probe {
  /** Every state the hook has published, oldest first. */
  readonly states: { geometries: ReadonlyMap<string, LodGeometry>; settled: boolean; pending: number }[]
  readonly latest: () => Probe['states'][number]
  readonly show: (blobs: readonly BlobId[], assets?: { lod: string }) => void
  readonly unmount: () => void
}

/**
 * Mount the hook so the caller can change its address set the way an edit does.
 *
 * A component rather than `renderHook` because the assertion is about the
 * *sequence* of published states and not only the last one — `renderHook` keeps
 * only `result.current`.
 */
function mount(blobs: readonly BlobId[], fetchImpl: typeof fetch): Probe {
  const states: Probe['states'] = []

  function Room({ blobs: want, assets }: { blobs: readonly BlobId[]; assets: { lod: string } }) {
    const state = useLodStore({ blobs: want, assets, enabled: true, fetchImpl })
    states.push({ geometries: state.geometries, settled: state.settled, pending: state.pending })
    return null
  }

  const view = render(<Room blobs={blobs} assets={ASSETS} />)
  return {
    states,
    latest: () => {
      const last = states.at(-1)
      if (last === undefined) throw new Error('the hook published nothing')
      return last
    },
    show: (want, assets = ASSETS) => {
      view.rerender(<Room blobs={want} assets={assets} />)
    },
    unmount: () => {
      view.unmount()
    },
  }
}

/** Resolves when the wanted addresses have all landed and nothing is in flight. */
async function loaded(probe: Probe, ...blobs: readonly BlobId[]): Promise<void> {
  await waitFor(() => {
    const state = probe.latest()
    expect(state.settled).toBe(true)
    expect([...state.geometries.keys()].sort()).toEqual([...blobs].sort())
  })
}

/** Whether a geometry has been released. `dispose()` is an event, not a flag. */
function watchDisposal(lod: LodGeometry): () => boolean {
  let disposed = false
  lod.geometry.addEventListener('dispose', () => {
    disposed = true
  })
  return () => disposed
}

describe('an edit to the room', () => {
  it('never publishes a state that has dropped an already-loaded mesh', async () => {
    const { fetchImpl } = store()
    const probe = mount([A], fetchImpl)
    await loaded(probe, A)

    const held = probe.latest().geometries.get(A)
    const from = probe.states.length

    // The user places a tile whose file the room has not needed before.
    probe.show([A, B])
    await loaded(probe, A, B)

    // The symptom, stated: not one frame of the room without the tiles it
    // already had.
    const without = probe.states.slice(from).filter((state) => !state.geometries.has(A))
    expect(without).toEqual([])

    // And the same object throughout, so `InstancedTiles` is not even rebuilt:
    // `args={[group.lod.geometry, …]}` compares by identity.
    expect(probe.latest().geometries.get(A)).toBe(held)
  })

  it('costs exactly one request per new address, not a room’s worth', async () => {
    const { fetchImpl, asked } = store()
    const probe = mount([A, B], fetchImpl)
    await loaded(probe, A, B)
    expect(asked.length).toBe(2)

    probe.show([A, B, C])
    await loaded(probe, A, B, C)

    expect(asked).toEqual([A, B, C])
  })

  it('disposes the mesh whose last placement was deleted', async () => {
    const { fetchImpl } = store()
    const probe = mount([A, B], fetchImpl)
    await loaded(probe, A, B)

    const dropped = probe.latest().geometries.get(B)
    const kept = probe.latest().geometries.get(A)
    if (dropped === undefined || kept === undefined) throw new Error('both should be loaded')
    const wasDisposed = watchDisposal(dropped)
    const keptDisposed = watchDisposal(kept)

    probe.show([A])
    await loaded(probe, A)

    expect(wasDisposed()).toBe(true)
    expect(keptDisposed()).toBe(false)
    expect(probe.latest().geometries.get(A)).toBe(kept)
  })

  it('does not re-ask for an absence on the next edit', async () => {
    // An absence is terminal — see the hook's note on why nothing is retried on
    // a timer — and an edit is not a retry. A restarting effect would ask again
    // for every address in the set, so this is the same guard as the count above
    // read from the other side.
    const { fetchImpl, asked } = store({ [B]: 404 })
    const probe = mount([A, B], fetchImpl)
    await waitFor(() => {
      expect(probe.latest().settled).toBe(true)
    })
    expect(probe.latest().geometries.has(B)).toBe(false)
    expect(asked).toEqual([A, B])

    probe.show([A, B, C])
    await loaded(probe, A, C)

    expect(asked).toEqual([A, B, C])
  })

  it('keeps the room while an address is still in flight', async () => {
    // The window the old shape was worst in: an edit during a load republished
    // an empty map *and* restarted the loads it had already paid for.
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = () => {
        resolve()
      }
    })
    const backing = store()
    const slow: typeof fetch = async (input, init) => {
      if (blobOf(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url) === C) {
        await held
      }
      return backing.fetchImpl(input, init)
    }

    const probe = mount([A], slow)
    await loaded(probe, A)

    probe.show([A, C])
    await waitFor(() => {
      expect(probe.latest().pending).toBe(1)
    })
    expect(probe.latest().geometries.has(A)).toBe(true)

    probe.show([A, B, C])
    await waitFor(() => {
      expect(probe.latest().geometries.has(B)).toBe(true)
    })
    expect(probe.latest().geometries.has(A)).toBe(true)

    release()
    await loaded(probe, A, B, C)
    // C was fetched once despite two edits landing on top of its request.
    expect(backing.asked.filter((blob) => blob === C).length).toBe(1)
  })
})

describe('what still invalidates everything', () => {
  it('releases and re-reads when the store base changes', async () => {
    const { fetchImpl, asked } = store()
    const probe = mount([A], fetchImpl)
    await loaded(probe, A)
    const first = probe.latest().geometries.get(A)
    if (first === undefined) throw new Error('A should be loaded')
    const wasDisposed = watchDisposal(first)

    probe.show([A], OTHER_ASSETS)
    await waitFor(() => {
      expect(probe.latest().geometries.get(A)).not.toBe(first)
    })
    await loaded(probe, A)

    expect(wasDisposed()).toBe(true)
    expect(asked).toEqual([A, A])
  })

  it('disposes everything on unmount, because nothing caches across mounts', async () => {
    const { fetchImpl } = store()
    const probe = mount([A, B], fetchImpl)
    await loaded(probe, A, B)
    const watches = [...probe.latest().geometries.values()].map(watchDisposal)

    probe.unmount()

    expect(watches.map((disposed) => disposed())).toEqual([true, true])
  })
})
