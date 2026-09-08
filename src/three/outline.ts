/**
 * What a silhouette pass is asked to outline, and the one mesh that asks it.
 *
 * This module is the *geometry* half of row **D7**'s hover cue. The pass itself
 * is `Stage.tsx`'s ({@link useStageComposer}); the surface that wants a piece
 * outlined is `builder/three/RoomSurface.tsx`. Neither can own this: the pass
 * knows nothing about a plan, and the surface must not reach into a composer.
 * So the two meet on a value — a list of {@link OutlineSubject} and a colour —
 * and this file is that value plus the four lines of three.js needed to put it
 * in front of the pass.
 *
 * ## Why a proxy mesh exists at all, and why it is not a second copy of the tile
 *
 * `postprocessing`'s `OutlineEffect` renders the **objects** in its `Selection`
 * into a mask and traces the mask's boundary. The builder draws its room as one
 * `InstancedMesh` per shared geometry (`builder/three/instances.ts` — its
 * docblock says so, and measured against the emitted index a room of 50
 * instances is as few as 20 meshes), and an `InstancedMesh` is *one* object. So
 * selecting the mesh the hovered tile is drawn by would outline **every
 * instance of that geometry in the room** — a corridor of twelve identical
 * walls would light up when the pointer touched one of them.
 *
 * The answer is one non-instanced {@link Mesh} per hovered part, sharing the
 * *same* `BufferGeometry` the instance is drawn from and carrying the *same*
 * matrix the instance was given. It is not a copy of the tile: it allocates no
 * vertex data ({@link OutlineSubject.geometry} is borrowed, and this module
 * never disposes one), and it draws no pixels — see {@link OUTLINE_MASK}.
 *
 * The alternative considered and rejected was `instanceColor`, which can tint
 * one instance of an `InstancedMesh` without a second object. It answers a
 * different question: a per-instance colour multiplies the tile's **fill**, and
 * row D3 measured that no colour in this design separates from all sixteen
 * material fills — a nine-point `--acc`→`--bg` sweep plus two `--acc`→`--ink`
 * mixes all landed between 1.00:1 and 1.16:1, because the families span L\* 18
 * to 82 by design. A cue that modulates the fill lands in exactly that band. The
 * silhouette does not, because it is drawn *outside* the fill.
 *
 * ## The subject's matrix is a **world** matrix, and that is deliberate
 *
 * `RoomSurface` draws in millimetres inside a `<group scale={fit.scale}>`, and
 * every matrix in `instances.ts` is a millimetre matrix for that reason. The
 * proxies are not in that group: they belong to whoever owns the pass, which is
 * `Stage`, and `Stage` knows one frame — the scene's. So the caller composes the
 * surface's own scale into the matrix it hands over, once, where the scale
 * lives. The alternative was to hand `Stage` a scale as well and have it
 * reconstruct the group, which is the same arithmetic in the place that has no
 * business knowing it.
 */
import { Mesh, MeshBasicMaterial } from 'three'
import type { BufferGeometry, Matrix4 } from 'three'

/** One thing to outline: a geometry, where it stands, and a stable name for it. */
export interface OutlineSubject {
  /**
   * Stable across renders while the same thing is being outlined.
   *
   * Not read by the pass — the pass takes objects. It is here so a caller can
   * memoise a subject list on identity and a reader of a diff can tell which
   * part of which placement a subject is.
   */
  readonly key: string
  /**
   * The geometry that is *actually drawn* for this part — borrowed, never
   * disposed here.
   *
   * The whole point of the row: a cue built from anything else is a drawing of
   * something that is not on screen, which is the defect D7 fixes. For a part
   * with a mesh this is the instanced geometry `useLodStore` holds; for a part
   * still waiting on one it is the footprint plate's own geometry, because a
   * plate is what is on screen.
   */
  readonly geometry: BufferGeometry
  /** The object's **world** matrix. See the module note on why it is world. */
  readonly matrix: Matrix4
}

/**
 * A whole cue: what to outline and in what colour.
 *
 * One object rather than two props, because the two change together — a request
 * is published by an effect and compared by identity, and a colour that arrived
 * a render apart from its subjects would draw the erase colour around the
 * hovered piece for one frame.
 */
export interface OutlineRequest {
  readonly subjects: readonly OutlineSubject[]
  /** An sRGB hex, as three cannot read a CSS custom property. */
  readonly colour: string
}

/**
 * Nothing outlined.
 *
 * The colour is unread when there are no subjects; it is a real hex rather than
 * `null` so that {@link OutlineRequest.colour} needs no optional branch in the
 * two places that set a uniform from it.
 *
 * **Not the same as no outline pass.** A `Stage` given this still builds the
 * pass and simply disables it; a `Stage` given no request at all never builds
 * one. `Stage.tsx`'s prop note carries why that distinction has to exist.
 */
export const NO_OUTLINE: OutlineRequest = { subjects: [], colour: '#000000' }

/**
 * The mask material: **it draws nothing**, and that is the entire trick.
 *
 * A proxy sits exactly where the tile it outlines is already drawn, so anything
 * it wrote would z-fight with that tile — coplanar duplicate geometry through
 * two different vertex paths (an instanced transform against a model matrix)
 * does not resolve to bit-identical depth, and the result is speckle. With
 * `colorWrite` and `depthWrite` both off it is a draw call that touches no
 * buffer: the beauty pass pays for the vertices and gets no pixels.
 *
 * The pass still sees it, because both of the passes that matter substitute
 * their own material through `scene.overrideMaterial` — `OutlineEffect`'s mask
 * pass uses a depth-comparison material and its occluder pass a depth material —
 * and an override replaces this one entirely. What it may **not** be is
 * `material.visible = false` or `mesh.visible = false`: three drops an invisible
 * object out of the render list before any override is considered, so the mask
 * would come back empty and the cue would silently not draw.
 *
 * One module constant, shared by every proxy on every canvas, and never
 * disposed — `RoomSurface`'s single module-scope `Raycaster` for the same
 * reason. A material per proxy would allocate on every pointer move onto a
 * piece and would compile nothing new.
 */
export const OUTLINE_MASK = new MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
})

/**
 * Edge alpha per unit of mask gradient: **2**.
 *
 * `OutlineEffect`'s edge detector reports the gradient of a 0/1 coverage mask
 * across two texels, so its peak is 0.5 and not 1.0, and the effect multiplies
 * that by this number to get the alpha it blends with. At 1 the outline is a
 * half-transparent hairline whatever colour it is given — which is the failure
 * D3's contrast table predicted for a hairline over a fill and is not worth
 * repeating. 2 puts the peak at exactly 1.0, so the cue is the colour the design
 * chose and no fraction of it; above 2 the alpha extrapolates past the colour
 * and the blend overshoots into a lighter fringe.
 */
export const OUTLINE_EDGE_STRENGTH = 2

/**
 * The render layer the pass isolates its subjects on: **10**.
 *
 * Pinned rather than left to `postprocessing`, and it is a determinism fix
 * rather than a preference. A `Selection`'s layer defaults to a **module-global
 * counter** starting at 2 (`Selection.js`'s `idManager`), so every canvas that
 * builds an outline pass gets a different layer than the last one, and the
 * thirty-first `Selection` in a page session is layer 32 — out of range, which
 * logs *"Layer out of range, resetting to 2"* and starts over. Mounting and
 * unmounting the 3D builder thirty times is an ordinary afternoon.
 *
 * Nothing in this app touches `Object3D.layers` at all — checked, not assumed —
 * so any value in `[1, 31]` is free, and 10 is the number `postprocessing`'s own
 * documentation advertises as the default. The consequence of pinning is that
 * every outlined canvas isolates its mask on the same layer, which is correct
 * because a canvas only ever masks its own scene.
 */
export const OUTLINE_LAYER = 10

/**
 * Width of the edge band, in **device-independent pixels**: about two.
 *
 * `OutlineEffect` has no thickness setting; the band's width falls out of the
 * resolution its edge pass runs at, and a half-resolution edge sampled at full
 * resolution is a soft two-pixel band — which is the shape the owner asked for
 * in the word *"glow"*.
 *
 * **Two pixels of what** is the part that bit.** `resolutionScale` is a fraction
 * of the *drawing buffer*, so 0.5 meant two device pixels, and two device pixels
 * is a different cue on every display. Raising {@link DPR_BAND}'s floor to 2 took
 * this from 1.8 CSS px to 1.0 and the outline came out looking like a hairline.
 * So the width is stated here in CSS pixels and {@link outlineResolutionScale}
 * converts, which is the same move `ScreenLine.tsx` makes for the lines the
 * renderer draws directly.
 */
export const OUTLINE_WIDTH_PX = 1.8

/**
 * {@link OUTLINE_WIDTH_PX} as the fraction of the drawing buffer the edge pass
 * should run at.
 *
 * The band is roughly `1 / scale` buffer pixels wide, and a buffer pixel is
 * `1 / dpr` CSS pixels, so `scale = 1 / (widthPx * dpr)`. Clamped to a sane band:
 * above 1 is meaningless (the pass cannot run finer than the buffer) and a very
 * small scale would make the occluder depth render so coarse that the
 * visible/hidden test gets blocky.
 *
 * It also keeps the pass cheap on a dense display for free, which is the reason
 * the half-resolution default existed in the first place: the occluder depth
 * render of the whole room is the one genuinely expensive thing here, and this
 * scales it *down* as the buffer grows.
 */
export function outlineResolutionScale(dpr: number): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  return Math.min(1, Math.max(0.1, 1 / (OUTLINE_WIDTH_PX * ratio)))
}

/**
 * One mask-only {@link Mesh} per subject, ready to add to a scene.
 *
 * `matrixAutoUpdate` off with the matrix copied in, which is `RoomSurface`'s
 * `Ghost` pattern: the subject's matrix is already the world matrix and there is
 * no position, quaternion or scale to decompose it into and recompose it from.
 * Proxies are added to the scene root, where `matrixWorld` is the matrix.
 *
 * Pure, so that a test can assert the flags and the placement without a GL
 * context.
 */
export function outlineProxies(subjects: readonly OutlineSubject[]): Mesh[] {
  return subjects.map((subject) => {
    const proxy = new Mesh(subject.geometry, OUTLINE_MASK)
    proxy.name = `outline:${subject.key}`
    proxy.matrixAutoUpdate = false
    proxy.matrix.copy(subject.matrix)
    proxy.matrixWorldNeedsUpdate = true
    return proxy
  })
}
