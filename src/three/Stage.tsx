/**
 * One renderer bootstrap, shared by every 3D surface the app grows.
 *
 * Right now that is one surface — the detail drawer's "View in 3D" — but the
 * reason this is a component and not three lines inside `Viewer.tsx` is §8's
 * roadmap: v1.1 puts a decimated-GLB `InstancedMesh` builder behind the same
 * renderer, lighting and AO decisions. Anything that is a *scene* decision lives
 * here; anything that is a *model* decision lives in `StlModel.tsx`.
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
 */
import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { N8AOPostPass } from 'n8ao'
import { EffectComposer, EffectPass, RenderPass, SMAAEffect } from 'postprocessing'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { Color, HalfFloatType, Vector2 } from 'three'

import { VIEW_RADIUS } from './geometry'

/**
 * Occlusion radius, in world units, against `VIEW_RADIUS = 1`.
 *
 * 0.09 of the model's own bounding radius. Below ~0.05 the creases between
 * dungeon-stone blocks stop reading at 288 px; above ~0.15 the AO stops being a
 * crease and becomes a general grubbiness that flattens the silhouette it is
 * there to define. Because `geometry.ts` normalises every model to the same
 * radius, this one number is correct for a 25 mm floor tile and a 300 mm boss
 * door alike.
 */
export const AO_RADIUS = 0.09 * VIEW_RADIUS

/** Camera distance for a unit-radius model at {@link CAMERA_FOV}. */
const CAMERA_FOV = 32

/**
 * Camera distance for a unit-radius model.
 *
 * Fitting the *bounding sphere* would need 3.49 at this field of view, and that
 * is over-conservative for this corpus: a tile is a plate, a wall or a column and
 * never a ball, so its silhouette always sits well inside its own sphere — at
 * 3.49 a 4×1 floor strip fills barely half the well. 3.0 frames a tall column
 * (the worst vertical case, ~0.82 of its sphere radius projected) with room to
 * spare and gives flat tiles a usefully larger silhouette; scroll-to-zoom covers
 * the rest.
 */
const CAMERA_DISTANCE = 3.0

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
   * crease palette-consistent.
   */
  occlusion?: string
  /** Override the AO radius. Only the dev harness does. */
  aoRadius?: number
  className?: string
  /** Accessible label for the canvas element. */
  label: string
}

export function Stage({ children, occlusion, aoRadius = AO_RADIUS, className, label }: StageProps) {
  return (
    <Canvas
      className={className}
      aria-label={label}
      // See the docblock: no tone-mapping curve in front of a measured palette.
      flat
      dpr={[1, 2]}
      frameloop="demand"
      gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}
      camera={{
        fov: CAMERA_FOV,
        near: 0.05,
        far: 40,
        position: [
          CAMERA_DISTANCE * 0.52,
          CAMERA_DISTANCE * 0.46,
          CAMERA_DISTANCE * 0.72,
        ],
      }}
    >
      <StageLights />
      {children}
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.9}
        zoomSpeed={0.7}
        minDistance={VIEW_RADIUS * 1.5}
        maxDistance={VIEW_RADIUS * 9}
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
 */
function StageLights() {
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
 * `RenderPass → N8AOPostPass → SMAA`, driven from `useFrame` at priority 1.
 *
 * Priority ≥ 1 makes r3f hand over the render loop instead of also calling
 * `gl.render` itself, which would draw the un-occluded beauty pass over the
 * composed frame every frame — a bug that looks like "the AO does nothing".
 *
 * MSAA is off on the context (`antialias: false`) because a post-processing
 * chain resolves through its own render targets, where the context's multisample
 * buffer does not apply; SMAA as the final pass is the equivalent that works,
 * and it is also the pass that converts to the output colour space.
 */
function PostStack({ aoRadius, occlusion }: { aoRadius: number; occlusion?: string }) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

  const ao = useRef<N8AOPostPass | null>(null)

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

  // Assigned, not mutated: `configuration` is a Proxy whose setter is what tells
  // the pass to discard its accumulated frame. `color.set(...)` in place would
  // change the colour and leave the old frame on screen.
  useEffect(() => {
    const pass = ao.current
    if (pass === null) return
    pass.configuration.aoRadius = aoRadius
    pass.configuration.color = new Color().setStyle(occlusion ?? '#000000', 'srgb')
    invalidate()
  }, [composer, aoRadius, occlusion, invalidate])

  // The composer owns render targets and compiled programs for every pass; r3f
  // knows nothing about it, so it is disposed explicitly. See index.ts's note on
  // what disposal does and does not cover.
  useEffect(
    () => () => {
      composer.dispose()
      ao.current = null
    },
    [composer],
  )

  useFrame((_, delta) => {
    composer.render(delta)
  }, 1)

  return null
}
