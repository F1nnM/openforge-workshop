/**
 * One renderer bootstrap, shared by every 3D surface the app grows.
 *
 * Two surfaces use it today: the detail drawer's "View in 3D" and — through
 * `BuilderRoom.tsx` — the instanced 3D builder. A third shape, **a grid of live
 * previews**, cannot be this component and is `SharedStage.tsx`; see the section
 * below. Anything that is a *scene* decision lives here; anything that is a
 * *model* decision lives in `StlModel.tsx`.
 *
 * ## What is deliberate in the renderer setup
 *
 * - **`flat` (no tone mapping).** r3f defaults to ACES filmic, and ACES is a
 *   contrast curve: it would compress the exact lightness band §9's palette was
 *   solved in. Those tints are the output of a constrained annealing that
 *   maximised the minimum CIEDE2000 separation across 120 pairs under normal
 *   vision and three dichromacies simultaneously — the measured minimum is 9.211
 *   ΔE00 — and putting a filmic S-curve in front of it quietly reduces that
 *   number to something nobody has measured. sRGB output, no curve.
 * - **A transparent drawing buffer.** The well behind the canvas is the drawer's
 *   own `radial-gradient(ellipse at 50% 42%, var(--bg3), var(--bg))`, which is
 *   the same ground the sprite rotator sits on. Clearing to an opaque colour here
 *   would mean maintaining a second copy of the parchment palette in JavaScript
 *   and having it drift.
 * - **`dpr={[1, 2]}`.** Uncapped device pixel ratio on a 3× phone triples the
 *   fragment cost of the AO pass for detail nobody can see at 288 px.
 * - **`frameloop="demand"`.** A tile preview is static until someone drags it.
 *   Rendering 60 fps of an unchanging mesh with a two-pass AO stack is a real
 *   battery cost for nothing; drei's `OrbitControls` invalidates on change, and
 *   the load path invalidates when geometry arrives.
 *
 * ## The AO pass is doing the palette's job
 *
 * §9 measured that silhouette cannot be carried by fills: meeting WCAG 1.4.11's
 * 3:1 against the parchment well with fill colour alone would force every family
 * below L\* 50 and destroy plaster, sandstone and ice. In 2D the answer is a
 * separate contour per family. In 3D there is no stroke, so **N8AO is the
 * contour** — it is what stops a sandstone or ice tile dissolving into a light
 * ground, and it is why an AO pass is in v1 at all rather than being the polish
 * item it looks like. The occlusion colour is the family's own measured `edge`
 * (`material.ts`), so the crease is the same dark chroma the plan-view outline
 * would have been.
 *
 * Tuned against the real archive at the median (10.36 MB, 207 k triangles) and
 * p95 (32.89 MB, 658 k triangles) file sizes, on the normalised unit radius
 * `geometry.ts` guarantees — which is the whole reason it guarantees one.
 *
 * ## One occlusion colour per rendered frame, and that is N8AO's constraint
 *
 * Recorded here so nobody tries to improve it. {@link StageProps.occlusion} is
 * one string because **a screen-space occlusion pass has one colour uniform**,
 * not because this component declined to take a list. A room of eight material
 * families drawn in one frame therefore gets one crease colour, and
 * `BuilderRoom.tsx` passes the dominant family's `edge` by instance count, which
 * colours the most creases correctly. Nothing about that is fixable at this
 * layer: it would take an occlusion pass per family and a composite, which is
 * eight AO passes over the same depth buffer.
 *
 * The one case where it does *not* bind is `SharedStage.tsx`, and only because
 * the constraint is per frame rather than per canvas: subjects there are rendered
 * one after another, so each gets its own colour written into the same uniform
 * between renders. That is a different situation, not a better answer to this
 * one.
 *
 * ## Row D7: one stroke is back, and it is a *selection* device, not a contour
 *
 * The section above states a visual direction — in 3D there is no stroke, so the
 * AO pass is the contour — and an outline pass is a change to that direction
 * rather than an implementation detail. So the reconciliation is written down
 * rather than assumed. The two do not answer the same question:
 *
 * - **N8AO is a permanent, family-neutral separation.** Every tile has to come
 *   off the parchment ground and off its neighbours, all sixteen families at
 *   once, in every frame. Hence one pass with one colour uniform, and the note
 *   above is why one colour is all a screen-space pass can have.
 * - **A hover cue is a transient, single-subject identity** — *which one of these
 *   will the click act on*. One object, in a named colour, gone the moment the
 *   pointer leaves.
 *
 * The rule underneath both is `architecture-plan.md` §9's, and it is worth
 * quoting because it is the *binding* text where the paragraph above is this
 * file's gloss on it: **"silhouette is carried by a contour, not the fill"**.
 * A contour is exactly what the outline pass draws. What §9 forbids is a cue
 * that leans on the fill — which is what an `instanceColor` highlight would have
 * been, and `outline.ts` carries that argument with D3's numbers.
 *
 * An occlusion pass is structurally unable to be the second thing: its colour is
 * per frame, so it cannot say *"this one"*. And the choice was in fact taken
 * before this row — row D3 shipped the cue as `lineSegments` at full accent for
 * erase, so a stroke was already on the drawing. What D7 changes is not whether
 * there is a stroke but **what shape it traces**: D3 traced the tagged footprint
 * lifted to the part's top height, which on a wall is a horizontal rectangle
 * hovering over the mesh. This traces the silhouette of the geometry that is
 * actually on screen.
 *
 * It is **opt-in per canvas** ({@link StageProps.outline}) and the tile viewer
 * does not opt in, so the stack behind the drawer's "View in 3D" and behind every
 * card in `SharedStage.tsx` is unchanged — the same three passes over the same
 * render targets. The stated direction still holds everywhere it was stated
 * about.
 *
 * ## One subject here, many in `SharedStage.tsx`
 *
 * This component renders its own `<Canvas>`, so N of it is N live WebGL
 * contexts — and browsers cap those (~16 in Chrome) and drop the *oldest*, which
 * is why `index.ts` warns that a grid of live previews needs one shared canvas
 * rather than one per card. Row **G3** is that shared canvas, and it is a
 * separate component (`SharedStage.tsx`) rather than a mode of this one, because
 * a host of many subjects has a different render loop: it paints subjects
 * sequentially and copies each frame out, where this one renders the scene once
 * per invalidation.
 *
 * What the two share is *every renderer decision*, by import rather than by
 * copy: the canvas flags ({@link STAGE_GL}, `frame.ts`'s `DPR_BAND`), the camera
 * ({@link STAGE_CAMERA}), the orbit band (`frame.ts`'s `ORBIT_MIN_DISTANCE` …
 * `ORBIT_MAX_DISTANCE`), the lights ({@link StageLights}) and the whole
 * post stack ({@link useStageComposer}). A tuning change made in this file
 * therefore lands in both surfaces, which is the property that made a second
 * renderer the wrong answer in the first place.
 */
import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { N8AOPostPass } from 'n8ao'
import { BlendFunction, EffectComposer, EffectPass, OutlineEffect, RenderPass, SMAAEffect } from 'postprocessing'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import type { Camera, Object3D, Scene } from 'three'
import { Color, HalfFloatType, Vector2 } from 'three'

import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_POSITION,
  DPR_BAND,
  ORBIT_MAX_DISTANCE,
  ORBIT_MIN_DISTANCE,
  ORBIT_ROTATE_SPEED,
  VIEW_RADIUS,
} from './frame'
import type { OutlineRequest } from './outline'
import { OUTLINE_EDGE_STRENGTH, OUTLINE_LAYER, OUTLINE_RESOLUTION_SCALE, outlineProxies } from './outline'

/**
 * Occlusion radius, in world units, against `VIEW_RADIUS = 1`.
 *
 * 0.09 of the model's own bounding radius. Below ~0.05 the creases between
 * dungeon-stone blocks stop reading at 288 px; above ~0.15 the AO stops being a
 * crease and becomes a general grubbiness that flattens the silhouette it is
 * there to define. Because `geometry.ts` normalises every model to the same
 * radius, this one number is correct for a 25 mm floor tile and a 300 mm boss
 * door alike.
 *
 * A room of instances is not normalised that way, so `BuilderRoom.tsx` converts
 * this ratio into a physical length (`AO_RADIUS_MM`, 4.612 mm) and scales it by
 * the room's own fit. That calibration is expressed *in terms of this constant*,
 * so it follows a change here rather than going stale.
 */
export const AO_RADIUS = 0.09 * VIEW_RADIUS

/*
   Why the camera sits at `frame.ts`'s `CAMERA_DISTANCE` = 3.0.

   Fitting the *bounding sphere* would need 3.49 at this field of view, and that
   is over-conservative for this corpus: a tile is a plate, a wall or a column and
   never a ball, so its silhouette always sits well inside its own sphere — at
   3.49 a 4×1 floor strip fills barely half the well. 3.0 frames a tall column
   (the worst vertical case, ~0.82 of its sphere radius projected) with room to
   spare and gives flat tiles a usefully larger silhouette; scroll-to-zoom covers
   the rest.

   The number itself, the field of view, the near and far planes, the start
   position, the orbit band and the dpr cap all live in `frame.ts`, which imports
   no renderer — `subjects.ts` and the shared canvas's slot component need them
   and must not pull three.js to get them. The reasoning stays here.
*/

/** Context flags. `alpha` is the transparent buffer; MSAA is off because SMAA is on. */
export const STAGE_GL = {
  alpha: true,
  antialias: false,
  powerPreference: 'high-performance',
} as const

/** The camera, as `<Canvas camera={…}>` wants it. One object, so identity is stable. */
export const STAGE_CAMERA = {
  fov: CAMERA_FOV,
  near: CAMERA_NEAR,
  far: CAMERA_FAR,
  position: CAMERA_POSITION as [number, number, number],
}

export interface StageProps {
  children: ReactNode
  /**
   * Occlusion colour — the material family's measured `edge`, as an sRGB hex.
   *
   * A string rather than a `three.Color` so the value is stable across renders:
   * a freshly constructed `Color` would be a new identity every time and would
   * tear down the composer with it.
   *
   * Defaults to N8AO's black; passing the family's contour is what makes the
   * crease palette-consistent. One colour, for the reason in the docblock.
   */
  occlusion?: string
  /** Override the AO radius. Only the dev harness does. */
  aoRadius?: number
  /**
   * Let the drag translate the orbit target as well as rotate it. Default `false`.
   *
   * Right for one model and wrong for a room. A tile is centred and fills the
   * frame, so panning it can only push it out of view — but the builder's room is
   * a floor plan up to two metres across, and without a pan you can orbit and
   * zoom it and still not walk across it. The prop exists because
   * `BuilderRoom.tsx` asked for it and had no way to ask any other way; the
   * default keeps the detail viewer exactly as it was.
   */
  enablePan?: boolean
  /**
   * The silhouette cue — row **D7**, and the one prop that changes the pass stack.
   *
   * **Presence opts this canvas into the outline pass; absence leaves the stack
   * exactly as it was.** That is a distinction between `undefined` and
   * {@link NO_OUTLINE} rather than a redundancy, and it is load-bearing in both
   * directions:
   *
   * - The tile viewer and every card in `SharedStage.tsx` pass nothing, so no
   *   `OutlineEffect` is constructed, no mask or edge render target is allocated
   *   and no fourth pass runs. Their frames are byte-identical to before D7.
   * - The builder passes a request on **every** render, empty when nothing is
   *   hovered. If it passed `undefined` instead, the composer's identity would
   *   change on every hover and a two-pass AO chain would be torn down and
   *   rebuilt — four render targets and three programs — twice per pointer
   *   crossing. An empty request disables the pass instead, which costs nothing
   *   and keeps the composer.
   *
   * A canvas that opts in and then stops (or the reverse) rebuilds the composer,
   * deliberately: it is a change to the pass stack and not to a uniform.
   */
  outline?: OutlineRequest
  className?: string
  /** Accessible label for the canvas element. */
  label: string
}

export function Stage({
  children,
  occlusion,
  aoRadius = AO_RADIUS,
  enablePan = false,
  outline,
  className,
  label,
}: StageProps) {
  return (
    <Canvas
      className={className}
      aria-label={label}
      // See the docblock: no tone-mapping curve in front of a measured palette.
      flat
      dpr={DPR_BAND as [number, number]}
      frameloop="demand"
      gl={STAGE_GL}
      camera={STAGE_CAMERA}
    >
      <StageLights />
      {children}
      <OrbitControls
        makeDefault
        enablePan={enablePan}
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={ORBIT_ROTATE_SPEED}
        zoomSpeed={0.7}
        minDistance={ORBIT_MIN_DISTANCE}
        maxDistance={ORBIT_MAX_DISTANCE}
      />
      <PostStack
        aoRadius={aoRadius}
        {...(occlusion === undefined ? {} : { occlusion })}
        {...(outline === undefined ? {} : { outline })}
      />
    </Canvas>
  )
}

/**
 * Three lights and no shadow map.
 *
 * A shadow map on a single centred model buys a contact shadow that there is no
 * ground plane to receive, at the cost of a second depth render of 658 k
 * triangles at p95. AO supplies the contact darkening instead. The hemisphere
 * light's ground term is warm because the parchment well *is* warm and a neutral
 * bounce reads as a colour error against it.
 *
 * Exported because `SharedStage.tsx` mounts the same three lights over every
 * subject it hosts. They are direction-based and every subject is normalised to
 * the same unit radius at the origin, so one set lights all of them identically —
 * which is also what makes a shared canvas honest: a card and the drawer show the
 * same tile under the same light.
 */
export function StageLights() {
  return (
    <>
      <hemisphereLight args={['#fffaf0', '#c8b48c', 1.15]} />
      <directionalLight position={[2.6, 4.2, 3.1]} intensity={2.1} />
      {/* Fill from behind-left, so the far silhouette edge does not go to black
          on a dark family (metal, cave) against a light ground. */}
      <directionalLight position={[-3.2, 1.4, -2.4]} intensity={0.55} />
    </>
  )
}

/**
 * What {@link useStageComposer} hands back: the composer, and the three knobs.
 */
export interface StageComposer {
  readonly composer: EffectComposer
  /**
   * Point the AO pass at a colour and a radius, for the *next* render.
   *
   * Assigned rather than mutated: `configuration` is a Proxy whose setter is what
   * tells the pass to discard its accumulated frame. `color.set(…)` in place would
   * change the colour and leave the old frame on screen.
   *
   * Cheap enough to call between subjects on one frame — n8ao's proxy compares
   * the new value with the old and only touches a uniform when it differs, and
   * reconfiguration is reserved for the keys that change the shader (`aoSamples`,
   * `halfRes`, `denoiseSamples`). Colours are cached by string, so a repeat call
   * with the same colour allocates nothing at all.
   */
  readonly configure: (occlusion: string | undefined, aoRadius: number) => void
  /**
   * Outline exactly these objects, in this colour — or `null` when this stack
   * was built without an outline pass.
   *
   * `null` rather than a no-op function, so a caller that asks a stack it did
   * not opt in to for a silhouette fails to compile rather than silently drawing
   * nothing. An empty list disables the pass; see {@link StageProps.outline}.
   *
   * The objects must be in the scene and must be the caller's to keep alive: the
   * pass reads them on the frames between this call and the next one. It also
   * writes to their `layers` — `postprocessing`'s `Selection` is a render layer
   * — which is why the objects handed over are proxies built for the purpose
   * (`outline.ts`) rather than the room's own instanced meshes.
   */
  readonly outline: ((objects: readonly Object3D[], colour: string) => void) | null
}

/** What {@link useStageComposer} takes. One flag, and it changes the pass list. */
export interface StageComposerOptions {
  /**
   * Build the outline pass. Default `false`.
   *
   * A boolean and not the request itself, because it is keyed into the memo that
   * builds the composer: a value that changed per hover would rebuild the whole
   * chain. `Stage` derives it from the *presence* of
   * {@link StageProps.outline} for exactly that reason.
   */
  readonly outline?: boolean
}

/**
 * `RenderPass → N8AOPostPass → SMAA`, built once per `<Canvas>`.
 *
 * MSAA is off on the context (`antialias: false`) because a post-processing
 * chain resolves through its own render targets, where the context's multisample
 * buffer does not apply; SMAA as the final pass is the equivalent that works,
 * and it is also the pass that converts to the output colour space.
 *
 * Who drives it is the caller's business, and that is the whole reason this is a
 * hook: {@link Stage} renders the scene once per invalidation, and
 * `SharedStage.tsx` renders it once per subject per frame. Both get the same
 * passes, the same quality mode and the same target format.
 *
 * ## With {@link StageComposerOptions.outline}, a fourth pass — row D7
 *
 * `RenderPass → N8AO → **outline** → SMAA`, and both halves of that position
 * are chosen. It is **after N8AO** because the outline is a cue and not a
 * surface: an occlusion pass multiplying into it would darken it wherever the
 * silhouette runs through a crease, which is precisely the boundary the cue is
 * drawn on. It is **before SMAA** so the edge is antialiased with everything
 * else rather than left as the one aliased thing in the frame.
 *
 * A separate `EffectPass` rather than a second effect merged into the SMAA pass,
 * and that is not a taste: `SMAAEffect` declares `EffectAttribute.CONVOLUTION`,
 * and `postprocessing` refuses to merge a convolution effect with any other. So
 * the outline costs one more fullscreen quad, and only while something is
 * outlined — the pass is disabled by {@link StageComposer.outline} when the
 * selection is empty, which is a `continue` in the composer's loop.
 */
export function useStageComposer({ outline = false }: StageComposerOptions = {}): StageComposer {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

  const colours = useRef(new Map<string, Color>())

  // Deliberately not keyed on `size`: the composer is resized below, and
  // rebuilding a two-pass AO chain on every drag of a drawer edge would
  // reallocate four render targets and recompile three programs.
  const stack = useMemo<StageStack>(() => {
    // HalfFloat targets: the AO pass multiplies into the beauty buffer, and an
    // 8-bit intermediate bands visibly in the shallow gradients that are most of
    // a stone tile's surface.
    const created = new EffectComposer(gl, { frameBufferType: HalfFloatType })
    created.addPass(new RenderPass(scene, camera))

    const initial = gl.getSize(new Vector2())
    const ao = new N8AOPostPass(scene, camera, initial.width, initial.height)
    ao.setQualityMode('Medium')
    ao.configuration.screenSpaceRadius = false
    ao.configuration.halfRes = false
    ao.configuration.distanceFalloff = 0.65
    ao.configuration.intensity = 2.6
    created.addPass(ao)

    const silhouette = outline ? addOutlinePass(created, scene, camera) : null

    created.addPass(new EffectPass(camera, new SMAAEffect()))
    return { composer: created, ao, silhouette }
  }, [gl, scene, camera, outline])

  useEffect(() => {
    stack.composer.setSize(size.width, size.height)
    invalidate()
  }, [stack, invalidate, size.width, size.height])

  // The composer owns render targets and compiled programs for every pass; r3f
  // knows nothing about it, so it is disposed explicitly. See index.ts's note on
  // what disposal does and does not cover.
  useEffect(
    () => () => {
      stack.composer.dispose()
      colours.current.clear()
    },
    [stack],
  )

  return useMemo(() => {
    /** One `Color` per hex, for the life of the canvas. Both uniforms share it. */
    const linear = (style: string): Color => {
      let colour = colours.current.get(style)
      if (colour === undefined) {
        colour = new Color().setStyle(style, 'srgb')
        colours.current.set(style, colour)
      }
      return colour
    }
    const silhouette = stack.silhouette

    return {
      composer: stack.composer,
      configure: (occlusion: string | undefined, aoRadius: number) => {
        stack.ao.configuration.aoRadius = aoRadius
        stack.ao.configuration.color = linear(occlusion ?? '#000000')
      },
      outline:
        silhouette === null
          ? null
          : (objects: readonly Object3D[], colour: string) => {
              silhouette.effect.selection.set(objects)
              // Both edges the same colour, and that is a *correctness* choice
              // rather than a simplification — see `addOutlinePass`.
              const value = linear(colour)
              silhouette.effect.visibleEdgeColor = value
              silhouette.effect.hiddenEdgeColor = value
              // Nothing selected is not a cue drawn in nothing: it is a pass that
              // does not run. The composer skips a disabled pass entirely, so a
              // canvas with nothing hovered pays no fullscreen quad and no
              // occluder depth render.
              silhouette.pass.enabled = objects.length > 0
            },
    }
  }, [stack])
}

/**
 * The composer and the two passes whose knobs are turned later.
 *
 * **One memo value rather than a composer plus two refs, and it is a bug fix
 * rather than tidying.** `StrictMode` double-invokes a `useMemo` factory in
 * development, so a factory that *both* returns the composer and writes its
 * passes into refs runs twice and leaves the refs pointing at the **second**
 * composer while React keeps the **first** — the one that renders. Every knob
 * then turns on a pass that is not in the rendered chain, silently.
 *
 * Row D7 hit it head-on (the outline pass was enabled on the discarded composer,
 * so the hover cue rendered nothing at all, with no error anywhere) and then
 * measured that it had **already been true of the AO pass** since the pass stack
 * was written. In the builder, in a dev browser: `configure` had written the
 * dominant family's edge `#3e3d39` and the calibrated radius 0.0214, while the
 * N8AO pass actually rendering still held n8ao's defaults — **`#000000` and
 * radius 5**. So the section above about the occlusion colour being the family's
 * own measured `edge` was not true of any development frame, and every visual
 * judgement made in `npm run dev` was made against untuned AO. Production has no
 * double-invoke, so the shipped build was correct; nothing was wrong with the
 * *values*, only with which object received them.
 *
 * Returning the passes makes the mismatch unrepresentable: whichever composer
 * React keeps, its passes come with it.
 *
 * What this does **not** fix is that the discarded composer is never disposed —
 * one composer with four render targets and three programs is leaked per canvas
 * mount, in development only. The real fix for that is to create the composer in
 * an effect rather than a memo, which makes `composer` nullable for a frame and
 * changes this hook's contract for `SharedStage.tsx` as well; it is a bigger
 * change than this row should make to a shared file, and it is written down here
 * rather than left to be rediscovered.
 */
interface StageStack {
  readonly composer: EffectComposer
  readonly ao: N8AOPostPass
  /** `null` unless {@link StageComposerOptions.outline} asked for the pass. */
  readonly silhouette: OutlinePass | null
}

/** The outline pass and the effect inside it — see {@link addOutlinePass}. */
interface OutlinePass {
  readonly pass: EffectPass
  readonly effect: OutlineEffect
}

/**
 * Add the silhouette pass, tuned for a light ground and a duplicated subject.
 *
 * Four settings, and each one is a decision this row had to take:
 *
 * - **`BlendFunction.ALPHA`, not the default `SCREEN`.** Screen blending
 *   brightens, and on the parchment ground it turns any mid-tone outline into
 *   near-white — it is the right default for a dark scene and the wrong one
 *   here. `ALPHA` composites the colour the design chose, which is what makes
 *   D3's contrast table still describe the cue: 2.39:1 for the hover glow
 *   against `--bg` and 4.19:1 for the accent the erase gesture uses.
 *
 *   Its one cost, recorded so nobody chases it: `ALPHA` is
 *   `mix(dst, src, src.a)` over the **whole** `vec4`, so it mixes alpha as well
 *   as colour. Against this canvas's transparent buffer that squares the edge's
 *   alpha (`a² ` where `dst.a` is 0) and against an opaque tile it dips the
 *   frame's alpha to `1 - a + a²` in the shoulder of the band, letting a few
 *   percent of the parchment well through an edge pixel. Both are why
 *   {@link OUTLINE_EDGE_STRENGTH} puts the *peak* at exactly 1.0: at the peak
 *   neither happens, and the falloff either side is an antialiased edge either
 *   way.
 * - **`xRay: true`, with the hidden edge the same colour as the visible one.**
 *   Two reasons, both load-bearing. The pick is plan containment
 *   (`pieceAt`) and not a mesh raycast, so the piece the click will act on can
 *   legitimately be *behind* another piece; with hidden edges off, that piece
 *   would get no cue at all, which is D3's defect in a new costume. And the
 *   visible/hidden test compares the proxy's depth against a room that still
 *   contains the tile the proxy duplicates — equal depths to within float noise
 *   — so the classification of a silhouette's own pixels is noise. One colour
 *   makes that noise invisible instead of a speckled two-tone edge.
 * - **`blur: false`.** {@link OUTLINE_RESOLUTION_SCALE} already softens the edge
 *   to about two pixels; a Kawase blur on top is two more half-resolution passes
 *   to spread a cue that is meant to be *"slightly"* there.
 */
function addOutlinePass(composer: EffectComposer, scene: Scene, camera: Camera): OutlinePass {
  const effect = new OutlineEffect(scene, camera, {
    blendFunction: BlendFunction.ALPHA,
    edgeStrength: OUTLINE_EDGE_STRENGTH,
    resolutionScale: OUTLINE_RESOLUTION_SCALE,
    xRay: true,
    blur: false,
  })
  // See `OUTLINE_LAYER`: the default is a module-global counter, so this is what
  // keeps the mask on the same layer on the thirty-first mount as on the first.
  effect.selection.layer = OUTLINE_LAYER
  const pass = new EffectPass(camera, effect)
  // Nothing is hovered at mount. The pass is enabled by the first request.
  pass.enabled = false
  composer.addPass(pass)
  return { pass, effect }
}

/**
 * The post stack for a single-subject canvas, driven from `useFrame` at
 * priority 1.
 *
 * Priority ≥ 1 makes r3f hand over the render loop instead of also calling
 * `gl.render` itself, which would draw the un-occluded beauty pass over the
 * composed frame every frame — a bug that looks like "the AO does nothing".
 */
function PostStack({
  aoRadius,
  occlusion,
  outline,
}: {
  aoRadius: number
  occlusion?: string
  outline?: OutlineRequest
}) {
  const invalidate = useThree((state) => state.invalidate)
  // Presence, not identity: see `StageProps.outline`. `outline !== undefined` is
  // constant for the life of a canvas in both callers, so the composer is built
  // once whatever the pointer does.
  const stage = useStageComposer({ outline: outline !== undefined })

  useEffect(() => {
    stage.configure(occlusion, aoRadius)
    invalidate()
  }, [stage, aoRadius, occlusion, invalidate])

  useFrame((_, delta) => {
    stage.composer.render(delta)
  }, 1)

  if (outline === undefined || stage.outline === null) return null
  return <OutlineSubjects request={outline} select={stage.outline} />
}

/**
 * The proxy meshes the silhouette pass selects, mounted and unmounted with the
 * request.
 *
 * Imperative rather than JSX, and the reason is that r3f's tree buys nothing
 * here: these objects take no pointer events, cast no shadow, draw no pixel and
 * live exactly as long as one hover. What the pass needs is the `Object3D`s
 * themselves, which through JSX would mean collecting N refs and re-rendering
 * for each — for a mesh whose whole purpose is to be listed in a `Selection`.
 *
 * `outline.ts` owns what a proxy *is*; this owns when it exists. The geometries
 * belong to the caller (`useLodStore`'s objects, or the surface's own plate
 * geometry), so nothing here disposes one — and the shared mask material is a
 * module constant, so there is nothing else to release either. Removal from the
 * scene is the whole cleanup.
 */
function OutlineSubjects({
  request,
  select,
}: {
  request: OutlineRequest
  select: (objects: readonly Object3D[], colour: string) => void
}) {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const proxies = outlineProxies(request.subjects)
    for (const proxy of proxies) scene.add(proxy)
    select(proxies, request.colour)
    // `frameloop="demand"`: a cue nobody asked a frame for does not appear, and
    // one nobody asked a frame to remove does not go away.
    invalidate()
    return () => {
      select([], request.colour)
      for (const proxy of proxies) scene.remove(proxy)
      invalidate()
    }
  }, [request, select, scene, invalidate])

  return null
}
