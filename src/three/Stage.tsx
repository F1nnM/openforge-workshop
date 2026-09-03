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
import { EffectComposer, EffectPass, RenderPass, SMAAEffect } from 'postprocessing'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
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
  className?: string
  /** Accessible label for the canvas element. */
  label: string
}

export function Stage({
  children,
  occlusion,
  aoRadius = AO_RADIUS,
  enablePan = false,
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
      <PostStack aoRadius={aoRadius} {...(occlusion === undefined ? {} : { occlusion })} />
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
 * What {@link useStageComposer} hands back: the composer, and the two knobs.
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
 */
export function useStageComposer(): StageComposer {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

  const ao = useRef<N8AOPostPass | null>(null)
  const colours = useRef(new Map<string, Color>())

  // Deliberately not keyed on `size`: the composer is resized below, and
  // rebuilding a two-pass AO chain on every drag of a drawer edge would
  // reallocate four render targets and recompile three programs.
  const composer = useMemo(() => {
    // HalfFloat targets: the AO pass multiplies into the beauty buffer, and an
    // 8-bit intermediate bands visibly in the shallow gradients that are most of
    // a stone tile's surface.
    const created = new EffectComposer(gl, { frameBufferType: HalfFloatType })
    created.addPass(new RenderPass(scene, camera))

    const initial = gl.getSize(new Vector2())
    const pass = new N8AOPostPass(scene, camera, initial.width, initial.height)
    pass.setQualityMode('Medium')
    pass.configuration.screenSpaceRadius = false
    pass.configuration.halfRes = false
    pass.configuration.distanceFalloff = 0.65
    pass.configuration.intensity = 2.6
    created.addPass(pass)
    ao.current = pass

    created.addPass(new EffectPass(camera, new SMAAEffect()))
    return created
  }, [gl, scene, camera])

  useEffect(() => {
    composer.setSize(size.width, size.height)
    invalidate()
  }, [composer, invalidate, size.width, size.height])

  // The composer owns render targets and compiled programs for every pass; r3f
  // knows nothing about it, so it is disposed explicitly. See index.ts's note on
  // what disposal does and does not cover.
  useEffect(
    () => () => {
      composer.dispose()
      ao.current = null
      colours.current.clear()
    },
    [composer],
  )

  return useMemo(
    () => ({
      composer,
      configure: (occlusion: string | undefined, aoRadius: number) => {
        const pass = ao.current
        if (pass === null) return
        const style = occlusion ?? '#000000'
        let colour = colours.current.get(style)
        if (colour === undefined) {
          colour = new Color().setStyle(style, 'srgb')
          colours.current.set(style, colour)
        }
        pass.configuration.aoRadius = aoRadius
        pass.configuration.color = colour
      },
    }),
    [composer],
  )
}

/**
 * The post stack for a single-subject canvas, driven from `useFrame` at
 * priority 1.
 *
 * Priority ≥ 1 makes r3f hand over the render loop instead of also calling
 * `gl.render` itself, which would draw the un-occluded beauty pass over the
 * composed frame every frame — a bug that looks like "the AO does nothing".
 */
function PostStack({ aoRadius, occlusion }: { aoRadius: number; occlusion?: string }) {
  const invalidate = useThree((state) => state.invalidate)
  const stage = useStageComposer()

  useEffect(() => {
    stage.configure(occlusion, aoRadius)
    invalidate()
  }, [stage, aoRadius, occlusion, invalidate])

  useFrame((_, delta) => {
    stage.composer.render(delta)
  }, 1)

  return null
}
