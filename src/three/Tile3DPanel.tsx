/**
 * The panel the drawer mounts — and the only part of the 3D feature that is in
 * the entry bundle.
 *
 * ```tsx
 * <Tile3DPanel record={record} tags={tags} assets={catalog.assets} />
 * ```
 *
 * One line, under `<SpriteRotator />` in `TileDrawer`'s body. It needs nothing
 * the drawer has not already computed: `tags` is the de-interned list the drawer
 * builds for its chips, `assets` is `catalog.assets`, and the size decision
 * comes from `record.bytes`, which is in the index.
 *
 * ## What is in this file, and what is deliberately not
 *
 * This module imports React, the gate and a stylesheet. It does **not** import
 * three, r3f, drei, `postprocessing`, n8ao, `@/download` or even `@/materials`.
 * That is what makes "a catalog-only visitor never downloads three.js" true
 * rather than aspirational: the whole 3D stack sits behind
 * `lazy(() => import('./Viewer'))` and is fetched on the first press of the
 * button, never on a drawer open, and never on a catalog page view. Adding one
 * import from `./Viewer`'s side of the line to this file would quietly move
 * ~1 MB into the entry chunk with no test failing.
 *
 * ## The refusal is a first-class state, not a hidden button
 *
 * 11.2% of the archive is over the gate. Those tiles get a sentence saying so,
 * with the real size in it, rather than a missing control — a control that is
 * absent for 978 tiles and present for 7,724 with no explanation reads as a bug
 * in the app. And the fallback needs no coordination: the sprite rotator PR 15
 * already mounted above this panel *is* the preview for those tiles, so a
 * refusal changes nothing on screen except the addition of the sentence.
 *
 * ## Nothing loads until it is asked for
 *
 * The chunk, the WebGL context and the up-to-25 MB fetch all start on the same
 * click. Closing the view unmounts the whole subtree, which aborts an in-flight
 * fetch, terminates the parse worker and disposes the geometry — so a misclick
 * costs whatever had arrived and nothing more.
 */
import { Suspense, lazy, useState } from 'react'

import type { CatalogAssets, CatalogRecord } from '@/catalog'

import { formatMegabytes, stlGate } from './gate'

import './three.css'

/** The 3D chunk. Every heavy dependency in the project is behind this line. */
const LazyViewer = lazy(() => import('./Viewer'))

export interface Tile3DPanelProps {
  readonly record: Pick<CatalogRecord, 'blob' | 'bytes' | 'file' | 'name'>
  /** De-interned tags — `resolveTags(catalog, record)`, which the drawer has. */
  readonly tags: readonly string[]
  readonly assets: Pick<CatalogAssets, 'models'>
  /**
   * Called when the 3D view opens or closes.
   *
   * The drawer does not need it — the sprite rotator and this panel coexist
   * happily — but it is here so a host that would rather *replace* its preview
   * well can, without this component knowing anything about the drawer.
   */
  readonly onOpenChange?: (open: boolean) => void
  /** Overrides the size gate. The dev harness does; the drawer does not. */
  readonly limit?: number
}

export function Tile3DPanel({
  record,
  tags,
  assets,
  onOpenChange,
  limit,
}: Tile3DPanelProps) {
  const [open, setOpen] = useState(false)
  const gate = stlGate(record, limit)

  const toggle = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  if (gate.mode === 'sprite') {
    return (
      <div className="of-3d-panel" data-gate="refused">
        <p className="of-3d-refusal">{gate.reason}</p>
      </div>
    )
  }

  return (
    <div className="of-3d-panel" data-gate="open">
      {open ? (
        <>
          <Suspense fallback={<div className="of-3d-well of-shimmer" data-status="chunk" />}>
            <LazyViewer
              record={record}
              tags={tags}
              assets={assets}
              {...(limit === undefined ? {} : { limit })}
            />
          </Suspense>
          <button
            type="button"
            className="of-3d-action"
            data-variant="ghost"
            onClick={() => {
              toggle(false)
            }}
          >
            Hide 3D view
          </button>
        </>
      ) : (
        <button
          type="button"
          className="of-3d-action"
          onClick={() => {
            toggle(true)
          }}
        >
          View in 3D
          <span className="of-3d-action-note">
            downloads the original {formatMegabytes(record.bytes)} mesh
          </span>
        </button>
      )}
    </div>
  )
}
