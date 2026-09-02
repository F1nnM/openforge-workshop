// @vitest-environment jsdom
/**
 * The room mounted for real — the whole heavy import graph, and the state the
 * app is actually in today.
 *
 * `panel.test.tsx` mocks `./BuilderRoom` to prove the lazy boundary exists. This
 * file does the opposite and imports it, which means importing three.js, r3f,
 * drei, `postprocessing`, n8ao, `GLTFLoader` and the meshopt decoder. That is
 * worth a test on its own: a module-level failure anywhere in that graph —
 * n8ao touching `document` at import time, a decoder that will not instantiate,
 * `src/three/Stage.tsx` moving under this row — would break the app at runtime
 * with nothing else in the suite noticing.
 *
 * ## Why it can be mounted at all, with no WebGL
 *
 * Because `/lod/` is empty. Blocker **B2** is open, every object 404s, and a room
 * with no loaded geometry renders **no `<Stage>`** — so the one thing jsdom
 * cannot provide is the one thing this path does not need. That is not a
 * convenient accident, it is the designed fallback: G1's handover note asks for a
 * 404 to be treated as expected and for the app to fall back to the plan view.
 *
 * ## What this proves
 *
 *   - The heavy graph imports and the component mounts.
 *   - The full chain runs: `buildPlanScene` → `useLodStore` (fetch) →
 *     `loadLodGeometry` (404) → `buildRoom3D` → the empty-room copy.
 *   - The absences are counted and reported with both numbers, and nothing
 *     throws.
 *   - A real store object, served through the injected `fetch`, produces a room
 *     with instances in it and the readout to match.
 *
 * ## What it cannot prove
 *
 * **No renderer runs.** For the loaded case two modules are stubbed, and the
 * reason is the same for both: jsdom has no `getContext('webgl2')`, so
 * `<Canvas>` cannot create a `WebGLRenderer` and `useThree` throws outside one.
 * So `Stage` and `InstancedTiles` are replaced by **recorders** — their imports
 * stay real, so the dependency graph is still resolved, and what the stubs
 * capture is the props this row hands them. The loaded assertions are therefore
 * about the *call*, not about the picture: the label, the AO radius, the
 * occlusion colour, and the group with its three matrices.
 *
 * What no test in this row checks: that the flat-shaded shader compiles, that
 * `computeBoundingSphere` saves the room from being culled, that an instanced
 * draw is one call, or that the AO lands in the creases. Every one of those needs
 * a GPU. `InstancedTiles.tsx`'s docblock says which of them is the one that fails
 * silently.
 */
import { render, screen, waitFor } from '@testing-library/react'
import type * as StageModule from '@/three/Stage'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { planCatalogFromFile } from '@/builder/canvas'
import * as loadLod from './loadLod'
import { FIXTURE_IDS, fixtureCatalogFile } from '@/builder/canvas/fixture'
import type { Placement, WorkshopState } from '@/store'

/**
 * What the two stubs record.
 *
 * `Stage` and `InstancedTiles` are the two modules that cannot run in jsdom —
 * `<Canvas>` needs a `WebGLRenderer` and `useThree` throws outside one — so each
 * is replaced by a recorder. `vi.importActual` keeps `Stage`'s module real, so
 * `AO_RADIUS` still comes from the file this row calibrates against and the whole
 * heavy graph is still imported; only the element is swapped.
 */
const stageCalls: { label: string; aoRadius: number; occlusion?: string }[] = []
const instanceCalls: { key: string; count: number; matrices: number; family: string }[] = []

vi.mock('@/three/Stage', async () => {
  const actual = await vi.importActual<typeof StageModule>('@/three/Stage')
  return {
    ...actual,
    Stage: (props: { children: ReactNode; label: string; aoRadius: number; occlusion?: string }) => {
      stageCalls.push({
        label: props.label,
        aoRadius: props.aoRadius,
        ...(props.occlusion === undefined ? {} : { occlusion: props.occlusion }),
      })
      return <div data-testid="stage">{props.children}</div>
    },
  }
})

vi.mock('./InstancedTiles', () => ({
  // `useThree` cannot run outside a `<Canvas>`, so the real component is
  // unmountable here. The recorder keeps the assertion that matters at this
  // level: which group, with how many instance matrices, in what material.
  InstancedTiles: ({ group }: { group: { key: string; count: number; matrices: unknown[]; resolution: { family: { id: string } } } }) => {
    instanceCalls.push({
      key: group.key,
      count: group.count,
      matrices: group.matrices.length,
      family: group.resolution.family.id,
    })
    return <div data-testid="instances" />
  },
}))

const { AO_RADIUS_MM, BuilderRoom, MEDIAN_TILE_MM } = await import('./BuilderRoom')
const { AO_RADIUS } = await import('@/three/Stage')
const { VIEW_RADIUS } = await import('@/three/geometry')
const { readFileSync } = await import('node:fs')
const { join } = await import('node:path')

const CATALOG = planCatalogFromFile(fixtureCatalogFile())
const ASSETS = { lod: 'https://objects.openforge.tools/lod' }

function placements(ids: readonly string[]): WorkshopState['placements'] {
  return Object.fromEntries(
    ids.map((tileId, i) => [`p${String(i)}`, { tileId, x: i * 2, z: 0, rotation: 0 } as Placement]),
  )
}

const notFound = (): Promise<Response> => Promise.resolve(new Response(null, { status: 404 }))

function glbResponder(): typeof fetch {
  const bytes = readFileSync(join(process.cwd(), 'src', 'builder', 'three', 'fixtures', 'wall-8180da93.glb'))
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return (() =>
    Promise.resolve(
      new Response(body.slice(0), { status: 200, headers: { 'content-type': 'model/gltf-binary' } }),
    ))
}

describe('the room with an empty store — today’s real state', () => {
  it('mounts, says the store is not built, and draws no canvas', async () => {
    render(
      <BuilderRoom
        catalog={CATALOG}
        placements={placements([FIXTURE_IDS.floor1, FIXTURE_IDS.wall2])}
        assets={ASSETS}
        onClose={() => undefined}
        fetchImpl={notFound}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/mesh store has not been built yet/i)).toBeInTheDocument()
    })

    // Both numbers, so the empty room is legible rather than mysterious.
    expect(screen.getByText(/2 of 2 meshes missing/i)).toBeInTheDocument()
    // No Stage, and therefore no WebGL context asked for.
    expect(screen.queryByTestId('stage')).toBe(null)
    // The plan view is the drawing of the room, and the copy says so.
    expect(screen.getByText(/plan view is the drawing of this room/i)).toBeInTheDocument()
  })

  it('reports the budget and the draw count even when nothing drew', async () => {
    render(
      <BuilderRoom
        catalog={CATALOG}
        placements={placements([FIXTURE_IDS.floor1])}
        assets={ASSETS}
        onClose={() => undefined}
        fetchImpl={notFound}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('0 in 0 instanced meshes')).toBeInTheDocument()
    })
    expect(screen.getByText('1 of 150 meshes')).toBeInTheDocument()
  })

  it('says nothing to draw for an empty plan, without fetching', async () => {
    const fetchImpl = vi.fn(notFound)
    render(
      <BuilderRoom
        catalog={CATALOG}
        placements={placements([])}
        assets={ASSETS}
        onClose={() => undefined}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(/Place a tile and it will appear here/i)).toBeInTheDocument()
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('when an object is there and broken', () => {
  it('reports a failure as a failure, not as an absence', async () => {
    // The two are different types and different states, because one is worth a
    // retry and the other is blocker B2 and never will be.
    const broken = (): Promise<Response> => Promise.resolve(new Response(null, { status: 500 }))
    render(
      <BuilderRoom
        catalog={CATALOG}
        placements={placements([FIXTURE_IDS.floor1])}
        assets={ASSETS}
        onClose={() => undefined}
        fetchImpl={broken as unknown as typeof fetch}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i)
    })
    // And the readout counts it apart from the absences, rather than subtracting
    // one from the other and calling it loaded.
    expect(screen.getByText('0 of 1 loaded, 1 failed')).toBeInTheDocument()
  })
})

describe('when the browser cannot decode meshopt', () => {
  it('says so once instead of failing 150 requests', async () => {
    // Every store object is meshopt-encoded, so without the WASM decoder there
    // is nothing to load at all. The check happens before the fetches, and this
    // is the assertion that it does: `fetchImpl` is never called.
    const spy = vi.spyOn(loadLod, 'meshoptSupported').mockReturnValue(false)
    const fetchImpl = vi.fn(notFound)
    try {
      render(
        <BuilderRoom
          catalog={CATALOG}
          placements={placements([FIXTURE_IDS.floor1])}
          assets={ASSETS}
          onClose={() => undefined}
          fetchImpl={fetchImpl as unknown as typeof fetch}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText(/cannot decode the compressed preview meshes/i)).toBeInTheDocument()
      })
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('the room with a store object', () => {
  it('instances it, labels the canvas and passes a physical AO radius', async () => {
    stageCalls.length = 0
    instanceCalls.length = 0
    render(
      <BuilderRoom
        catalog={CATALOG}
        placements={placements([FIXTURE_IDS.floor1, FIXTURE_IDS.floor1, FIXTURE_IDS.floor1])}
        assets={ASSETS}
        onClose={() => undefined}
        fetchImpl={glbResponder()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('stage')).toBeInTheDocument()
    })

    // Three placements of one tile: one instanced mesh, three instances.
    expect(screen.getByText('3 in 1 instanced mesh')).toBeInTheDocument()
    // 118 triangles per instance from the fixture, times three.
    expect(screen.getByText('354')).toBeInTheDocument()
    expect(screen.getByText('1 of 1 loaded')).toBeInTheDocument()
    // The budget row quotes the resident geometry against the ceiling borrowed
    // from `src/three/gate.ts` — 36.2 MB, the same allowance one raw STL gets.
    expect(screen.getByText(/1 of 150 meshes · .* of 36\.2 MB/)).toBeInTheDocument()

    const call = stageCalls.at(-1)
    expect(call?.label).toContain('3 placed tiles')
    // The AO radius is a physical length scaled into Stage's normalised frame,
    // not Stage's own 0.09 — see BuilderRoom's docblock. A room of one median
    // tile would land back exactly on AO_RADIUS; this room is smaller than
    // that, so the value is larger.
    expect(AO_RADIUS_MM).toBeCloseTo((AO_RADIUS / VIEW_RADIUS) * (Math.hypot(...MEDIAN_TILE_MM) / 2), 12)
    expect(AO_RADIUS_MM).toBeCloseTo(4.612, 3)
    expect(call?.aoRadius).toBeGreaterThan(0)
    // And the occlusion colour is a real measured `edge` from the registry.
    expect(call?.occlusion).toMatch(/^(#|oklch|rgb)/)

    // One group, three matrices, one family — the instancing claim, at the
    // component boundary rather than at the GPU.
    const instanced = instanceCalls.at(-1)
    expect(instanced?.count).toBe(3)
    expect(instanced?.matrices).toBe(3)
    expect(instanced?.family).toBe('dungeon_stone')
    expect(new Set(instanceCalls.map((one) => one.key)).size).toBe(1)
  })
})
