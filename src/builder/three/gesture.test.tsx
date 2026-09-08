// @vitest-environment jsdom
/**
 * The right click, on the piece — mounted for real, and this file is the answer
 * to a claim two rows made and neither tested.
 *
 * `room.test.tsx` says *"`useThree` cannot run outside a `<Canvas>`, so the real
 * component is unmountable here"*, and `edits.ts` repeats it: **the pointer path
 * is unreachable from jsdom**. That was true of the *renderer* and never true of
 * the *listeners*. `RoomSurface` reaches r3f through exactly one hook, and what
 * it asks that hook for is a camera, a canvas element and an `invalidate`
 * callback — a `PerspectiveCamera` built from `src/three/frame.ts`'s own numbers
 * is one, a `<canvas>` in a wrapper div is another, and a no-op is the third. So
 * the hook is mocked, the component mounts, and **the whole gesture path becomes
 * testable**: the listeners are attached to a real element, `fireEvent`
 * dispatches real events at it, and `pickSurface` runs the same unprojection
 * `surface.test.ts` proves against the same frame.
 *
 * That is worth stating plainly, because row C8's subject is a gesture and the
 * alternative was to assert its two halves apart — `edits.test.ts` for what a
 * pick means and `surface.test.ts` for what five pixels mean — and to leave the
 * wiring between them, which is the part that was missing, unasserted.
 *
 * ## What jsdom still cannot do, and how the tests are shaped around it
 *
 * `getBoundingClientRect` reports every element as 0 x 0. `ndcOf` returns the
 * element's **centre** for a zero-sized rect rather than a NaN — deliberately,
 * and its docblock says so — so every pick in this file resolves to the point
 * the camera is looking at, which is plan `(0, 0)`. The `clientX`/`clientY` a
 * test passes therefore decide the *gesture* (five pixels or twenty) and not the
 * *point*, and a test that wants a particular part under the pointer moves the
 * **piece** instead. Each one below says which part it has put over the origin.
 *
 * No renderer runs, so nothing here is about the picture. `room.test.tsx`'s list
 * of what needs a GPU is unchanged.
 *
 * ## Rows D3 and D7 share the seam, and D7 asserts a *request* through it
 *
 * The hover cue comes off the same `under` this file's picks resolve, so it
 * belongs here rather than in a second file that would copy the harness. It
 * needs two things the gesture tests did not, and both are in the mocks above
 * rather than in the tests: `invalidate` **counts** (a `frameloop="demand"`
 * surface that changes state without asking for a frame does not redraw, which
 * is a defect D3 found in the keyboard path), and `plateGeometry` counts too,
 * delegating to the real one — the cue's cost claim is about what a pointer move
 * allocates, and a counter is the only way to say that.
 *
 * **Row D7 changed what there is to assert, in the useful direction.** D3 drew
 * the cue as `lineSegments` inside the surface's own tree, so its tests read
 * `<lineBasicMaterial color=…>` off jsdom's unknown DOM tags and counted loops.
 * D7 draws it as a silhouette in a post pass, which no jsdom test can see — and
 * what the surface contributes instead is an `OutlineRequest`: the geometries
 * that are *on screen*, the matrices they are drawn with, and a colour. That is
 * a stronger thing to assert than a coloured tag, because it is exactly what was
 * wrong before — D3's loops were built from the tagged footprint, the request is
 * built from the drawn geometry, so an assertion on subject **identity** is an
 * assertion that the cue traces the picture.
 *
 * The line assertions are kept and inverted: after a hover there must be **no**
 * `lineBasicMaterial` in the cue's colour anywhere in the tree, which is the
 * guard against D3's drawing coming back beside the new one.
 *
 * What no headless test can say is what the silhouette looks like — that is a
 * browser and a pixel diff, and row D7 reports one. The contrast assertions
 * below are the closest this gets: they bound the colour against the ground and
 * against all sixteen contours, in the palette's own units.
 */
import { fireEvent, render } from '@testing-library/react'
import { Box3, BufferAttribute, BufferGeometry, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlanScene } from '@/builder/canvas'
import { buildPlanScene, createStyleResolver, planCatalogFromFile } from '@/builder/canvas'
import {
  FIXTURE_IDS,
  FIXTURE_SLOTS,
  FIXTURE_TEMPLATE,
  fixtureCatalogFile,
  fixtureSlotLayout,
} from '@/builder/canvas/fixture'
import type { BlobId } from '@/catalog'
import { resolveMaterial } from '@/materials'
import { contrastRatio, formatHex, parseHex } from '@/materials/color'
import { MATERIALS } from '@/materials/palette'
import type { TemplateId } from '@/store'
import { PlacementId } from '@/store'
import { aGeneratedBase } from '@/store/fixture'
import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, CAMERA_POSITION, VIEW_RADIUS } from '@/three/frame'
import type { OutlineRequest } from '@/three/outline'
import { color } from '@/tokens/tokens'

import type { LodGeometry } from './loadLod'
import type * as Markers from './markers'

/*
  The three things `useThree` is asked for, and nothing else. The canvas sits in
  a wrapper div because the surface attaches its `pointerdown` listener to
  `canvas.parentElement` in the **capture** phase — that is how it takes a press
  away from `OrbitControls` without racing it — so a canvas with no parent would
  silently test a different code path from the one that ships.
*/
const canvas = document.createElement('canvas')
const host = document.createElement('div')
host.append(canvas)
document.body.append(host)

const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR)
camera.position.set(...CAMERA_POSITION)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld(true)

/** Frames the surface has asked for. Row D3; see the docblock. */
let frames = 0

/*
  One `invalidate`, defined once at module scope rather than per `useThree` call:
  the surface has it in an effect's dependency list, so a fresh function every
  render would invalidate on every render and the count would measure the mock.
*/
const invalidate = () => {
  frames += 1
}

/*
  `size` is the fourth thing, and it is in **CSS pixels** — which is the whole
  point of it. `ScreenLine` feeds it to `LineMaterial.resolution`, and that is
  what makes a line width stated in CSS pixels mean the same thing on every
  display. A mock without it renders the grid, the plate rings and the caret at
  `undefined` and throws, which is the right way round: the surface really does
  depend on this now.
*/
const size = { width: 800, height: 600 }

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: unknown) => unknown) =>
    selector({ camera, gl: { domElement: canvas }, invalidate, size }),
}))

/**
 * Plate geometries built. Row D7; the real function still does the work.
 *
 * `plateGeometry` and not D3's `plateEdgeGeometry`, because the plate's geometry
 * is now the *silhouette's* geometry as well — the surface owns one object that
 * the plate draws and the cue outlines, which is the whole reason the cue traces
 * what is on screen. So this counter is what says a pointer move allocates
 * nothing.
 */
let plateBuilds = 0

/*
  The instanced draw is stubbed, and only because jsdom cannot host it.

  `InstancedTiles` writes matrices through the ref r3f gives it — but with r3f
  mocked, `<instancedMesh>` reaches jsdom as an unknown DOM tag and the ref is an
  `HTMLElement`, so `setMatrixAt` does not exist and the effect throws. That is
  why every test in this file before row D7 passed an empty geometry map: with no
  mesh anywhere, the component never mounted.

  D7 needs the opposite — a room with real groups in it, because the hover cue's
  subjects come out of `Room3D.groups` — so the *draw* is stubbed while
  `buildRoom3D` runs for real. Nothing is lost: the matrices under test are the
  ones this file reads back off the room it built, and `instances.test.ts`
  asserts that projection against the repository's own GLB.
*/
vi.mock('./InstancedTiles', () => ({ InstancedTiles: () => null }))

/*
  `ScreenLine` as a recorder, and the swap is what keeps the D3 guard below
  meaningful.

  D3's drawing was `<lineSegments><lineBasicMaterial color=…/></lineSegments>`,
  which reaches jsdom as unknown DOM tags with readable attributes, so the guard
  against it coming back could read colours straight off the document. The real
  `ScreenLine` builds its `LineSegments2` and `LineMaterial` imperatively and
  mounts them through `<primitive object={…}>`, where React stringifies the
  object and the colour is unreadable — so left alone, that guard would have gone
  quietly vacuous, which is worse than failing.

  The stub renders the two things the assertions are about as attributes. It also
  makes the **width** assertable, which the old drawing never was: that width was
  one device pixel and appeared in no source file, and that is the whole reason
  this component exists.
*/
vi.mock('@/three/ScreenLine', () => ({
  // A `div` with data attributes rather than an invented tag: r3f declares the
  // intrinsic elements this file leans on, and `<screenline>` is not one of
  // them, so a custom tag is a type error rather than a readable stub.
  ScreenLine: ({ colour, widthPx }: { colour?: string; widthPx: number }) => (
    <div data-screenline="" data-colour={colour ?? ''} data-width={String(widthPx)} />
  ),
}))

/*
  `SelectionAnchor` stubbed, for exactly the reason `InstancedTiles` is.

  The anchor is drei's `<Html>`, and drei reaches r3f's store through its own CJS
  entry — which this file's `@react-three/fiber` mock does not cover, so the real
  `useThree` runs and throws *"Hooks can only be used within the Canvas
  component"*. Every mount with a selection would fail on the wrapper rather than
  on its subject.

  Nothing is lost, because the wrapper is the one part of this design that was
  decomposed to be untestable here: the clamp it exists for is `anchor.test.ts`'s
  subject and the bar's markup is `pieceActions.test.tsx`'s, both without a
  canvas. What this file is about is the gesture, and a selection has to be
  mountable for that.
*/
vi.mock('./SelectionAnchor', () => ({ SelectionAnchor: () => null }))

vi.mock('./ArmedAnchor', () => ({ ArmedAnchor: () => null }))

vi.mock('./markers', async (importOriginal) => {
  const actual = await importOriginal<typeof Markers>()
  return {
    ...actual,
    plateGeometry: (...args: Parameters<typeof actual.plateGeometry>) => {
      plateBuilds += 1
      return actual.plateGeometry(...args)
    },
  }
})

const { HOVER_GLOW, RoomSurface } = await import('./RoomSurface')
const { fixtureFiller, planHistory, planTools, sceneOf } = await import('./fixture')
const { surfaceFit } = await import('./surface')
const { buildRoom3D } = await import('./instances')

/** The layout rule with real offsets, so a template's parts occupy real cells. */
const CATALOG = planCatalogFromFile(fixtureCatalogFile(), fixtureSlotLayout)
const STYLE = createStyleResolver(CATALOG)
const FIT = surfaceFit(VIEW_RADIUS)

/**
 * A two-part corner anchored so that a chosen part covers the picked point.
 *
 * `fixtureSlotLayout` puts the 2 x 2 floor on the cell and the right wall at
 * `dx: 1.5`, half a unit wide, so the floor spans `x … x + 2` and the wall spans
 * `x + 1.5 … x + 2`. With `z = -1.5` the picked point `(0, 0)` is inside the
 * floor's `z` range and the anchor decides the part: at `x = -1` the wall is off
 * at `0.5 … 1` and the floor is what covers the origin, and at `x = -1.75` the
 * wall spans `-0.25 … 0.25` and covers it itself.
 *
 * **`z = -1.5` and not `-1`, and the reason is the parallax `surface.ts` exists
 * to correct** — it is not a magic number and it is worth reading before
 * changing one of these anchors. `pickSurface` tries each occupied elevation
 * highest-first, `heightOf` credits a piece with its **tallest** part's top, and
 * this corner's tallest part is the wall at 12.7 mm + a 0.6 mm plate. A surface
 * 13.3 mm up projects `groundParallaxUnits(13.3)` = **1.011 grid units** beyond
 * where it stands at the start camera, so the wall plane's own plan point is
 * `(0.592, 0.820)` rather than `(0, 0)`. At `z = -1` that lands inside the piece
 * and the pick accepts it, and the slot named is the wall's — which
 * {@link parallax} below asserts on purpose. At `z = -1.5` the piece's `z` range
 * ends at `0.5`, so `0.820` falls outside it, the elevated plane is rejected for
 * exactly the reason `surface.ts` rejects it, and the pick falls to the ground
 * point the two anchors were chosen against.
 */
function corner(x: number, z = -1.5): PlanScene {
  return sceneOf(CATALOG, [
    {
      fills: [
        [FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2],
        [FIXTURE_SLOTS.rightWall, FIXTURE_IDS.wall2],
      ],
      x,
      z,
    },
  ])
}

/** What one mounted surface recorded. */
interface Mounted {
  readonly opened: { placement: string; slot: string | undefined }[]
  readonly said: string[]
  /** Presses that reached the canvas — i.e. that the surface did **not** claim. */
  readonly reached: number[]
  /**
   * Every hover cue published, in order. Row D7.
   *
   * The list and not the last one, because the row's cost claim is about *how
   * many times* it is published: a request per piece the pointer crosses, and
   * nothing at all for the moves in between.
   */
  readonly cues: OutlineRequest[]
  /**
   * The tool recorder the surface was handed.
   *
   * Exposed so a test can assert what a *gesture* asked the state to do —
   * `calls.armed` for a disarm, `calls.selection` for a select — without
   * reaching for a second mount. The surface writes to `PlanTools` for two of
   * its verbs now (arming and selecting), where before it only ever read.
   */
  readonly tools: ReturnType<typeof planTools>
}

/**
 * The surface, mounted over a scene, with every callback recording.
 *
 * `tool` is **gone** with the modes, and the two options that replaced it are
 * not a rename: what the primary button means is now a reading of what is armed
 * or selected, so a test arranges the *state* it wants and the gesture follows.
 * `armed` and `selected` are mutually exclusive in `usePlanTools`, and the
 * default — neither — is the idle state a press on a piece resolves as a
 * selection in.
 */
function mount(
  scene: PlanScene,
  options: {
    readonly wired?: boolean
    /** The armed family. A press on the plan then places rather than selecting. */
    readonly armed?: string | null
    /** The selected placement, for the tests about the selection's own chrome. */
    readonly selected?: string | null
    /** Store objects by blob, for the tests that want a mesh instead of a plate. */
    readonly geometries?: ReadonlyMap<string, LodGeometry>
  } = {},
) {
  const armed = options.armed ?? null
  const tools = planTools({ selectedTemplate: armed, selected: options.selected ?? null })
  const state: Mounted = { opened: [], said: [], reached: [], cues: [], tools }
  const onDown = (event: Event) => {
    state.reached.push((event as MouseEvent).button)
  }
  canvas.addEventListener('pointerdown', onDown)
  listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown)
  })

  const geometries = options.geometries ?? new Map<string, LodGeometry>()
  const room = buildRoom3D(scene, {
    geometries,
    resolve: (record) => resolveMaterial(CATALOG.tags(record), record.file),
    viewRadius: VIEW_RADIUS,
  })
  render(
    <RoomSurface
      announce={(text) => state.said.push(text)}
      armed={armed === null ? null : (armed as TemplateId)}
      catalog={CATALOG}
      fill={fixtureFiller()}
      fit={FIT}
      geometries={geometries}
      history={planHistory()}
      keyHelpId="of-keys"
      label="a room"
      {...(options.wired === false
        ? {}
        : {
            onEditSlots: (placement, slot) => state.opened.push({ placement, slot }),
          })}
      onOutline={(request) => state.cues.push(request)}
      onStatus={() => undefined}
      room={room}
      scene={scene}
      tools={tools}
    />,
  )
  return state
}

const listeners: (() => void)[] = []

beforeEach(() => {
  listeners.length = 0
})

afterEach(() => {
  for (const off of listeners) off()
})

/** A pointer event jsdom will construct: `MouseEvent` carries every field read. */
function press(type: string, button: number, at: readonly [number, number], init: MouseEventInit = {}) {
  fireEvent(
    canvas,
    new MouseEvent(type, { bubbles: true, button, clientX: at[0], clientY: at[1], ...init }),
  )
}

/**
 * A pointer move over the canvas. `buttons` is what is *held* during it, which
 * is how the surface tells a hover from an orbit or a pan.
 *
 * `button` is `-1`, the UI Events value for *no button changed state* — which is
 * what a move is, and it keeps a move clear of the surface’s `SECONDARY_BUTTON`.
 */
function hover(at: readonly [number, number] = [100, 100], buttons = 0) {
  press('pointermove', -1, at, { buttons })
}

/**
 * Every line colour in the drawing, in paint order.
 *
 * Read off the `ScreenLine` stub above. Every outline in the surface is one of
 * these: a plate's own contour, the ghost's fallback ring, and the caret.
 */
function lineColours(): string[] {
  return [...document.querySelectorAll('[data-screenline]')].map((node) => node.getAttribute('data-colour') ?? '')
}

/** Every line width in the drawing, in CSS pixels. */
function lineWidths(): number[] {
  return [...document.querySelectorAll('[data-screenline]')].map((node) => Number(node.getAttribute('data-width')))
}

/** How many outlines are drawn in `colour`. */
function ringsIn(colour: string): number {
  return lineColours().filter((value) => value === colour).length
}

/**
 * The cue as it stands: how many silhouettes, and in what colour.
 *
 * The *last* published request, because the surface publishes on change and a
 * reader asking "what is outlined now" wants the latest. `state.cues.length` is
 * the separate question the cost tests ask.
 */
function cue(state: Mounted): { count: number; colour: string } {
  const last = state.cues.at(-1)
  return { count: last?.subjects.length ?? 0, colour: last?.colour ?? '' }
}

/**
 * A store object, without a store — a mesh 25.4 x 12.7 x 63.5 mm, Z-up.
 *
 * Hand-built rather than parsed from `fixtures/wall-8180da93.glb`, and the
 * distinction matters: `instances.test.ts` parses the real object because it
 * asserts things about *bytes* — the node transform, the attribute set, the
 * triangle count. What the cue asserts is **identity**: that the subject handed
 * to the pass is the group's own `geometry` object carrying the group's own
 * matrix, scaled by the surface's fit. Any non-degenerate bounds prove that, and
 * a synthetic one keeps a WASM decoder out of a jsdom suite.
 *
 * The dimensions are a shipped wall's, so `tileMatrix` stands up something with
 * the proportions of a real piece rather than a unit cube.
 */
function lodFixture(blob: string): LodGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 25.4, 0, 0, 0, 12.7, 63.5]), 3))
  return {
    blob: blob as BlobId,
    geometry,
    bounds: new Box3(new Vector3(0, 0, 0), new Vector3(25.4, 12.7, 63.5)),
    triangles: 1,
    vertices: 3,
    bytes: 0,
    decodedBytes: 0,
    nodeScale: 1,
    footprintDelta: () => ({ w: 0, d: 0, worst: 0 }),
    dispose: () => undefined,
  }
}

/** One store object per blob the scene's parts name, so every part has a mesh. */
function meshesFor(scene: PlanScene): Map<string, LodGeometry> {
  const geometries = new Map<string, LodGeometry>()
  for (const piece of scene.pieces) {
    for (const part of piece.parts) geometries.set(part.record.blob, lodFixture(part.record.blob))
  }
  return geometries
}

/** `--acc` mixed `amount` of the way to `to`, per channel in gamma-encoded sRGB. */
function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  return formatHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ])
}

/** A press and a release of the secondary button, `travel` pixels apart. */
function rightClick(travel = 0) {
  press('pointerdown', 2, [100, 100])
  press('pointerup', 2, [100, 100 + travel])
}

/**
 * The right button, after the selection took the slot editor off it.
 *
 * Five `describe`s and eleven tests used to live here, all about a right click
 * opening the slot editor: which placement it named, which slot the part decided,
 * what it announced, how it shared `isClickGesture`'s 5 px boundary with the
 * camera pan, and how the two presses were kept apart so a chord could not
 * resolve the wrong one. **Every one of their subjects is deleted.**
 *
 * They are not replaced one for one, because the gesture was not moved — it was
 * *made unnecessary*. The right click was carrying the editor because with no
 * persistent selection the only operand available was whatever the pointer
 * resolved to; the `Slots` button on the selected piece's action bar has an
 * operand the user chose, and `pieceActions.test.tsx` covers it without a canvas.
 *
 * What survives is what is still true about the button, and one regression that
 * would still be a defect if it came back.
 */
describe('the right button pans, and cancels what is armed', () => {
  it('opens no dialog, at any travel distance', () => {
    // The gesture row C3 hung here is gone at both ends of the old 5 px
    // discriminator, which is the simplification the selection bought.
    const state = mount(corner(-1))
    rightClick(0)
    rightClick(20)
    expect(state.opened).toEqual([])
  })

  it('disarms on a click, which is the way out the armed label promises', () => {
    /*
      `ArmedLabel` tells the user *"Esc or right-click to cancel"*, and a
      promise on screen has to be kept by the gesture layer. This is the second
      half; `planTools.test.tsx` covers what `arm(null)` does to the state.

      Hung on this button deliberately, and it is a much safer thing to hang
      here than the slot editor was: a stray cancel costs one click to undo by
      re-arming, where a stray dialog interrupted the pan it was mistaken for.
    */
    const state = mount(corner(-1), { armed: FIXTURE_TEMPLATE })
    rightClick(0)
    expect(state.tools.calls.armed).toEqual([null])
    expect(state.said.at(-1)).toBe('Nothing armed.')
  })

  it('does not disarm on a pan, because a pan is not a cancel', () => {
    // The 5 px question, and the whole reason the seam is a `pointerup` rather
    // than a `contextmenu` listener: `contextmenu` fires from the mouse *down*
    // on X11 and macOS, before any travel exists to measure, so it would cancel
    // the arming at the start of every pan gesture.
    const state = mount(corner(-1), { armed: FIXTURE_TEMPLATE })
    rightClick(20)
    expect(state.tools.calls.armed).toEqual([])
    expect(state.said).toEqual([])
  })

  it('says nothing when a right-click has nothing to cancel', () => {
    // With nothing armed the button is purely the camera's, and a builder that
    // announced "nothing armed" every time the user finished a pan would be
    // narrating the camera.
    const state = mount(corner(-1))
    rightClick(0)
    expect(state.tools.calls.armed).toEqual([])
    expect(state.said).toEqual([])
  })

  it('never claims the press, so the event still reaches the controls', () => {
    /*
      `OrbitControls` listens on the canvas. The surface's own listener is
      capture-phase on the canvas's **parent**, so claiming a press —
      `stopPropagation` — stops it ever reaching the canvas at all. That is what
      a press that picks a piece up deliberately does, and it is what a right
      press must never do: claiming it would take the camera pan away from the
      right button.

      Asserted against the primary path rather than in isolation, because a test
      that only showed the secondary press arriving would pass on a surface whose
      capture listener had stopped working altogether. The primary press is on a
      piece with nothing armed, which is the gesture that selects it and picks it
      up in one — the claim `move` mode used to be needed for.
    */
    const state = mount(corner(-1))
    press('pointerdown', 2, [100, 100])
    expect(state.reached).toEqual([2])

    press('pointerdown', 0, [100, 100])
    expect(state.reached).toEqual([2])
  })

  it('leaves the browser’s own menu alone', () => {
    /*
      **The opposite of what this file asserted before, and deliberately.** The
      `contextmenu` listener existed for two reasons, and both were about a
      dialog the right click opened: the native menu would cover the editor, and
      on Windows `contextmenu` fires from the mouse *up*, where a menu taking
      focus could swallow the `pointerup` the gesture was measured on.

      No dialog opens from this button any more, so suppressing the menu would be
      taking a browser affordance away for nothing. A user right-clicking the
      canvas gets their menu, exactly as they do everywhere else on the page.
    */
    mount(corner(-1))
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvas.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not let a secondary release resolve a primary press', () => {
    /*
      **A defect row C8 found and fixed, kept fixed through the deletion.**
      `onUp` used to read one press slot whatever button was released, so holding
      the primary button and right-clicking passed the 5 px test against the
      *primary* press and ran the place gesture.

      The two-slot bookkeeping that fixed it is gone with the gesture that needed
      it — `onUp` now returns immediately on a secondary release — so the fix is
      by construction rather than by arithmetic. This asserts the outcome either
      implementation owes: mounted **armed**, which is what leaves the primary
      press unclaimed and therefore the only state the defect was reachable from,
      a secondary release must not place anything.
    */
    const state = mount(corner(-1), { armed: FIXTURE_TEMPLATE })
    press('pointerdown', 0, [100, 100])
    press('pointerdown', 2, [100, 100])
    press('pointerup', 2, [100, 100])

    expect(state.said.filter((text) => /^Placed /.test(text))).toEqual([])
    expect(state.opened).toEqual([])
  })
})

describe('the piece under the pointer is outlined by its own silhouette', () => {
  it('publishes one subject per drawn part, in the hover colour', () => {
    // The two-part corner, with no mesh for either part — so both are drawn as
    // footprint plates and both plates are what the cue outlines. The pass
    // unions them, so this is two subjects and one loop on screen.
    const state = mount(corner(-1))
    expect(cue(state).count).toBe(0)
    hover()
    expect(cue(state)).toEqual({ count: 2, colour: HOVER_GLOW })
  })

  it('hands the pass the geometry that is drawn, not a footprint polygon', () => {
    /*
      **The row.** D3 built the cue from `polygons` — the tagged footprint — as a
      flat loop lifted to the part's top, which on a wall is a rectangle floating
      over the mesh. The subject's `geometry` must therefore be the very object
      the room draws: identical by reference to the `InstancedMesh`'s geometry for
      a part with a mesh, and to the plate's geometry for one without.
    */
    const scene = corner(-1)
    const geometries = meshesFor(scene)
    const state = mount(scene, { geometries })
    hover()

    const drawn = [...geometries.values()].map((lod) => lod.geometry)
    const last = state.cues.at(-1)
    expect(last?.subjects).toHaveLength(2)
    for (const subject of last?.subjects ?? []) expect(drawn).toContain(subject.geometry)
  })

  it('carries the matrix the instance is drawn with, in the surface’s own frame', () => {
    // Not `tileMatrix` run a second time: the matrix is read out of the built
    // room, so the cue cannot disagree with the picture about where the piece
    // is. What the surface adds is its group's scale, because the pass draws in
    // the scene's frame and the room is drawn in millimetres inside a scaled
    // group.
    const scene = corner(-1)
    const room = buildRoom3D(scene, {
      geometries: meshesFor(scene),
      resolve: (record) => resolveMaterial(CATALOG.tags(record), record.file),
      viewRadius: VIEW_RADIUS,
    })
    const state = mount(scene, { geometries: meshesFor(scene) })
    hover()

    const scale = new Matrix4().makeScale(FIT.scale, FIT.scale, FIT.scale)
    const expected = room.groups.flatMap((group) =>
      group.matrices.map((matrix) => new Matrix4().multiplyMatrices(scale, matrix).elements.join()),
    )
    const published = (state.cues.at(-1)?.subjects ?? []).map((subject) => subject.matrix.elements.join())
    expect(published.length).toBe(2)
    for (const matrix of published) expect(expected).toContain(matrix)
  })

  it('draws no line for the cue, which is what row D3 got wrong', () => {
    // The guard against the old drawing coming back beside the new one. The
    // plates keep their own contours — that is what a plate *is* — so the
    // assertion is on the cue's two colours and not on the count of lines.
    const state = mount(corner(-1))
    hover()
    expect(cue(state).count).toBe(2)
    expect(ringsIn(HOVER_GLOW)).toBe(0)
    expect(ringsIn(color.acc)).toBe(0)
  })

  it('states a width in CSS pixels for every line it draws', () => {
    // The guard for the class of bug that produced this component. A
    // `<lineSegments>` is one *device* pixel wide, which is a width nobody chose
    // and which silently halved when the dpr floor moved — so what must hold is
    // not a particular number but that every line has a stated, finite width in
    // a unit that does not move with the display.
    const state = mount(corner(-1))
    hover()
    expect(state.cues.length).toBeGreaterThan(0)
    const widths = lineWidths()
    expect(widths.length).toBeGreaterThan(0)
    for (const width of widths) {
      expect(Number.isFinite(width)).toBe(true)
      expect(width).toBeGreaterThan(0)
    }
  })

  it('publishes nothing at all over bare ground', () => {
    const state = mount(sceneOf(CATALOG, []))
    hover()
    expect(cue(state).count).toBe(0)
  })

  it('outlines a generated base too, which is a plate and has no slots', () => {
    const scene = buildPlanScene({}, CATALOG, STYLE, {
      [PlacementId.parse('g0')]: aGeneratedBase({ x: -1, z: -1 }),
    })
    const state = mount(scene)
    hover()
    expect(cue(state).count).toBe(1)
  })

  it('outlines a half-converted template whole, mesh part and plate part alike', () => {
    /*
      The case D3's predecessor got wrong in the other direction: it *skipped*
      the ring for any piece carrying a plate, so a template with one mesh loaded
      and one still waiting highlighted only the one that was waiting. One rule
      here — outline whatever each part is drawn as — so a piece half way through
      converting is still outlined as one piece.
    */
    const scene = corner(-1)
    const first = scene.pieces[0]?.parts[0]?.record.blob
    const state = mount(scene, { geometries: new Map([[String(first), lodFixture(String(first))]]) })
    hover()
    expect(cue(state).count).toBe(2)
  })

  it('hands the loud colour to the selection, which is what the verbs act on', () => {
    /*
      One drawing at two strengths and not two drawings, which is the decision
      erase mode's cue made and the selection inherited — for a better reason
      than erase had. `OutlineRequest` carries **one** colour and one
      `edgeStrength` for the whole request, so a second weight means a second
      `OutlineEffect`, a second mask target and a second fullscreen quad against
      a pass `Stage.tsx` is deliberate about costing one. So the pass draws
      whichever cue is live, at whichever strength, and the selection's
      *persistent* cue is a different drawing entirely — `markers.ts`'s contour
      on the footprint, which is what stays visible while the pointer is
      elsewhere.

      `p0` is the id `placementsOf` gives the corner, so the piece selected here
      is the piece the pointer is over: one subject list, in the loud colour.
    */
    const state = mount(corner(-1), { selected: 'p0' })
    hover()
    expect(cue(state)).toEqual({ count: 2, colour: color.acc })
  })

  it('goes back to the quiet colour with nothing selected', () => {
    // The colour is the axis, so it has to be shown moving in both directions:
    // a cue that were always loud would pass the assertion above and say nothing.
    const state = mount(corner(-1))
    hover()
    expect(cue(state).colour).toBe(HOVER_GLOW)
  })

  it('keeps the pass on the selection while the pointer is over a neighbour', () => {
    /*
      **The defect this exists for**, found in review rather than by a test: the
      subject list was memoised on the *hovered* piece while the colour was read
      off the *selected* one. So pointing at a neighbour of the selected piece
      outlined the neighbour in the selection colour — which does not merely show
      a cue at the wrong strength, it says the wrong piece is selected.

      Two pieces, far enough apart that the pointer at (100, 100) lands on
      neither: with `p0` selected the pass must still be drawing `p0`, in the
      loud colour, and the hover must contribute nothing to it. What keeps the
      hover visible at all in this state is a different drawing — `markers.ts`'s
      contour, which is on the plan and not in this pass.
    */
    const state = mount(corner(-1), { selected: 'p0' })
    hover([2, 2])
    expect(cue(state)).toEqual({ count: 2, colour: color.acc })
  })
})

describe('“slightly”, as the palette measures it', () => {
  it('is the accent lifted 35% of the way to the page ground, and not a new colour', () => {
    // The one assertion that keeps a hand-edited digit from becoming a design
    // decision: both endpoints are tokens from §1's own table.
    expect(HOVER_GLOW).toBe(mix(color.acc, color.bg, 0.35))
  })

  it('carries less contrast against the ground than the ring erase draws', () => {
    // This is the whole of the word. Against the parchment the plan is drawn on,
    // pointing at a piece must not read as arming it.
    expect(contrastRatio(HOVER_GLOW, color.bg)).toBeLessThan(contrastRatio(color.acc, color.bg))
    expect(contrastRatio(HOVER_GLOW, color.bg)).toBeGreaterThan(2)
  })

  it('is nonetheless a bigger change to every family’s contour than the accent is', () => {
    // Where the line actually lands on a mesh-less part is on top of that part's
    // own dark contour, and `palette.ts`'s rule is that silhouette is carried by
    // the contour and not by the fill. So the cue being quiet against the ground
    // costs nothing where it is read.
    for (const family of Object.values(MATERIALS)) {
      expect(contrastRatio(HOVER_GLOW, family.edge)).toBeGreaterThan(3.2)
      expect(contrastRatio(HOVER_GLOW, family.edge)).toBeGreaterThan(contrastRatio(color.acc, family.edge))
    }
  })
})

describe('the cue and the camera', () => {
  it('goes out while a button is held, because a held button is the camera', () => {
    // Left orbits and right pans, and both keep firing `pointermove`. A cue that
    // hopped from piece to piece while the view swung under a stationary hand
    // would be worse than no cue.
    const state = mount(corner(-1))
    hover()
    expect(cue(state).count).toBe(2)
    // The primary button: an orbit.
    hover([100, 100], 1)
    expect(cue(state).count).toBe(0)
    // Let go and it is back, so the suppression is a state and not a latch.
    hover([100, 100], 0)
    expect(cue(state).count).toBe(2)
    // The secondary button: a pan, which row C8 corrected `OrbitControls` binds
    // to `MOUSE.PAN` — and which the surface deliberately never claims.
    hover([100, 100], 2)
    expect(cue(state).count).toBe(0)
  })

  it('comes back on the release, without waiting for the next move', () => {
    const state = mount(corner(-1))
    hover([100, 100], 1)
    expect(cue(state).count).toBe(0)
    press('pointerup', 0, [100, 100])
    expect(cue(state).count).toBe(2)
  })

  it('survives a click, which is a press with no travel in it', () => {
    // The 5 px gesture: nothing moves, so nothing reports a held button, so the
    // piece the user just clicked stays named.
    const state = mount(corner(-1))
    hover()
    press('pointerdown', 0, [100, 100])
    press('pointerup', 0, [100, 100])
    expect(cue(state).count).toBe(2)
  })
})

describe('what the cue costs', () => {
  it('publishes once per piece the pointer crosses, not once per move', () => {
    // The row's cost claim, and the mechanism is D3's: `pieceAt` returns the
    // scene's own object, so `under` keeps its identity while the pointer stays
    // on one piece, the subject list is memoised on it, and the effect that
    // publishes has nothing new to publish.
    const state = mount(corner(-1))
    hover([100, 100])
    const published = state.cues.length
    for (let i = 0; i < 20; i += 1) hover([100 + i, 100])
    expect(state.cues.length).toBe(published)
  })

  it('allocates no geometry for a hover, because the plate already built it', () => {
    // What D7 buys over D3 on cost as well as on looks: D3 built an outline
    // geometry per hovered part, so entering a two-part piece built two. The cue
    // now borrows the geometry that is already on screen, so entering a piece
    // builds none — the count is whatever the scene's plates cost at mount.
    mount(corner(-1))
    plateBuilds = 0
    hover([100, 100])
    for (let i = 0; i < 20; i += 1) hover([100 + i, 100])
    expect(plateBuilds).toBe(0)
  })

  it('asks for no more frames than the surface asked for before it', () => {
    // `onMove` already invalidated on every pointer move — for the ghost — so
    // the cue rides a redraw that was already being paid for.
    mount(corner(-1))
    hover()
    frames = 0
    for (let i = 0; i < 10; i += 1) hover([100 + i, 100])
    expect(frames).toBe(10)
  })
})

describe('the keyboard gets the same cue, and asked for a frame that never came', () => {
  it('outlines the piece that ] steps to, with no pointer involved', () => {
    // The cue follows the *cursor*, which the arrow keys and `[` / `]` write, so
    // the piece a keyboard user is told about is the piece they can see outlined.
    const state = mount(corner(-1))
    expect(cue(state).count).toBe(0)
    fireEvent.keyDown(canvas, { key: ']' })
    expect(cue(state).count).toBe(2)
  })

  it('invalidates on a keyboard cursor move, which row D3 found it did not', () => {
    /*
      **A defect this row found rather than one it introduced.** `frameloop` is
      `demand`, so a state change nothing invalidates is not drawn. `onMove`,
      `nudge` and the effect over the ghost, the preview, the plates and the
      focus ring all ask for a frame; `moveCursor` and `stepToPiece` did not, and
      the cursor is not in that effect's dependencies — so with nothing armed
      there was no `ghost` to change and an arrow key moved the caret in state
      without redrawing it. Measured on the parent commit: an arrow key and a `]`
      each invalidated **0** times. Both are 1 now.
    */
    mount(corner(-1))
    fireEvent.keyDown(canvas, { key: 'x' })
    frames = 0
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect(frames).toBe(1)
    frames = 0
    fireEvent.keyDown(canvas, { key: ']' })
    expect(frames).toBe(1)
  })
})
