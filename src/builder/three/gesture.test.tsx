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
 * ## Row D3 shares the seam, and asserts a *drawing* through it
 *
 * The hover glow is drawn by the same component these tests already mount, from
 * the same `under` this file's picks resolve, so it belongs here rather than in a
 * second file that would copy the harness. It does need two things the gesture
 * tests did not, and both are in the mocks above rather than in the tests:
 * `invalidate` **counts** (a `frameloop="demand"` surface that changes state
 * without asking for a frame does not redraw, which is a defect this row found in
 * the keyboard path), and `plateEdgeGeometry` counts too, delegating to the real
 * one — the glow's whole cost claim is that it builds an outline per hovered
 * *piece* and not per pointer move, and a counter is the only way to say that.
 *
 * What it still cannot say is what the line looks like. jsdom renders r3f's
 * elements as unknown DOM tags, so `<lineBasicMaterial color=…>` is readable as
 * an attribute and **that is what the colour assertions read** — which piece is
 * ringed, in which colour, and how many loops. Whether 0.9 of `#ae885a` reads as
 * a glow over a lit stone tint is a question for a browser and a pair of eyes,
 * and the contrast assertions below are the closest a headless test gets: they
 * bound the colour against the ground and against all sixteen contours, in the
 * palette's own units.
 */
import { fireEvent, render } from '@testing-library/react'
import { PerspectiveCamera } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlanScene } from '@/builder/canvas'
import { buildPlanScene, createStyleResolver, planCatalogFromFile } from '@/builder/canvas'
import { FIXTURE_IDS, FIXTURE_SLOTS, fixtureCatalogFile, fixtureSlotLayout } from '@/builder/canvas/fixture'
import { resolveMaterial } from '@/materials'
import { contrastRatio, formatHex, parseHex } from '@/materials/color'
import { MATERIALS } from '@/materials/palette'
import { PlacementId } from '@/store'
import { aGeneratedBase } from '@/store/fixture'
import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, CAMERA_POSITION, VIEW_RADIUS } from '@/three/frame'
import { color } from '@/tokens/tokens'

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

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: unknown) => unknown) => selector({ camera, gl: { domElement: canvas }, invalidate }),
}))

/** Outline geometries built. Row D3; the real function still does the work. */
let outlineBuilds = 0

vi.mock('./markers', async (importOriginal) => {
  const actual = await importOriginal<typeof Markers>()
  return {
    ...actual,
    plateEdgeGeometry: (...args: Parameters<typeof actual.plateEdgeGeometry>) => {
      outlineBuilds += 1
      return actual.plateEdgeGeometry(...args)
    },
  }
})

const { HOVER_GLOW, RoomSurface } = await import('./RoomSurface')
const { fixtureFiller, planTools, sceneOf } = await import('./fixture')
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
}

/** The surface, mounted over a scene, with every callback recording. */
function mount(scene: PlanScene, options: { readonly wired?: boolean; readonly tool?: 'place' | 'move' | 'erase' } = {}) {
  const state: Mounted = { opened: [], said: [], reached: [] }
  const onDown = (event: Event) => {
    state.reached.push((event as MouseEvent).button)
  }
  canvas.addEventListener('pointerdown', onDown)
  listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown)
  })

  const room = buildRoom3D(scene, {
    geometries: new Map(),
    resolve: (record) => resolveMaterial(CATALOG.tags(record), record.file),
    viewRadius: VIEW_RADIUS,
  })
  render(
    <RoomSurface
      announce={(text) => state.said.push(text)}
      armed={null}
      fill={fixtureFiller()}
      fit={FIT}
      geometries={new Map()}
      keyHelpId="of-keys"
      label="a room"
      {...(options.wired === false
        ? {}
        : {
            onEditSlots: (placement, slot) => state.opened.push({ placement, slot }),
          })}
      onStatus={() => undefined}
      room={room}
      scene={scene}
      tools={planTools({ tool: options.tool ?? 'place' })}
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
 * r3f's elements reach jsdom as unknown DOM tags, so a `<lineBasicMaterial>`'s
 * colour is a readable attribute. Every outline in the surface is one of these:
 * a plate's own contour, the ghost's fallback ring, the caret, and the glow.
 */
function lineColours(): string[] {
  return [...document.querySelectorAll('linebasicmaterial')].map((node) => node.getAttribute('color') ?? '')
}

/** How many outlines are drawn in `colour`. */
function ringsIn(colour: string): number {
  return lineColours().filter((value) => value === colour).length
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

describe('the right click opens the slot editor on the piece', () => {
  it('names the placement the pointer is on', () => {
    const scene = corner(-1)
    const state = mount(scene)
    rightClick()
    expect(state.opened).toHaveLength(1)
    expect(state.opened[0]?.placement).toBe(scene.pieces[0]?.id)
  })

  it('pre-selects the slot whose part was hit, and the part decides it', () => {
    // Same recipe, same gesture, two anchors — see `corner`. The floor covers the
    // picked point at `x = -1` and the wall covers it at `x = -1.75`, so a
    // gesture that resolved only to the placement would answer the same thing
    // twice and the user would have to find the row they just pointed at.
    const state = mount(corner(-1))
    rightClick()
    expect(state.opened[0]?.slot).toBe(FIXTURE_SLOTS.floor)
  })

  it('names the wall when the wall is what is under the pointer', () => {
    const state = mount(corner(-1.75))
    rightClick()
    expect(state.opened[0]?.slot).toBe(FIXTURE_SLOTS.rightWall)
  })

  it('announces which slot it opened, so the gesture is not silent', () => {
    const state = mount(corner(-1.75))
    rightClick()
    expect(state.said.join(' ')).toMatch(/The right wall slot of/)
  })

  /**
   * The pre-selection inherits `pickSurface`'s parallax correction, and this is
   * the disclosure rather than a bug.
   *
   * `heightOf` credits a piece with its **tallest** part's top — `surface.ts`
   * argues for that at length, and erase and move need it: a pointer over a
   * corner template must land on the wall standing on the floor or the click
   * falls through to whatever is behind the piece. One consequence reaches this
   * row: the point the slot is resolved at is the point on *that* plane, so a
   * click over the low part of a tall assembly can name the tall part.
   *
   * Here the ground point `(0, 0)` is inside the floor and outside the wall, and
   * the wall plane's own point `(0.592, 0.820)` is inside the wall — so the slot
   * named is `right wall`. That is the surface the user is looking at, and it is
   * the same answer erase would act on.
   *
   * **The size of the effect is bounded and it shrinks as the assembly gets
   * taller**, which is the part that makes it acceptable rather than merely
   * documented: the offset is `h / (tan 27.38° · 25.4)` units, so this fixture's
   * 13.3 mm wall shifts the point 1.011 units and a real 63.5 mm wall shifts it
   * **4.83 units** — well outside a 2 x 2 template, so the elevated plane is
   * rejected and the ground point is used. The pre-selection is therefore exact
   * on the shipped recipes and approximate only on low assemblies, where the
   * editor's slot list is one press away in any case.
   */
  it('resolves the slot at the plane the pick accepted, parallax and all', () => {
    const state = mount(corner(-1, -1))
    rightClick()
    expect(state.opened[0]?.slot).toBe(FIXTURE_SLOTS.rightWall)
  })
})

describe('the camera keeps the right button', () => {
  it('does not open on a right drag, which is how the plan is panned', () => {
    // The whole reason the seam is a `pointerup` and a 5 px test rather than a
    // `contextmenu` listener: `OrbitControls` binds the right button to
    // `MOUSE.PAN` and `Stage` passes `enablePan` for this surface, so every pan
    // gesture starts with a secondary press. Twenty pixels of travel is a pan.
    const state = mount(corner(-1))
    rightClick(20)
    expect(state.opened).toEqual([])
    expect(state.said).toEqual([])
  })

  it('opens at the threshold itself, so the two gestures share one number', () => {
    // Five, inclusive — `isClickGesture`'s own boundary, asserted here as well
    // as in `surface.test.ts` because this is where it decides a user-visible
    // outcome rather than a boolean.
    const state = mount(corner(-1))
    rightClick(5)
    expect(state.opened).toHaveLength(1)
  })

  it('never claims the press, so the event still reaches the controls', () => {
    /*
      `OrbitControls` listens on the canvas. The surface's own listener is
      capture-phase on the canvas's **parent**, so claiming a press —
      `stopPropagation` — stops it ever reaching the canvas at all. That is what
      a move-drag deliberately does, and it is what a right press must never do:
      claiming it would take the camera pan away from the right button.

      Asserted against the primary path rather than in isolation, because a test
      that only showed the secondary press arriving would pass on a surface whose
      capture listener had stopped working altogether.
    */
    const state = mount(corner(-1), { tool: 'move' })
    press('pointerdown', 2, [100, 100])
    expect(state.reached).toEqual([2])

    press('pointerdown', 0, [100, 100])
    expect(state.reached).toEqual([2])
  })
})

describe('the browser’s own menu', () => {
  it('is suppressed on the canvas, so it cannot cover the editor', () => {
    mount(corner(-1))
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvas.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('is left alone everywhere else, because nothing else claimed the gesture', () => {
    // Scoped to the canvas and not to the document: a user right-clicking the
    // bill, the slots panel or the page still gets their browser's menu.
    mount(corner(-1))
    const elsewhere = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(elsewhere)
    expect(elsewhere.defaultPrevented).toBe(false)
  })
})

describe('what a right click does when there is nothing to customise', () => {
  it('opens nothing over bare ground, and says so', () => {
    const state = mount(sceneOf(CATALOG, []))
    rightClick()
    expect(state.opened).toEqual([])
    expect(state.said.join(' ')).toMatch(/Nothing to customise at/)
  })

  it('opens nothing on a generated base, and says why', () => {
    const scene = buildPlanScene({}, CATALOG, STYLE, {
      [PlacementId.parse('g0')]: aGeneratedBase({ x: -1, z: -1 }),
    })
    const state = mount(scene)
    rightClick()
    expect(state.opened).toEqual([])
    expect(state.said.join(' ')).toMatch(/generated from parameters/)
  })

  it('does nothing at all when no handler is wired, not even an announcement', () => {
    // The prop is optional, so every caller that had one before row C8 keeps the
    // behaviour it had: the press is not even recorded.
    const state = mount(corner(-1), { wired: false })
    rightClick()
    expect(state.opened).toEqual([])
    expect(state.said).toEqual([])
  })
})

describe('the two presses stay apart', () => {
  it('ignores a secondary press while a piece is in the air', () => {
    // A chord mid-carry is not a request to open a dialog over the drag it would
    // interrupt. `move` mode claims the primary press and starts the drag.
    const state = mount(corner(-1), { tool: 'move' })
    press('pointerdown', 0, [100, 100])
    rightClick()
    expect(state.opened).toEqual([])
  })

  it('does not let a secondary release resolve a primary press', () => {
    /*
      **This is a defect row C8 found and fixed rather than one it introduced.**
      Before this row `onUp` read one press slot whatever button was released, so
      holding the primary button and right-clicking passed the 5 px test against
      the *primary* press and ran the place gesture. Nothing armed means nothing
      is placed either way, so the assertion is on the announcement: a resolved
      place gesture always says something, and this one must say nothing.
    */
    const state = mount(corner(-1))
    press('pointerdown', 0, [100, 100])
    press('pointerdown', 2, [100, 100])
    press('pointerup', 2, [100, 100])

    // The right click says its own sentence, which is the row's subject. What
    // must not be there is the *place* gesture's: nothing is armed, so a
    // resolved primary click announces "No template is armed".
    expect(state.said.filter((text) => /armed/.test(text))).toEqual([])
    expect(state.opened).toHaveLength(1)
  })
})

describe('the piece under the pointer glows', () => {
  it('rings every part of it, once each, in the hover colour', () => {
    // The two-part corner: `pieceAt` resolves the instance and the glow draws
    // one loop per part, at that part's own top. Not one loop for the piece —
    // `scene.ts` makes `piece.polygons` the flat map of its parts', so the loops
    // are the same set either way, and per part is what puts each at its own
    // elevation.
    mount(corner(-1))
    expect(ringsIn(HOVER_GLOW)).toBe(0)
    hover()
    expect(ringsIn(HOVER_GLOW)).toBe(2)
  })

  it('draws nothing at all over bare ground', () => {
    mount(sceneOf(CATALOG, []))
    hover()
    expect(ringsIn(HOVER_GLOW)).toBe(0)
  })

  it('rings a generated base too, which has one loop and no slots', () => {
    const scene = buildPlanScene({}, CATALOG, STYLE, {
      [PlacementId.parse('g0')]: aGeneratedBase({ x: -1, z: -1 }),
    })
    mount(scene)
    hover()
    expect(ringsIn(HOVER_GLOW)).toBe(1)
  })

  it('hands the loud ring to erase, where the click deletes what it names', () => {
    // One drawing at two strengths and not two drawings: the same loops, in the
    // accent, when the gesture the user is aiming is a removal.
    mount(corner(-1), { tool: 'erase' })
    hover()
    expect(ringsIn(HOVER_GLOW)).toBe(0)
    expect(ringsIn(color.acc)).toBe(2)
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

describe('the glow and the camera', () => {
  it('goes out while a button is held, because a held button is the camera', () => {
    // Left orbits and right pans, and both keep firing `pointermove`. A cue that
    // hopped from piece to piece while the view swung under a stationary hand
    // would be worse than no cue.
    mount(corner(-1))
    hover()
    expect(ringsIn(HOVER_GLOW)).toBe(2)
    // The primary button: an orbit.
    hover([100, 100], 1)
    expect(ringsIn(HOVER_GLOW)).toBe(0)
    // Let go and it is back, so the suppression is a state and not a latch.
    hover([100, 100], 0)
    expect(ringsIn(HOVER_GLOW)).toBe(2)
    // The secondary button: a pan, which row C8 corrected `OrbitControls` binds
    // to `MOUSE.PAN` — and which the surface deliberately never claims.
    hover([100, 100], 2)
    expect(ringsIn(HOVER_GLOW)).toBe(0)
  })

  it('comes back on the release, without waiting for the next move', () => {
    mount(corner(-1))
    hover([100, 100], 1)
    expect(ringsIn(HOVER_GLOW)).toBe(0)
    press('pointerup', 0, [100, 100])
    expect(ringsIn(HOVER_GLOW)).toBe(2)
  })

  it('survives a click, which is a press with no travel in it', () => {
    // The 5 px gesture: nothing moves, so nothing reports a held button, so the
    // piece the user just clicked stays named.
    mount(corner(-1))
    hover()
    press('pointerdown', 0, [100, 100])
    press('pointerup', 0, [100, 100])
    expect(ringsIn(HOVER_GLOW)).toBe(2)
  })
})

describe('what the glow costs', () => {
  it('builds an outline per hovered part, not per pointer move', () => {
    // The row's cost claim, and the only mechanism behind it: `pieceAt` returns
    // the scene's own object, so `under` keeps its identity while the pointer
    // stays on one piece and `PlateOutline`'s geometry memo survives the move.
    mount(corner(-1))
    outlineBuilds = 0
    hover([100, 100])
    expect(outlineBuilds).toBe(2)
    for (let i = 0; i < 20; i += 1) hover([100 + i, 100])
    expect(outlineBuilds).toBe(2)
  })

  it('asks for no more frames than the surface asked for before it', () => {
    // `onMove` already invalidated on every pointer move — for the ghost — so
    // the glow rides a redraw that was already being paid for.
    mount(corner(-1))
    hover()
    frames = 0
    for (let i = 0; i < 10; i += 1) hover([100 + i, 100])
    expect(frames).toBe(10)
  })
})

describe('the keyboard gets the same cue, and asked for a frame that never came', () => {
  it('rings the piece that ] steps to, with no pointer involved', () => {
    // The glow follows the *cursor*, which the arrow keys and `[` / `]` write, so
    // the piece a keyboard user is told about is the piece they can see ringed.
    mount(corner(-1))
    expect(ringsIn(HOVER_GLOW)).toBe(0)
    fireEvent.keyDown(canvas, { key: ']' })
    expect(ringsIn(HOVER_GLOW)).toBe(2)
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
