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
 *     `loadLodGeometry` (404) → `buildRoom3D` → the surface.
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
import { FIXTURE_IDS, FIXTURE_TEMPLATE, OTHER_FIXTURE_TEMPLATE, fixtureCatalogFile } from '@/builder/canvas/fixture'

import type { PlacementFiller } from './fills'

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
  /* Row C5. The filler itself, not a summary of it: the point of capturing it is
     to *call* it, which is the only way this level can prove that a click would
     place a filled instance — `useThree` makes the real surface unmountable, so
     the pointer path itself is unreachable from jsdom (`edits.ts` states that
     limitation) and this is the closest a test gets to the click. */
  fill: PlacementFiller
  /** Row C8: whether the room carried the screen's slot-editor handler through. */
  edits: boolean
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
    fill,
    onEditSlots,
  }: {
    room: {
      groups: { count: number; matrices: unknown[]; resolution: { family: { id: string } } }[]
      instances: number
    }
    fit: { scale: number }
    tools: { selectedDesign: string | null }
    geometries: ReadonlyMap<string, unknown>
    fill: PlacementFiller
    onEditSlots?: unknown
  }) => {
    surfaceCalls.push({
      groups: room.groups.length,
      instances: room.instances,
      matrices: room.groups.reduce((total, group) => total + group.matrices.length, 0),
      family: room.groups[0]?.resolution.family.id ?? null,
      scale: fit.scale,
      armed: tools.selectedDesign,
      loaded: geometries.size,
      fill,
      edits: onEditSlots !== undefined,
    })
    return <div data-testid="surface" />
  },
}))

const { AO_RADIUS_MM, BuilderRoom, MEDIAN_TILE_MM } = await import('./BuilderRoom')
const { AO_RADIUS } = await import('@/three/Stage')
const { VIEW_RADIUS } = await import('@/three/geometry')
const { surfaceFit } = await import('./surface')
const { fixtureAuthorities, planTools, sceneOf } = await import('./fixture')
const { readFileSync } = await import('node:fs')
const { join } = await import('node:path')

const CATALOG = planCatalogFromFile(fixtureCatalogFile())
/* Row C5's required prop: the three authorities the click's fill solve walks,
   real ones over the same eleven records this file's catalog is built from. Built
   once for the file — eleven records, but `buildAssemblyIndex` is not free and
   nothing here mutates it. */
const AUTHORITIES = fixtureAuthorities()
const ASSETS = { lod: 'https://objects.openforge.tools/lod' }

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
 * `loadLodGeometry` builds its URL with `lodGlbUrl` and passes a string, so the
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
        fill={AUTHORITIES}
        fetchImpl={notFound}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/no mesh in the store/i)).toBeInTheDocument()
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

  it('groups nothing and still hands the surface the part, so it can be outlined', async () => {
    // This used to read the counts off the `of-b3d-readout` footer. That footer
    // is deleted — it was developer telemetry on a work surface — so the claim is
    // made against the props the surface is actually handed, which is the thing
    // the readout was only ever a rendering of.
    reset()
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools()}
        assets={ASSETS}
        fill={AUTHORITIES}
        fetchImpl={notFound}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(/1 of 1 placed part has no mesh/i)).toBeInTheDocument()
    })
    const call = surfaceCalls.at(-1)
    expect(call?.groups).toBe(0)
    expect(call?.instances).toBe(0)
    expect(call?.loaded).toBe(0)
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
        fill={AUTHORITIES}
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
    // row A1 the armed thing is a `TemplateId`, and `edits.ts#templateGhost`
    // draws a cell marker with no mesh in it. Row **C5** wires C2's solver to the
    // click, so the files *are* knowable before the press — and this assertion
    // stands anyway, on purpose: the marker draws no mesh, so prefetching a
    // family's blobs would warm the cache for a placement that may never happen.
    // `BuilderRoom`'s `blobs` docblock carries that decision.
    const fetchImpl = spyFetch()
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([])}
        tools={planTools({ selectedTemplate: FIXTURE_TEMPLATE })}
        assets={ASSETS}
        fill={AUTHORITIES}
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
        fill={AUTHORITIES}
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
        fill={AUTHORITIES}
        fetchImpl={broken as unknown as typeof fetch}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i)
    })
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
        fill={AUTHORITIES}
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
        fill={AUTHORITIES}
        fetchImpl={glbResponder()}
      />,
    )

    await waitFor(() => {
      expect(surfaceCalls.at(-1)?.groups).toBe(1)
    })

    // Three placements of one file: one instanced mesh, three parts. That claim
    // used to be read off the `of-b3d-readout` footer as well; the footer is
    // deleted, and the block below already makes it against the surface's own
    // props, which is where it always belonged.
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
        fill={AUTHORITIES}
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
        fill={AUTHORITIES}
        fetchImpl={glbResponder()}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(0)
    })
    expect(surfaceCalls.at(-1)?.scale).toBe(first)
  })
})

describe('what a click would place — row C5', () => {
  it('hands the surface a filler that solves the armed family’s parts', async () => {
    /* **The row's own wiring, as far as jsdom can follow it.** `BuilderRoom`
       builds the filler from the three authorities the screen passes and the lock
       in the store; the surface calls it on the click. So calling the captured
       filler is calling what the click calls — and it must come back with real
       fills, because `fills: {}` is exactly the state row C5 exists to end. */
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools({ selectedTemplate: FIXTURE_TEMPLATE })}
        assets={ASSETS}
        fill={AUTHORITIES}
        fetchImpl={notFound}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(0)
    })
    const fill = surfaceCalls.at(-1)?.fill
    expect(fill).toBeTypeOf('function')
    const placed = fill?.(FIXTURE_TEMPLATE, [])

    // Both slots of the fixture template, from the eleven-record catalog this
    // file's own scene is built over — one archive, one answer.
    expect(placed?.known).toBe(true)
    expect(placed?.filled).toBe(2)
    expect(Object.keys(placed?.fills ?? {}).sort()).toEqual(['floor', 'right wall'])
    expect(Object.values(placed?.fills ?? {}).every((one) => one?.pinned === false)).toBe(true)
  })

  it('places a family this build has no recipe for, rather than refusing', async () => {
    // Contract C-g from the other end: `OTHER_FIXTURE_TEMPLATE` is not in the
    // fixture lookup, which is the state C1 measured for all 51 generated
    // families against the 40-recipe table. It places; the bill refuses it.
    render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools({ selectedTemplate: OTHER_FIXTURE_TEMPLATE })}
        assets={ASSETS}
        fill={AUTHORITIES}
        fetchImpl={notFound}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(0)
    })
    const placed = surfaceCalls.at(-1)?.fill(OTHER_FIXTURE_TEMPLATE, [])

    expect(placed).toMatchObject({ known: false, fills: {}, slots: 0 })
  })

  it('keeps one filler across re-renders, so the memo inside it survives', async () => {
    /* The whole cost argument rests on this: a filler rebuilt on every render
       would re-solve every placement, where one memoised filler makes a room of
       twenty identical rows a single solve. Measured over the archive at 91 cold
       solves in ~42 ms and 91 repeats in ~0.1 ms — `fills.test.ts`. */
    const view = render(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools({ selectedTemplate: FIXTURE_TEMPLATE })}
        assets={ASSETS}
        fill={AUTHORITIES}
        fetchImpl={notFound}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(0)
    })
    const first = surfaceCalls.at(-1)?.fill

    view.rerender(
      <BuilderRoom
        catalog={CATALOG}
        scene={scene([FIXTURE_IDS.floor1, FIXTURE_IDS.floor2])}
        tools={planTools({ selectedTemplate: FIXTURE_TEMPLATE })}
        assets={ASSETS}
        fill={AUTHORITIES}
        fetchImpl={notFound}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(1)
    })

    expect(surfaceCalls.at(-1)?.fill).toBe(first)
  })
})

describe('the keyboard path exists in the document', () => {
  it('carries row C8’s handler through to the surface when the screen passes one', async () => {
    // `Builder3DPanel` is asserted at its own boundary in `panel.test.tsx`; this
    // is the second hop, and the room does nothing to the handler but pass it —
    // the dialog it opens is outside this directory entirely.
    surfaceCalls.length = 0
    render(
      <BuilderRoom
        assets={ASSETS}
        catalog={CATALOG}
        fetchImpl={notFound}
        fill={AUTHORITIES}
        onEditSlots={() => undefined}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools()}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(0)
    })
    expect(surfaceCalls.at(-1)?.edits).toBe(true)
  })

  it('passes none when the screen passes none, so the prop stays optional', async () => {
    surfaceCalls.length = 0
    render(
      <BuilderRoom
        assets={ASSETS}
        catalog={CATALOG}
        fetchImpl={notFound}
        fill={AUTHORITIES}
        scene={scene([FIXTURE_IDS.floor1])}
        tools={planTools()}
      />,
    )
    await waitFor(() => {
      expect(surfaceCalls.length).toBeGreaterThan(0)
    })
    expect(surfaceCalls.at(-1)?.edits).toBe(false)
  })

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
        fill={AUTHORITIES}
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
    /*
      Row **C8**. The right click is on the drawing now, so the key map has to
      say so — and it has to say the *other* route in the same breath, because a
      right click has no keyboard equivalent every platform agrees on and this
      paragraph is what the canvas's `aria-describedby` points at. The second
      sentence is the panel's list, named as the pointer-free way in.
    */
    expect(keys?.textContent).toMatch(/Right-click a piece to choose what goes in its slots/)
    expect(keys?.textContent).toMatch(/Pieces on the plan list/)
    // And the right button is a pan, which is the interaction the 5 px
    // threshold protects — the sentence used to name only the middle one.
    expect(keys?.textContent).toMatch(/drag with the right or middle button/)
    // And a live region for the announcements, polite and atomic.
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live?.getAttribute('aria-atomic')).toBe('true')
  })
})
