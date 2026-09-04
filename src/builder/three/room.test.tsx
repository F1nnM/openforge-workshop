// @vitest-environment jsdom
/**
 * The room mounted for real — the whole heavy import graph, and the states the
 * app is actually in.
 *
 * `panel.test.tsx` mocks `./BuilderRoom` to prove the lazy boundary exists. This
 * file does the opposite and imports it, which means importing three.js, r3f,
 * drei, `postprocessing`, n8ao, `GLTFLoader` and the meshopt decoder. That is
 * worth a test on its own: a module-level failure anywhere in that graph —
 * n8ao touching `document` at import time, a decoder that will not instantiate,
 * `src/three/Stage.tsx` moving under this row — would break the app at runtime
 * with nothing else in the suite noticing.
 *
 * ## What changed with row R2, and what it cost this file
 *
 * The room used to render **no `<Stage>`** when nothing had loaded, which is why
 * this file could once mount it with no stubs at all: `/lod/` is empty, so the
 * one thing jsdom cannot provide was the one thing the path did not need. Row R2
 * removed that, and had to: with no canvas there is no ground plane, so there is
 * nowhere to place the *first* tile, and a work surface that appears only once
 * geometry has arrived cannot be the thing a room is built on.
 *
 * So the canvas is now unconditional and **two modules are stubbed** in every
 * case here, not just the loaded one. The reason is the same for both: jsdom has
 * no `getContext('webgl2')`, `<Canvas>` cannot create a `WebGLRenderer`, and
 * `useThree` throws outside one. `Stage` and `RoomSurface` are therefore
 * replaced by **recorders** — their imports stay real, so the whole dependency
 * graph is still resolved and a module-level failure in it still fails this
 * file, and what the stubs capture is the props this row hands them.
 *
 * ## What this proves
 *
 *   - The heavy graph imports and the component mounts, in every state.
 *   - The full chain runs: the screen's `PlanScene` → `useLodStore` (fetch) →
 *     `loadMeshGeometry` (404) → `buildRoom3D` → the surface.
 *   - **The canvas is mounted with an empty plan**, which is the row's whole
 *     premise, and the armed tile's mesh is requested before it is placed.
 *   - Absences and failures are counted apart and reported over the canvas
 *     rather than instead of it, so the surface stays usable while a mesh is
 *     missing.
 *   - A real store object, served through the injected `fetch`, produces a room
 *     with instances in it and the readout to match.
 *
 * ## What it cannot prove
 *
 * **No renderer runs.** The loaded assertions are about the *call*, not about
 * the picture: the label, the AO radius, the occlusion colour, the fit, and the
 * group with its matrices. What no test in this row checks: that the flat-shaded
 * shader compiles, that `computeBoundingSphere` saves the room from being culled,
 * that an instanced draw is one call, that a raycast lands where the pointer is,
 * or that the AO lands in the creases. Every one of those needs a GPU;
 * `surface.test.ts` reaches the raycast arithmetic without one, and a browser
 * pass is what covered the rest.
 */
import { render, screen, waitFor } from '@testing-library/react'
import type * as StageModule from '@/three/Stage'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { planCatalogFromFile } from '@/builder/canvas'
import * as loadLod from './loadLod'
import { FIXTURE_IDS, FIXTURE_TEMPLATE, fixtureCatalogFile } from '@/builder/canvas/fixture'

/**
 * What the two stubs record.
 *
 * `Stage` and `RoomSurface` are the two modules that cannot run in jsdom —
 * `<Canvas>` needs a `WebGLRenderer` and `useThree` throws outside one — so each
 * is replaced by a recorder. `vi.importActual` keeps `Stage`'s module real, so
 * `AO_RADIUS` still comes from the file this row calibrates against and the whole
 * heavy graph is still imported; only the element is swapped.
 */
const stageCalls: { label: string; aoRadius: number; occlusion?: string; enablePan?: boolean }[] = []
const surfaceCalls: {
  groups: number
  instances: number
  matrices: number
  family: string | null
  scale: number
  armed: string | null
  loaded: number
}[] = []

vi.mock('@/three/Stage', async () => {
  const actual = await vi.importActual<typeof StageModule>('@/three/Stage')
  return {
    ...actual,
    Stage: (props: {
      children: ReactNode
      label: string
      aoRadius: number
      occlusion?: string
      enablePan?: boolean
    }) => {
      stageCalls.push({
        label: props.label,
        aoRadius: props.aoRadius,
        ...(props.occlusion === undefined ? {} : { occlusion: props.occlusion }),
        ...(props.enablePan === undefined ? {} : { enablePan: props.enablePan }),
      })
      return <div data-testid="stage">{props.children}</div>
    },
  }
})

vi.mock('./RoomSurface', () => ({
  // `useThree` cannot run outside a `<Canvas>`, so the real component is
  // unmountable here. The recorder keeps the assertions that matter at this
  // level: which groups with how many matrices, the constant work scale, the
  // armed tile, and how much geometry arrived.
  RoomSurface: ({
    room,
    fit,
    tools,
    geometries,
  }: {
    room: {
      groups: { count: number; matrices: unknown[]; resolution: { family: { id: string } } }[]
      instances: number
    }
    fit: { scale: number }
    tools: { selectedDesign: string | null }
    geometries: ReadonlyMap<string, unknown>
  }) => {
    surfaceCalls.push({
      groups: room.groups.length,
      instances: room.instances,
      matrices: room.groups.reduce((total, group) => total + group.matrices.length, 0),
      family: room.groups[0]?.resolution.family.id ?? null,
      scale: fit.scale,
      armed: tools.selectedDesign,
      loaded: geometries.size,
    })
    return <div data-testid="surface" />
  },
}))

const { AO_RADIUS_MM, BuilderRoom, MEDIAN_TILE_MM } = await import('./BuilderRoom')
const { AO_RADIUS } = await import('@/three/Stage')
const { VIEW_RADIUS } = await import('@/three/geometry')
const { surfaceFit } = await import('./surface')
const { planTools, sceneOf } = await import('./fixture')
const { readFileSync } = await import('node:fs')
const { join } = await import('node:path')

const CATALOG = planCatalogFromFile(fixtureCatalogFile())
const ASSETS = {
  lod: 'https://objects.openforge.tools/lod',
  // The conversion queue is keyed on this base and is never asked for anything
  // in these tests — `ensureAggregateMeshes` is not called here — so it is only
  // the key that matters.
  models: 'https://objects.openforge.tools/models',
}

function scene(ids: readonly string[]) {
  return sceneOf(
    CATALOG,
    ids.map((id, i) => ({ tile: id, x: i * 2, z: 0 })),
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

/**
 * A `fetch` spy whose recorded calls carry the URL as a string.
 *
 * Typed `(url: string)` rather than `(url: RequestInfo | URL)` deliberately:
 * `loadMeshGeometry` builds its URL with `lodGlbUrl` and passes a string, so the
 * narrower parameter is the truth about this seam and it is what lets a test
 * read the address without stringifying a `Request`.
 */
function spyFetch(): ReturnType<typeof vi.fn<(url: string) => Promise<Response>>> {
  return vi.fn((_url: string) => notFound())
}

function reset(): void {
  stageCalls.length = 0
  surfaceCalls.length = 0
}

describe('the room with an empty store — today’s real state', () => {
  it('mounts a work surface anyway and says which tiles are outlined', async () => {
    reset()
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1, FIXTURE_IDS.wall2])}
        tools={planTools()}
        assets={ASSETS}
        fetchImpl={notFound}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/no mesh in the store yet/i)).toBeInTheDocument()
    })

    // The row's whole premise: the canvas is there even though nothing loaded,
    // because the ground plane *is* where the next tile goes.
    expect(screen.getByTestId('stage')).toBeInTheDocument()
    expect(screen.getByTestId('surface')).toBeInTheDocument()
    // Both numbers, and in **parts**: a plate is drawn per part since row A4b,
    // so a count of placements would say "2" about a room that might be showing
    // six outlines.
    expect(screen.getByText(/2 of 2 placed parts have no mesh/i)).toBeInTheDocument()
    // And the disclosure says the part is real, which is the thing a marker must
    // never leave in doubt.
    expect(screen.getByText(/part is really there/i)).toBeInTheDocument()
  })

  it('reports the budget and the draw count even when nothing drew', async () => {
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools()}
        assets={ASSETS}
        fetchImpl={notFound}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('0 parts in 0 instanced meshes, 1 outlined')).toBeInTheDocument()
    })
    expect(screen.getByText('1 of 150 meshes')).toBeInTheDocument()
  })

  it('draws an empty plan without fetching, and still gives it a canvas', async () => {
    reset()
    const fetchImpl = vi.fn(notFound)
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([])}
        tools={planTools()}
        assets={ASSETS}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('stage')).toBeInTheDocument()
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    // No notice at all: nothing is loading, nothing is missing, and an empty
    // work surface is not a state that needs explaining.
    expect(screen.queryByText(/no mesh in the store/i)).toBe(null)
    expect(stageCalls.at(-1)?.label).toMatch(/empty plan in 3D/)
  })
})

describe('the armed family', () => {
  it('fetches nothing for it, because a family names no mesh yet', async () => {
    // **The inverse of what row R2 asserted here, and a real loss of capability
    // rather than a tidier test.** R2 added the armed tile's own blob to the
    // load set so the first ghost had geometry before the first placement. Since
    // row A1 the armed thing is a `TemplateId`; turning one into the files that
    // fill its slots is row **C2**'s solver and it does not exist, so there is no
    // address to request and `edits.ts#templateGhost` draws a cell marker
    // instead. When C2 lands, its fill map is one more source to union into
    // `roomBlobs`' answer and the ghost gets its mesh back in the same change.
    const fetchImpl = spyFetch()
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([])}
        tools={planTools({ selectedTemplate: FIXTURE_TEMPLATE })}
        assets={ASSETS}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('stage')).toBeInTheDocument()
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('loads exactly the parts the scene draws, and nothing beside them', async () => {
    // Contract **C-d** at the component boundary: the fetched set is
    // `roomBlobs(scene)`, so it holds one address per drawn part and no extras.
    // A second derivation here is what would report "not in the store" about a
    // blob nobody asked for.
    const fetchImpl = spyFetch()
    const drawn = scene([FIXTURE_IDS.floor1, FIXTURE_IDS.wall2])
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={drawn}
        tools={planTools({ selectedTemplate: FIXTURE_TEMPLATE })}
        assets={ASSETS}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    )
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled()
    })
    const wanted = new Set(drawn.pieces.flatMap((piece) => piece.parts.map((part) => part.record.blob)))
    expect(wanted.size).toBe(2)
    const asked = fetchImpl.mock.calls.map(([url]) => url)
    expect(asked).toHaveLength(wanted.size)
    for (const blob of wanted) expect(asked.some((url) => url.includes(blob))).toBe(true)
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
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools()}
        assets={ASSETS}
        fetchImpl={broken as unknown as typeof fetch}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i)
    })
    // And the readout counts it apart from the absences, rather than subtracting
    // one from the other and calling it loaded.
    expect(screen.getByText('0 of 1 loaded, 1 failed')).toBeInTheDocument()
    // The surface is still there: a failed mesh changes what is *drawn* and
    // nothing about what may be placed where.
    expect(screen.getByTestId('surface')).toBeInTheDocument()
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
          scene={scene([FIXTURE_IDS.floor1])}
          tools={planTools()}
          assets={ASSETS}
            fetchImpl={fetchImpl as unknown as typeof fetch}
        />,
      )
      await waitFor(() => {
        expect(screen.getByText(/cannot decode the compressed preview meshes/i)).toBeInTheDocument()
      })
      expect(fetchImpl).not.toHaveBeenCalled()
      // The one state that does suppress the canvas, because there is provably
      // nothing that could ever be drawn on it.
      expect(screen.queryByTestId('stage')).toBe(null)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('the room with a store object', () => {
  it('instances it, labels the canvas, pans, and fits a constant frame', async () => {
    reset()
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1, FIXTURE_IDS.floor1, FIXTURE_IDS.floor1])}
        tools={planTools()}
        assets={ASSETS}
        fetchImpl={glbResponder()}
      />,
    )

    await waitFor(() => {
      expect(surfaceCalls.at(-1)?.groups).toBe(1)
    })

    // Three placements of one file: one instanced mesh, three parts.
    expect(screen.getByText('3 parts in 1 instanced mesh')).toBeInTheDocument()
    // And the arity the other lines are in terms of, so "3 parts in 1 mesh" is
    // readable — three placements of one part each, none of them empty.
    expect(screen.getByText('3 placed')).toBeInTheDocument()
    // 118 triangles per instance from the fixture, times three.
    expect(screen.getByText('354')).toBeInTheDocument()
    expect(screen.getByText('1 of 1 loaded')).toBeInTheDocument()
    // The budget row quotes the resident geometry against the ceiling borrowed
    // from `src/three/gate.ts` — 36.2 MB, the same allowance one raw STL gets.
    expect(screen.getByText(/1 of 150 meshes · .* of 36\.2 MB/)).toBeInTheDocument()

    const call = stageCalls.at(-1)
    expect(call?.label).toContain('3 placed templates')
    // `enablePan`, at last passed by the component `Stage`'s prop docblock names:
    // a two-metre plan cannot be walked across by orbit and zoom alone.
    expect(call?.enablePan).toBe(true)
    // The AO radius is a physical length scaled into `Stage`'s normalised frame,
    // not `Stage`'s own 0.09 — see `BuilderRoom`'s docblock. Under row R2's
    // constant work fit the product is constant too, which is what keeps the
    // crease the same size as the room grows.
    expect(AO_RADIUS_MM).toBeCloseTo((AO_RADIUS / VIEW_RADIUS) * (Math.hypot(...MEDIAN_TILE_MM) / 2), 12)
    expect(AO_RADIUS_MM).toBeCloseTo(4.612, 3)
    expect(call?.aoRadius).toBeCloseTo(AO_RADIUS_MM * surfaceFit(VIEW_RADIUS).scale, 12)
    // And the occlusion colour is a real measured `edge` from the registry.
    expect(call?.occlusion).toMatch(/^(#|oklch|rgb)/)

    // One group, three matrices, one family — the instancing claim, at the
    // component boundary rather than at the GPU.
    const surface = surfaceCalls.at(-1)
    expect(surface?.instances).toBe(3)
    expect(surface?.matrices).toBe(3)
    expect(surface?.family).toBe('dungeon_stone')
    expect(surface?.loaded).toBe(1)
    // The scale is the fixed work fit and not `room.fit`'s, which is the
    // difference between building a room and looking at one.
    expect(surface?.scale).toBeCloseTo(surfaceFit(VIEW_RADIUS).scale, 12)
  })

  it('keeps the frame constant as the room grows, which fitRoom would not', async () => {
    // The regression this row's fixed fit prevents: with `fitRoom` the scale is
    // a function of the bounds, so a placement at the edge rescales the whole
    // plan under the cursor and the next tile does not land where it was aimed.
    reset()
    const small = render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools()}
        assets={ASSETS}
        fetchImpl={glbResponder()}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(0)
    })
    const first = surfaceCalls.at(-1)?.scale
    small.unmount()

    reset()
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1, FIXTURE_IDS.floor2, FIXTURE_IDS.wall2, FIXTURE_IDS.angled])}
        tools={planTools()}
        assets={ASSETS}
        fetchImpl={glbResponder()}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(0)
    })
    expect(surfaceCalls.at(-1)?.scale).toBe(first)
  })
})

describe('the keyboard path exists in the document', () => {
  it('publishes a key map for the canvas to point at', async () => {
    // The canvas's `aria-describedby` names this paragraph, and `RoomSurface`
    // sets the attribute on the `<canvas>` element itself. The element cannot be
    // mounted here, so what is asserted is the half that lives in the DOM: the
    // text is real, in the document, and carries the gestures.
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools()}
        assets={ASSETS}
        fetchImpl={notFound}
      />,
    )
    // Awaited rather than read synchronously: `useLodStore` settles its 404 in a
    // microtask, so a synchronous assertion here leaves a React state update
    // outside `act` and the run prints a warning it should not have to.
    await waitFor(() => {
      expect(document.querySelector('#of-b3d-keys')).not.toBeNull()
    })
    const keys = document.querySelector('#of-b3d-keys')
    expect(keys?.textContent).toMatch(/Drag to orbit/)
    expect(keys?.textContent).toMatch(/Arrow keys move the plan cursor/)
    expect(keys?.textContent).toMatch(/Escape puts it back/)
    // And a live region for the announcements, polite and atomic.
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live?.getAttribute('aria-atomic')).toBe('true')
  })
})
