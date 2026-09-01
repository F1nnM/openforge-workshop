/**
 * A dev-only harness for the 3D viewer, at `/src/three/preview.html`.
 *
 * The drawer that will host `Tile3DPanel` is PR 15's file and this PR does not
 * touch it, so until that one line lands there is no route in the app that
 * renders any of this. The harness is what makes it lookable-at, and it is
 * deliberately instrumented in a way the shipped panel is not:
 *
 *   - **Real archive tiles, chosen by size**, with the median, the p95, the
 *     largest and the corpus's two pathological files (a 9 MB ASCII mesh and the
 *     84-byte zero-triangle header) all one click away. These are the cases the
 *     unit tests cannot cover, because covering them means bytes over a network.
 *   - **A limit override**, so the refusal path and the *above*-gate cases can
 *     both be seen. Raising it past the gate is how the p95 and 108.9 MB numbers
 *     in the PR report were measured; it is not a mode the app offers.
 *   - **A timing table** — fetch, parse, geometry build, triangle count, encoding
 *     and pre-scale extents — because "does it work" is not a useful answer and
 *     "10.4 MB, binary, 207,296 triangles, 1.5 s of network and 15 ms of parse"
 *     is.
 *
 * One harness-only artefact worth knowing before it is reported as a bug: this
 * page mounts **two** live WebGL canvases (the instrumented view and the panel's,
 * once opened), and under a software rasteriser the second context composited
 * opaque black instead of blending over the well's gradient. With either one
 * alone — which is what the app ever mounts — the canvas is transparent and the
 * parchment ground shows through as intended.
 *
 * It is **not** part of the app: `vite build`'s only input is `index.html`, so
 * neither this module nor its page reaches `dist/`. Delete both once the drawer
 * mounts the panel; nothing imports them.
 *
 * ```
 * mise exec -- npm run dev
 * open http://localhost:5173/src/three/preview.html
 * ```
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'

import type { CatalogFile, CatalogRecord } from '@/catalog'
import { resolveTags } from '@/catalog'
import { Eyebrow } from '@/ui/primitives'
import { loadCatalogIndex } from '@/ui/shell'

import { Stage } from './Stage'
import { StlModel } from './StlModel'
import { Tile3DPanel } from './Tile3DPanel'
import { STL_GATE_BYTES, formatMegabytes, stlGate } from './gate'
import { gridUnits } from './geometry'
import { useStlModel } from './useStlModel'

import '@/index.css'
import './three.css'

/** The tiles worth having a button for, by md5. Every one is a live archive file. */
const CASES: readonly { label: string; blob: string; note: string }[] = [
  {
    label: 'median',
    blob: '5234f9d5ac303d6f0d050403de0163e9',
    note: '10.36 MB — the corpus median, binary, 207,296 facets',
  },
  {
    label: 'just under the gate',
    blob: '7d6df7eb46477369fcec95ac5e3000e8',
    note: '25.16 MB — the largest file the gate lets through',
  },
  {
    label: 'p95',
    blob: '026a8d7e05c6698c042fceea186db548',
    note: '32.89 MB — over the gate; raise the limit to see it render',
  },
  {
    label: 'largest',
    blob: '2d32f890532c292bc47e2489c7e68992',
    note: '108.91 MB — 2.18 M facets; the reason a gate exists',
  },
  {
    label: 'ASCII, 9 MB',
    blob: '351eb0f553bce2a27d2385e87f7a55e7',
    note: '9.01 MB of text — 52,404 facets, the slow encoding',
  },
  {
    label: '84 bytes, 0 facets',
    blob: '4892426c4728448564f2e13b048eea45',
    note: 'a valid binary header with no triangles in it',
  },
]

const LIMITS: readonly { label: string; bytes: number }[] = [
  { label: 'the gate (24 MiB)', bytes: STL_GATE_BYTES },
  { label: '40 MB', bytes: 40_000_000 },
  { label: '120 MB (unsafe)', bytes: 120_000_000 },
  { label: '1 MB (force refusal)', bytes: 1_000_000 },
]

const mono = { fontFamily: 'var(--face-mono)', fontSize: 11, color: 'var(--mut)' } as const

function Harness() {
  const [catalog, setCatalog] = useState<CatalogFile | undefined>(undefined)
  const [blob, setBlob] = useState(CASES[0]?.blob ?? '')
  const [limit, setLimit] = useState(STL_GATE_BYTES)

  useEffect(() => {
    loadCatalogIndex().then(setCatalog, (error: unknown) => {
      console.error('preview: catalog index', error)
    })
  }, [])

  const record = catalog?.records.find((candidate) => candidate.blob === blob)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      <Eyebrow as="div">Row 21 preview · not part of the app</Eyebrow>
      <h1 style={{ fontFamily: 'var(--face-display)', fontSize: 30, margin: '6px 0 14px' }}>
        Gated 3D viewer
      </h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {CASES.map((entry) => (
          <button
            key={entry.blob}
            type="button"
            title={entry.note}
            onClick={() => {
              setBlob(entry.blob)
            }}
            style={{ fontWeight: entry.blob === blob ? 700 : 400 }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {LIMITS.map((entry) => (
          <button
            key={entry.bytes}
            type="button"
            onClick={() => {
              setLimit(entry.bytes)
            }}
            style={{ fontWeight: entry.bytes === limit ? 700 : 400 }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {catalog === undefined ? (
        <p>Loading the index…</p>
      ) : record === undefined ? (
        <p>No record in this index carries blob {blob}.</p>
      ) : (
        <div style={{ display: 'grid', gap: 22, gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
          <Instrumented catalog={catalog} record={record} limit={limit} />

          <div>
            <Eyebrow as="div">The shipped panel, as the drawer mounts it</Eyebrow>
            <p style={{ ...mono, margin: '6px 0 8px' }}>
              gate: {stlGate(record, limit).mode} · {formatMegabytes(record.bytes)}
            </p>
            <Tile3DPanel
              record={record}
              tags={resolveTags(catalog, record)}
              assets={catalog.assets}
              limit={limit}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** The same load path as the panel, with every measurement on screen. */
function Instrumented({
  catalog,
  record,
  limit,
}: {
  catalog: CatalogFile
  record: CatalogRecord
  limit: number
}) {
  const tags = resolveTags(catalog, record)
  const state = useStlModel({ record, tags, assets: catalog.assets, limit })
  const { status, progress, model, material, resolution, timing, error } = state

  return (
    <div>
      <Eyebrow as="div">Instrumented — bypasses the button, loads on select</Eyebrow>
      <p style={{ fontFamily: 'var(--face-display)', fontSize: 19, margin: '6px 0 10px' }}>
        {record.name}
      </p>

      <div className="of-3d">
        <div className="of-3d-well" data-status={status}>
          {status === 'ready' && model !== null && material !== null ? (
            <Stage
              className="of-3d-canvas"
              label={`3D view of ${record.name}`}
              occlusion={resolution.family.edge}
            >
              <StlModel geometry={model.geometry} material={material} />
            </Stage>
          ) : (
            <p style={{ ...mono, textAlign: 'center', padding: '0 16px' }}>
              {status}
              {progress === null
                ? null
                : ` · ${formatMegabytes(progress.loaded)} of ${formatMegabytes(progress.total)}`}
              {error === null ? null : ` · ${error}`}
            </p>
          )}
        </div>
      </div>

      <table style={{ ...mono, marginTop: 12, borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          <Row label="status" value={status} />
          <Row label="file" value={`${formatMegabytes(record.bytes)} · ${record.file}`} />
          <Row label="material" value={`${resolution.family.label} · ${resolution.via}`} />
          <Row
            label="encoding"
            value={timing === null ? '—' : `${timing.format} · ${timing.triangles.toLocaleString('en-GB')} facets`}
          />
          <Row
            label="fetch"
            value={timing === null ? '—' : `${timing.fetchMs.toFixed(0)} ms`}
          />
          <Row
            label="parse (worker)"
            value={timing === null ? '—' : `${timing.parseMs.toFixed(1)} ms`}
          />
          <Row
            label="geometry build"
            value={timing === null ? '—' : `${timing.buildMs.toFixed(1)} ms`}
          />
          <Row
            label="extents"
            value={
              model === null
                ? '—'
                : `${model.extents.map((value) => value.toFixed(2)).join(' × ')} mm  =  ` +
                  `${model.extents.map((value) => gridUnits(value).toFixed(2)).join(' × ')} units`
            }
          />
          <Row label="scale" value={model === null ? '—' : model.scale.toExponential(3)} />
        </tbody>
      </table>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '2px 10px 2px 0', color: 'var(--mut)', whiteSpace: 'nowrap' }}>
        {label}
      </td>
      <td style={{ padding: '2px 0', color: 'var(--ink)' }}>{value}</td>
    </tr>
  )
}

const host = document.getElementById('root')
if (host !== null) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )
}
