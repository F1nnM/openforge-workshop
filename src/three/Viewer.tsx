/**
 * The 3D view itself — the module that owns every heavy import.
 *
 * `Tile3DPanel` reaches this file through a `lazy(() => import('./Viewer'))`,
 * and that indirection is the point: three.js, r3f, drei, `postprocessing` and
 * n8ao are all reachable only from here, so a visitor who browses the catalog
 * and never presses "View in 3D" downloads none of it. Anything imported into
 * `Tile3DPanel` instead would land in the entry chunk and undo that, which is
 * worth remembering before adding an import to the panel.
 *
 * The default export is what `lazy` wants; the named export is for tests and the
 * dev harness.
 *
 * ## The states are all on screen
 *
 * A tile preview is a network fetch of up to 25 MB over a link the app does not
 * control, so "it worked" is one of six outcomes and the other five are visible:
 * a determinate progress bar during the fetch (the total comes from the index,
 * so it is honest from the first chunk rather than guessing at a
 * `Content-Length`), a parse state, the zero-triangle file, the stream cap
 * firing on a stale index, and a plain failure. None of them takes down the
 * drawer.
 *
 * ## Keyboard
 *
 * Orbit is pointer-only — `OrbitControls` has no rotation key bindings, and
 * inventing a set here would put a second, differently-behaved rotation gesture
 * next to the sprite rotator's, which already implements arrow keys and a pole
 * pad against `role="slider"` (PR 15). So the sprite rotator stays mounted above
 * this view and remains the keyboard route to every angle; the canvas is labelled
 * and not focusable, and the caption says which is which.
 */
import { Suspense } from 'react'

import type { CatalogAssets, CatalogRecord } from '@/catalog'

import { Stage } from './Stage'
import { StlModel } from './StlModel'
import { formatMegabytes } from './gate'
import { useStlModel } from './useStlModel'

export interface ViewerProps {
  readonly record: Pick<CatalogRecord, 'blob' | 'bytes' | 'file' | 'name'>
  /** De-interned tags, so the material resolves exactly as the plan view's fill does. */
  readonly tags: readonly string[]
  readonly assets: Pick<CatalogAssets, 'models'>
  /** Overrides the gate limit. The dev harness does; the drawer does not. */
  readonly limit?: number
}

export function Viewer({ record, tags, assets, limit }: ViewerProps) {
  const state = useStlModel({
    record,
    tags,
    assets,
    ...(limit === undefined ? {} : { limit }),
  })
  const { status, progress, model, material, resolution, timing, error } = state

  const ready = status === 'ready' && model !== null && material !== null

  return (
    <div className="of-3d">
      <div className="of-3d-well" data-status={status}>
        {ready ? (
          <Suspense fallback={null}>
            <Stage
              className="of-3d-canvas"
              label={`3D view of ${record.name}. Drag to orbit, scroll to zoom.`}
              occlusion={resolution.family.edge}
            >
              <StlModel geometry={model.geometry} material={material} />
            </Stage>
          </Suspense>
        ) : (
          <Status
            status={status}
            progress={progress}
            error={error}
            bytes={record.bytes}
          />
        )}
      </div>

      <p className="of-3d-caption">
        {timing === null || !ready ? (
          <>Loading the original mesh from the archive · {formatMegabytes(record.bytes)}</>
        ) : (
          <>
            {timing.triangles.toLocaleString('en-GB')} triangles · {timing.format} STL ·{' '}
            {formatMegabytes(record.bytes)} · drag to orbit, scroll to zoom
          </>
        )}
      </p>
    </div>
  )
}

export default Viewer

/* -------------------------------------------------------------------- states */

function Status({
  status,
  progress,
  error,
  bytes,
}: {
  status: string
  progress: { loaded: number; total: number } | null
  error: string | null
  bytes: number
}) {
  if (status === 'loading' || status === 'parsing') {
    const fraction =
      progress === null || progress.total === 0
        ? 0
        : Math.min(1, progress.loaded / progress.total)
    const percent = Math.round(fraction * 100)

    return (
      <div className="of-3d-progress">
        <p>
          {status === 'loading'
            ? `Downloading ${formatMegabytes(bytes)} of mesh…`
            : 'Parsing off the main thread…'}
        </p>
        <div
          className="of-3d-bar"
          role="progressbar"
          aria-label="Mesh download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status === 'parsing' ? 100 : percent}
        >
          <span style={{ width: `${String(status === 'parsing' ? 100 : percent)}%` }} />
        </div>
      </div>
    )
  }

  if (status === 'empty') {
    return (
      <div className="of-3d-plate">
        <p>
          This file is a valid STL header with <strong>no triangles in it</strong> — 84 bytes,
          and one of one in the archive. There is nothing to render, which is the file&rsquo;s
          answer rather than a failure of this viewer.
        </p>
      </div>
    )
  }

  return (
    <div className="of-3d-plate">
      <p>{error ?? 'The mesh could not be loaded.'}</p>
      <p className="of-3d-plate-note">
        The pre-rendered angles above are unaffected — they are a separate asset.
      </p>
    </div>
  )
}
