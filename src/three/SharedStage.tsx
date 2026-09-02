/**
 * One `<Canvas>`, one WebGL context, N subjects — row **G3**.
 *
 * ```tsx
 * const pool = useMemo(() => createSubjectPool(), [])
 * // in the grid, once:
 * <SharedStage pool={pool} />
 * // in each card:
 * <SharedPreview pool={pool} id={record.id} label={…}>{…}</SharedPreview>
 * ```
 *
 * ## What this module actually is
 *
 * Almost nothing. Every decision it makes about *which* subject to paint, in
 * what order, at what size and where the frame goes lives in `subjects.ts`,
 * which imports no renderer and is therefore the only part of a shared canvas
 * that CI can check. Every decision about *how* a frame is rendered — the tone
 * mapping, the transparent buffer, the dpr cap, the lights, the
 * `RenderPass → N8AO → SMAA` stack, the camera — comes from `Stage.tsx` by
 * import. What is left here is the loop that puts the two together, and the two
 * imperative facts it needs a live renderer for:
 *
 *  1. **Exactly one subject is visible per render.** Subjects are all normalised
 *     to the same unit sphere at the origin (`geometry.ts` for a mesh,
 *     `place.ts` for a room), so they sit on top of each other and visibility is
 *     what separates them. Set on the `Object3D`, deliberately not through a
 *     React prop: it changes up to four times per frame and re-rendering the
 *     tree for it would be absurd.
 *  2. **The camera is moved, not swapped**, and the frame is copied out inside
 *     the same animation-frame callback as the render. Both live in
 *     `painter.ts`, which is written against structural types precisely so those
 *     two decisions can be tested — including the `postprocessing` trap that
 *     makes N cameras the wrong shape.
 *
 * ## One occlusion colour per *render*, which is not per canvas
 *
 * `Stage.tsx` records why a room of eight families gets one crease colour: a
 * screen-space AO pass has one colour uniform. Here the subjects are rendered
 * one after another, so each gets its own — the uniform is rewritten between
 * renders, and n8ao's configuration proxy compares before it assigns, so an
 * unchanged colour costs nothing. That is not a fix for the room's constraint;
 * it is a different situation, and the room's constraint stands.
 *
 * ## What is not here
 *
 * **No `OrbitControls`.** drei's control binds to `gl.domElement`, and this
 * canvas is off-screen — the pointer is on the slot canvases, which is where
 * `SharedPreview.tsx` handles the drag, against `subjects.ts`'s transcription of
 * the same rotation mapping.
 *
 * **No size gate and no loader.** A subject arrives as a scene subtree that its
 * card already built; whether that came from an STL through `useStlModel` or from
 * a `/lod/` GLB is the card's business.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { RefObject } from 'react'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Group } from 'three'
import { Vector2 } from 'three'

import { DPR_BAND } from './frame'
import { createSubjectPainter } from './painter'
import { AO_RADIUS, STAGE_CAMERA, STAGE_GL, StageLights, useStageComposer } from './Stage'
import type { PooledSubject, SubjectId, SubjectPool } from './subjects'
import { poolSlotSize } from './subjects'

import './shared.css'

export interface SharedStageProps {
  readonly pool: SubjectPool
  /**
   * Override the AO radius. One value for the pool, not one per subject: every
   * subject is normalised to the same unit radius, so `Stage`'s own tuned number
   * is as correct for a card as it is for the drawer.
   */
  readonly aoRadius?: number
}

/** A subject's scene subtree, mounted once and shown one at a time. */
type GroupMap = RefObject<Map<SubjectId, Group>>

export function SharedStage({ pool, aoRadius = AO_RADIUS }: SharedStageProps) {
  const subjects = useSyncExternalStore(pool.subscribe, pool.subjects, pool.subjects)
  const slot = poolSlotSize(subjects)
  const groups = useRef(new Map<SubjectId, Group>())

  return (
    <div
      className="of-3d-host"
      style={{ width: `${String(slot.width)}px`, height: `${String(slot.height)}px` }}
      // Every frame this canvas draws is presented in a labelled slot elsewhere;
      // announcing the off-screen original as well would be a duplicate.
      aria-hidden="true"
    >
      <Canvas
        // Byte for byte `Stage`'s canvas, by import rather than by copy.
        flat
        dpr={DPR_BAND as [number, number]}
        frameloop="demand"
        gl={STAGE_GL}
        camera={STAGE_CAMERA}
      >
        <StageLights />
        {subjects.map((subject) => (
          <SubjectGroup key={subject.id} subject={subject} groups={groups} />
        ))}
        <Painter pool={pool} groups={groups} aoRadius={aoRadius} />
      </Canvas>
    </div>
  )
}

export default SharedStage

/**
 * One subject's subtree, and its `Object3D` in the painter's map.
 *
 * `visible` is deliberately absent from the JSX: r3f only writes props it is
 * given, so leaving it out hands ownership of that one field to the painter.
 * Passing `visible={false}` and toggling it imperatively would work until a
 * re-render re-applied the JSX value and blanked the canvas.
 */
function SubjectGroup({ subject, groups }: { subject: PooledSubject; groups: GroupMap }) {
  const group = useRef<Group>(null)

  useEffect(() => {
    const object = group.current
    if (object === null) return
    const map = groups.current
    map.set(subject.id, object)
    return () => {
      map.delete(subject.id)
    }
  }, [subject.id, groups])

  return <group ref={group}>{subject.content}</group>
}

/**
 * The loop: `pool.paint` once per animation frame, at r3f priority 1.
 *
 * Priority ≥ 1 makes r3f hand over the render loop instead of also calling
 * `gl.render` itself, which here would draw one un-occluded subject over the
 * composed frames of all of them.
 */
function Painter({
  pool,
  groups,
  aoRadius,
}: {
  pool: SubjectPool
  groups: GroupMap
  aoRadius: number
}) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const stage = useStageComposer()

  // Any change in the pool — a new card, a drag, a resize — is a request for a
  // frame. `frameloop="demand"` means nothing happens without one.
  useEffect(() => {
    invalidate()
    return pool.subscribe(invalidate)
  }, [pool, invalidate])

  const painter = useMemo(() => {
    const buffer = new Vector2()

    return createSubjectPainter({
      camera,
      target: {
        source: gl.domElement,
        drawingBufferSize: () => {
          gl.getDrawingBufferSize(buffer)
          return { width: buffer.x, height: buffer.y }
        },
      },
      post: {
        configure: stage.configure,
        // Delta 0: nothing in this stack is time-dependent — n8ao does not
        // accumulate (`configuration.accumulate` is false by default) and SMAA
        // is a single-frame filter.
        render: () => {
          stage.composer.render(0)
        },
      },
      // The ref's map, not a copy: cards mount and unmount while this painter
      // lives, and `painter.ts` reads it live for that reason.
      groups: groups.current,
      aoRadius,
    })
  }, [gl, camera, stage, aoRadius, groups])

  useFrame(() => {
    const result = pool.paint(painter)
    // The frame budget is per frame, so what it deferred needs another one.
    if (result.deferred > 0) invalidate()
  }, 1)

  return null
}
