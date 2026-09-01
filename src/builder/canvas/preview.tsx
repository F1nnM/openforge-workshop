/**
 * A dev-only harness for the plan canvas, at
 * `/src/builder/canvas/preview.html`.
 *
 * The canvas is mounted by row 18's builder screen and by nothing else, so until
 * that lands there is no route in the app that renders it — and a screen nobody
 * can open cannot be looked at. This is the smallest thing that lets it be
 * looked at: the **real** emitted `catalog.json`, the real material registry, the
 * real store, and a palette and toolbar standing in for row 18's.
 *
 * The palette here is deliberately crude — six floors, six walls, plus one arc
 * and one non-90° tile so the refusal marker and the per-tile rotation step have
 * a subject. Row 18's palette is a searchable list over the whole catalog with
 * thumbnails, and building any of that here would be building row 18 twice.
 *
 * It is **not** part of the app. `vite build`'s only input is `index.html`, so
 * neither this module nor its page reaches `dist/`. Delete both the day the
 * builder screen renders `<PlanCanvas />`; nothing imports them.
 *
 * ```
 * mise exec -- npm run dev
 * open http://localhost:5173/src/builder/canvas/preview.html
 * ```
 */
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { CatalogFile, CatalogRecord } from '@/catalog'
import { clearPlacements, usePlacementCount } from '@/store'
import { loadCatalogIndex } from '@/ui/shell'

import { planCatalogFromFile } from './catalog'
import { isPlaceable, rotationStepFor } from './geometry'
import { PlanCanvas } from './PlanCanvas'
import type { PlanStatus } from './PlanCanvas'
import { usePlanTools } from './usePlanTools'

import '@/index.css'

/** Six of each kind, plus the two awkward cases, chosen from the real index. */
function pickPalette(file: CatalogFile): readonly CatalogRecord[] {
  const take = (predicate: (record: CatalogRecord) => boolean, count: number) =>
    file.records.filter(predicate).slice(0, count)

  return [
    ...take((r) => r.foot.shape === 'rect' && r.kinds.includes('floor') && r.foot.w <= 2 && r.foot.d <= 2, 6),
    ...take((r) => r.foot.shape === 'wall' && r.foot.length <= 2, 6),
    ...take((r) => r.rotStep !== undefined && r.rotStep % 90 !== 0 && isPlaceable(r), 2),
    ...take((r) => r.foot.shape === 'arc', 1),
    ...take((r) => r.foot.shape === 'none', 1),
  ]
}

function Preview({ file }: { file: CatalogFile }) {
  const catalog = useMemo(() => planCatalogFromFile(file), [file])
  const palette = useMemo(() => pickPalette(file), [file])
  const tools = usePlanTools()
  const [status, setStatus] = useState<PlanStatus | null>(null)
  const placed = usePlacementCount()
  const armed = tools.selectedTileId === null ? undefined : catalog.record(tools.selectedTileId)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '272px 1fr', height: '100vh', background: 'var(--bg)' }}>
      <aside style={{ overflowY: 'auto', borderRight: '1px solid var(--line)', padding: 12 }}>
        <p style={{ font: '600 11px/1 var(--face-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mut)' }}>
          Palette — {String(palette.length)} tiles
        </p>
        {palette.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => {
              tools.setSelectedTileId(record.id)
            }}
            style={{
              display: 'block',
              width: '100%',
              margin: '6px 0',
              padding: '6px 8px',
              textAlign: 'left',
              font: '400 12.5px/1.3 var(--face-body)',
              color: 'var(--ink)',
              background: tools.selectedTileId === record.id ? 'var(--chip)' : 'var(--bg2)',
              border: `1px solid ${tools.selectedTileId === record.id ? 'var(--acc)' : 'var(--line)'}`,
              borderRadius: 3,
              cursor: 'pointer',
              opacity: isPlaceable(record) ? 1 : 0.55,
            }}
          >
            {record.name}
            <span style={{ display: 'block', font: '400 10.5px var(--face-mono)', color: 'var(--mut)' }}>
              {record.foot.shape}
              {record.foot.shape === 'rect' ? ` ${String(record.foot.w)}×${String(record.foot.d)}` : ''}
              {record.foot.shape === 'wall' ? ` ${String(record.foot.length)}` : ''} · {String(rotationStepFor(record))}°
              {isPlaceable(record) ? '' : ' · not placeable'}
            </span>
          </button>
        ))}
      </aside>

      <main style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: '8px 12px',
            borderBottom: '1px solid var(--line)',
            font: '400 12.5px var(--face-body)',
          }}
        >
          <button type="button" onClick={() => tools.setTool('place')} aria-pressed={tools.tool === 'place'}>
            Place
          </button>
          <button type="button" onClick={() => tools.setTool('erase')} aria-pressed={tools.tool === 'erase'}>
            Erase
          </button>
          <button
            type="button"
            onClick={() => {
              tools.rotate(armed === undefined ? 90 : rotationStepFor(armed))
            }}
          >
            ⟳ Rotate
          </button>
          <button type="button" onClick={clearPlacements}>
            Clear
          </button>
          <button type="button" onClick={tools.toggleSnap}>
            snap {tools.step === 1 ? '1' : '0.5'}
          </button>
          <span style={{ font: '400 11px var(--face-mono)', color: 'var(--mut)' }}>
            {String(placed)} placed · {String(status?.conflicts ?? 0)} overlapping · {String(tools.rotation)}°
          </span>
        </div>
        <PlanCanvas catalog={catalog} tools={tools} onStatus={setStatus} />
      </main>
    </div>
  )
}

function Harness() {
  const [file, setFile] = useState<CatalogFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCatalogIndex().then(setFile, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [])

  if (error !== null) return <p style={{ padding: 24 }}>Could not load the catalog index: {error}</p>
  if (file === null) return <p style={{ padding: 24 }}>Loading the catalog index…</p>
  return <Preview file={file} />
}

const container = document.getElementById('root')
if (container === null) throw new Error('root element not found')

createRoot(container).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
