/**
 * The drawer: five shapes, fifteen controls, and one line that says which base
 * you are actually getting.
 *
 * Everything expensive in this row is on this side of the lazy boundary — the
 * pinned schemas, the sweep tables, the resolver, and the dynamic import that
 * reaches the engine. `GeneratorPanel.tsx` is the only part in the entry
 * bundle, and `boundary.test.ts` holds the line.
 *
 * ## The resolution strip is the whole product argument
 *
 * §5.1: *"The generator is the interface. The catalogued bases are its cache."*
 * The user never chooses between an archived base and a generated one — they
 * see which one they got, on one mono line, and it changes as they type. That is
 * what stops this being two catalogues of the same thing.
 *
 * **And the strip does not overclaim.** A hit means the archive publishes the
 * base these parameters *name*. It does not mean the engine would produce those
 * bytes, and this is not a hedge: the archived bases are ASCII STL exported by
 * an older revision of this geometry, and `corpus.test.ts` searched the entire
 * connector space of a 1x1 square — 184 renders — without matching the archived
 * 1x1's md5 or even its facet count. So a hit offers Devon's published file,
 * which is the one that has been printed; a render offers current geometry,
 * which is the one the parameters describe. The strip says which, in those
 * terms, and never calls a generated mesh the archive's file.
 *
 * ## Not every base is parametric, and the panel says so
 *
 * 728 of the archive's 1,963 bases carry a sculpted texture — cave, wood, brick,
 * aztlan, sewer — that no OpenSCAD path produces: the generator bolts connectors
 * onto a fixed sculpt, it does not make the sculpt. `bases-wall-primary.scad`,
 * which reaches the textures it does reach, is not vendored at all, because nine
 * of its ten `TEXTURE` values `import()` a blank STL and upstream ships 36 of
 * them at 82.9 MiB. So the footnote under the form is load-bearing, not a
 * caveat: sculpted bases come from the catalog or not at all.
 *
 * ## Non-modal, and why
 *
 * §3.1 extends the design language deliberately here: the tile-detail drawer
 * uses a `--scrim` because it is a read-only overlay, and this one does not,
 * because it is a working tool and the plan behind it stays legible while the
 * base is tuned. Same 442px geometry, same Escape-to-close.
 */
import { useEffect, useMemo, useState } from 'react'

import type { CatalogAssets, CatalogRecord } from '@/catalog'
import { shardedPath } from '@/catalog'
import { Button, Chip, Eyebrow, buttonProps } from '@/ui/primitives'

import { placeRecipe } from '../placement/placement'

import { ParameterControl } from './controls'
import type { BaseFootprint } from './footprint'
import { baseFootprint } from './footprint'
import type { GeneratorPlaceAt, GeneratorPlaceHandler } from './GeneratorPanel'
import type { BaseRecipe, RecipeValue } from './recipe'
import { canonicalise, fileDefaults, isFileDefaults, recipeId, recipeKey } from './recipe'
import type { Resolution } from './resolve'
import { buildBaseResolver } from './resolve'
import type { PanelEntry } from './schemas'
import { ENTRY_LABELS, PANEL_ENTRIES, panelSchema } from './schemas'
import { usePreview } from './usePreview'
import type { PreviewOptions, PreviewState } from './usePreview'

import './panel.css'

/**
 * The state each shape opens on, and why it is not the file's defaults.
 *
 * `bases-square.scad`'s own defaults resolve to **nothing**: at 2x2 every
 * archived square was swept at `PRIORITY="magnets"` with `TOPLESS="false"`,
 * while the file defaults to `"lock"` and `"true"`. Opening on the file's
 * defaults would therefore open on a cache miss and a 400 ms render, in a panel
 * whose entire argument is that the common case costs nothing — so each shape
 * opens on the archived tuple its family is largest at, and `Reset to file
 * defaults` is one press away with a note saying what it does.
 *
 * `recipe.test.ts` asserts that every one of these resolves, so a table drift
 * that made the panel open on a miss fails the suite.
 */
export const OPENING_STATE: Readonly<Record<PanelEntry, Readonly<Record<string, RecipeValue>>>> = {
  'bases-square.scad': { x: 2, y: 2, LOCK: 'openlock', MAGNETS: 'flex_magnetic', MAGNET_HOLE: 6, PRIORITY: 'magnets', TOPLESS: 'false', SUPPORTS: 'true' },
  // The wall opens without magnets, and not by preference: every archived
  // wall base that *has* magnets is published twice, once under
  // `base+s2w+square+wall` and once under `base+s2w+wall_locks+square+wall`,
  // and `WALL_LOCKS` is this file's default either way — so the two spellings
  // canonicalise to one recipe with two different blobs and the resolver
  // refuses to pick. This tuple is the closest archived neighbour that is
  // published once.
  'bases-square-wall.scad': { x: 2, y: 2, LOCK: 'openlock', MAGNETS: 'none', MAGNET_HOLE: 0, PRIORITY: 'lock', TOPLESS: 'true', SUPPORTS: 'true', WALL_LOCKS: 'true' },
  'bases-square-corner.scad': { x: 2, y: 2, LOCK: 'openlock', MAGNETS: 'flex_magnetic', MAGNET_HOLE: 6, PRIORITY: 'magnets', TOPLESS: 'false', SUPPORTS: 'true', WALL_LOCKS: 'true' },
  'bases-square-internal_corner.scad': { x: 2, y: 2, LOCK: 'openlock', MAGNETS: 'flex_magnetic', MAGNET_HOLE: 6, PRIORITY: 'magnets', TOPLESS: 'false', SUPPORTS: 'true' },
  'risers_square.scad': { x: 2, y: 2, z: 4, LOCK: 'openlock' },
}

export interface GeneratorDrawerProps {
  readonly records: readonly CatalogRecord[]
  readonly assets: Pick<CatalogAssets, 'models'>
  readonly onClose: () => void
  /**
   * Row S5's seam, wired by row X9. The action is not rendered without it — a
   * disabled primary button advertising a feature that does not exist is worse
   * than no button.
   *
   * See {@link GeneratorPlaceHandler}: this drawer calls `placeRecipe` itself and
   * hands over the resolved placement, because the resolution is already on
   * screen here and rebuilding a resolver on the screen's side of the boundary
   * would put the pinned schemas in the entry chunk.
   */
  readonly onPlace?: GeneratorPlaceHandler | undefined
  /** Where the base goes. See {@link GeneratorPanelProps.placeAt}. */
  readonly placeAt?: ((foot: BaseFootprint) => GeneratorPlaceAt) | undefined
  /** Injected by tests so no engine is loaded and no request leaves the process. */
  readonly preview?: Pick<PreviewOptions, 'load' | 'loadLicence' | 'loadDescriber'> | undefined
}

export default function GeneratorDrawer({
  records,
  assets,
  onClose,
  onPlace,
  placeAt,
  preview,
}: GeneratorDrawerProps) {
  const [entry, setEntry] = useState<PanelEntry>('bases-square.scad')
  const [values, setValues] = useState<Readonly<Record<string, RecipeValue>>>(OPENING_STATE['bases-square.scad'])

  // 31 ms over all 8,702 records, once, on this side of the lazy boundary. See
  // `resolve.ts` for why the map is derived rather than shipped.
  const resolver = useMemo(() => buildBaseResolver(records), [records])
  const schema = panelSchema(entry)

  const recipe = useMemo<BaseRecipe>(
    () => ({ v: 1, entry, parameters: canonicalise(entry, values) }),
    [entry, values],
  )
  const resolution = resolver.resolutionOf(recipe)
  const archived = resolution.kind === 'archived' ? resolution.base : null
  const previewState = usePreview({ recipe, archived: archived !== null, ...preview })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const foot = baseFootprint(entry, recipe.parameters)
  const id = recipeId(recipeKey(recipe))
  const state = previewState.state

  /**
   * Place the base the form currently describes.
   *
   * Three facts meet here and nowhere else, which is the whole argument for
   * calling `placeRecipe` on this side of the boundary: the **recipe** the
   * controls hold, the **resolution** the strip is showing, and the **bytes**
   * `usePreview` has if it has finished. A screen given only the recipe would
   * have to re-derive the second and could never see the third.
   *
   * The mesh is `null` for an archived resolution, because an archived placement
   * is the archive's published file and nothing was rendered; and `null` for a
   * generated one the engine has not finished, which is a real state rather than
   * an error — the footprint is arithmetic, so the outline was always truthful,
   * and row S5 already makes such a base a `warn` bill row and a refused
   * download rather than a silently short pack.
   */
  const place = () => {
    if (onPlace === undefined) return
    const at = placeAt?.(foot) ?? { x: 0, z: 0 }
    const placed = placeRecipe(recipe, resolution, at)
    const mesh =
      placed.kind === 'generated' && state.status === 'ready' ? { md5: state.md5, bytes: state.mesh } : null
    onPlace(placed, mesh)
  }

  return (
    <aside className="of-gen" aria-label="Generate a base">
      <header className="of-gen-head">
        <Eyebrow as="div">Parametric · base</Eyebrow>
        <h2 className="of-gen-title">{schema.title.replace(/[-_]/g, ' ')}</h2>
        <Button tone="secondary" size="sm" onClick={onClose} className="of-gen-close">
          Close
        </Button>
      </header>

      <div className="of-gen-shapes" role="group" aria-label="Shape">
        {PANEL_ENTRIES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className="of-gen-shape"
            aria-pressed={candidate === entry}
            onClick={() => {
              setEntry(candidate)
              setValues(OPENING_STATE[candidate])
            }}
          >
            {ENTRY_LABELS[candidate]}
          </button>
        ))}
      </div>

      <ResolutionStrip resolution={resolution} assets={assets} state={previewState.state} />
      <FootprintProxy entry={entry} values={recipe.parameters} />

      <form className="of-gen-form" onSubmit={(event) => { event.preventDefault() }}>
        {schema.groups.map((group) => (
          <fieldset key={group.name} className="of-gen-group">
            <legend>
              <Eyebrow as="span">{group.name === '' ? 'Parameters' : group.name}</Eyebrow>
            </legend>
            {group.parameters.map((descriptor) => (
              <ParameterControl
                key={descriptor.name}
                descriptor={descriptor}
                value={recipe.parameters[descriptor.name] ?? descriptor.initial}
                note={noteFor(descriptor.name, recipe.parameters)}
                warning={warningFor(descriptor.name, recipe.parameters)}
                onChange={(next) => {
                  setValues((previous) => ({ ...previous, [descriptor.name]: next }))
                }}
                onCommit={previewState.commit}
              />
            ))}
          </fieldset>
        ))}
      </form>

      <p className="of-gen-textures">
        Plain only. The archive&apos;s 728 textured bases — cave, wood, brick, aztlan, sewer — are hand
        sculpts with no OpenSCAD path, so they are browsed rather than generated.
      </p>

      <PreviewReadout state={previewState.state} archived={archived !== null} />

      <footer className="of-gen-foot">
        <p className="of-gen-id">
          <Chip tone="size">{id}</Chip> {foot.footprint.shape === 'rect' ? `${String(foot.footprint.w)}x${String(foot.footprint.d)}` : foot.footprint.shape} ·{' '}
          {foot.heightMm.toFixed(1)} mm · {foot.basisMm} mm/square
        </p>
        {foot.tiles ? null : (
          <p className="of-gen-warn" role="note">
            This basis is {foot.basisMm} mm to the square and the builder grid is 25.4, so the base
            will not tile. Every base in the archive is the inch grid; a mixed-basis build is a
            builder feature, not a generator one.
          </p>
        )}
        <div className="of-gen-actions">
          {archived === null ? (
            <MeshDownload state={previewState.state} name={`${schema.title}.${id}.stl`} />
          ) : (
            <a
              {...buttonProps({ tone: 'primary', size: 'sm' })}
              href={`${assets.models}/${shardedPath(archived.blob)}.stl`}
              download={archived.file}
            >
              Download the archived file
            </a>
          )}
          {onPlace === undefined ? null : (
            <Button tone="secondary" size="sm" onClick={place}>
              Place in build
            </Button>
          )}
          <Button
            tone="secondary"
            size="sm"
            disabled={isFileDefaults(entry, values)}
            onClick={() => {
              setValues(fileDefaults(entry))
              previewState.commit()
            }}
          >
            Reset to file defaults
          </Button>
        </div>
        <p className="of-gen-defaults-note">
          The file&apos;s own defaults are in no archived file: every archived square was swept at
          PRIORITY=magnets with TOPLESS=false, and the file defaults to lock and true.
        </p>
        <LicenceNotice licence={previewState.licence} />
      </footer>
    </aside>
  )
}

/* ------------------------------------------------------------ the strip */

function ResolutionStrip({
  resolution,
  assets,
  state,
}: {
  resolution: Resolution
  assets: Pick<CatalogAssets, 'models'>
  state: PreviewState
}) {
  if (resolution.kind === 'ambiguous') {
    return (
      <p className="of-gen-strip" data-tone="ambiguous">
        <span className="of-gen-strip-lead">In the archive twice</span> {resolution.files.join(' · ')}
        <span className="of-gen-strip-note">
          Two published files name these parameters and they are different meshes, so neither is
          offered — handing over one of two would be handing over a base that may not be the one
          described. The mesh below is generated here.
        </span>
      </p>
    )
  }
  const archived = resolution.kind === 'archived' ? resolution.base : null
  if (archived !== null) {
    return (
      <p className="of-gen-strip" data-tone="archive">
        <span className="of-gen-strip-lead">In the archive</span> {archived.file} ·{' '}
        {(archived.bytes / 1_048_576).toFixed(2)} MB · md5 {archived.blob.slice(0, 8)}
        <span className="of-gen-strip-note">
          Devon publishes this base for these parameters. It is an ASCII STL exported by an earlier
          revision of the geometry, so it is not the mesh this engine would produce — it is the file
          that has been printed. <a href={`${assets.models}/${shardedPath(archived.blob)}.stl`}>Fetch it</a>{' '}
          rather than render it.
        </span>
        {/*
          The flags upstream's sweep actually passed, disclosed rather than
          summarised. Worth the six lines: this is where a reader sees that the
          file whose name says `openlock` was rendered with LOCK="triplex", and
          that its `PRIORITY` came from the order of the connectors in the name.
        */}
        <details className="of-gen-swept">
          <summary>Swept as {archived.swept.dirname}</summary>
          <code>
            {Object.entries(archived.swept.parameters)
              .map(([name, value]) => `-D ${name}=${typeof value === 'string' ? `"${value}"` : String(value)}`)
              .join(' ')}
          </code>
        </details>
      </p>
    )
  }
  return (
    <p className="of-gen-strip" data-tone="generate">
      <span className="of-gen-strip-lead">Not in the archive</span>{' '}
      {state.status === 'ready'
        ? `rendered here · ${String(state.triangles.toLocaleString('en-GB'))} triangles · ${state.renderMs.toFixed(0)} ms`
        : 'renders in your browser'}
      <span className="of-gen-strip-note">
        These parameters name no published file, so the mesh is generated here and is current
        geometry rather than the archive&apos;s.
      </span>
    </p>
  )
}

/**
 * The footprint, drawn from arithmetic in the frame the parameter changed.
 *
 * Squares, not a mesh: `x`, `y` and the basis need no geometry, so the outline
 * is truthful before the engine has been asked anything — which is also what
 * row S5 places the base by. Labelled as a footprint so it cannot be mistaken
 * for a preview of the mesh.
 */
function FootprintProxy({ entry, values }: { entry: PanelEntry; values: Readonly<Record<string, RecipeValue>> }) {
  const foot = baseFootprint(entry, values)
  if (foot.footprint.shape !== 'rect') return null
  const cells = Array.from({ length: foot.footprint.w * foot.footprint.d }, (_, index) => index)
  return (
    <figure className="of-gen-proxy">
      <div
        className="of-gen-grid"
        style={{ gridTemplateColumns: `repeat(${String(foot.footprint.w)}, 1fr)` }}
        aria-hidden="true"
      >
        {cells.map((cell) => (
          <span key={cell} className="of-gen-cell" />
        ))}
      </div>
      <figcaption>
        Footprint {foot.footprint.w} x {foot.footprint.d} squares, {(foot.footprint.w * foot.basisMm).toFixed(1)} x{' '}
        {(foot.footprint.d * foot.basisMm).toFixed(1)} mm. Arithmetic, not the mesh.
      </figcaption>
    </figure>
  )
}

/* --------------------------------------------------------- the readout */

function PreviewReadout({ state, archived }: { state: PreviewState; archived: boolean }) {
  if (archived) return null
  switch (state.status) {
    case 'idle':
      return null
    case 'archived':
      return null
    case 'loading':
      return (
        <p className="of-gen-status of-shimmer" role="status">
          Loading the engine
        </p>
      )
    case 'rendering':
      return (
        <p className="of-gen-status of-shimmer" role="status">
          Rendering
        </p>
      )
    case 'refused':
      return (
        <p className="of-gen-error" role="alert">
          {state.message}
          <span className="of-gen-strip-note">
            The geometry refuses this combination itself, with those words. Nothing was rendered.
          </span>
        </p>
      )
    case 'failed':
      return (
        <p className="of-gen-error" role="alert">
          {state.message}
          {state.output.length === 0 ? null : <span className="of-gen-log">{state.output.join(' · ')}</span>}
        </p>
      )
    case 'ready':
      return (
        <dl className="of-gen-readout">
          <dt>Triangles</dt>
          <dd>{state.triangles.toLocaleString('en-GB')}</dd>
          <dt>Bytes</dt>
          <dd>{state.bytes.toLocaleString('en-GB')}</dd>
          <dt>Render</dt>
          <dd>
            {state.renderMs.toFixed(0)} ms · boot {state.bootMs.toFixed(0)} ms · run {state.runs}
          </dd>
          <dt>Digest</dt>
          <dd className="of-gen-verification">{state.verification}</dd>
        </dl>
      )
  }
}

function MeshDownload({ state, name }: { state: PreviewState; name: string }) {
  const href = useMemo(() => {
    if (state.status !== 'ready') return null
    return URL.createObjectURL(new Blob([state.mesh as unknown as BlobPart], { type: 'model/stl' }))
  }, [state])

  useEffect(() => {
    return () => {
      if (href !== null) URL.revokeObjectURL(href)
    }
  }, [href])

  if (href === null) return null
  return (
    <a {...buttonProps({ tone: 'primary', size: 'sm' })} href={href} download={name}>
      Download this mesh
    </a>
  )
}

/**
 * The GPL-2 notice, which is not decoration.
 *
 * S3 vendored `openscad.wasm` with its licence and written source offer imported
 * into the same lazily-loaded chunk, and `assertNoticePresent` refuses to boot
 * the engine if either failed to load — *"so a build that tree-shook it away
 * fails on the first render rather than shipping quietly"*. What that mechanism
 * cannot do is show the notice to the person whose browser just downloaded a
 * GPL-2 binary. This does: the summary line is always present once the licence
 * loads, and the disclosure carries the complete unmodified text and the §3(b)
 * offer. Blocker B4 is waived by the project owner and this is not an attempt to
 * reopen it.
 */
function LicenceNotice({ licence }: { licence: { program: string; version: string; spdx: string; text: string; offer: string; sources: readonly { what: string; url: string; commit: string | null }[] } | null }) {
  if (licence === null) {
    return (
      <p className="of-gen-licence" data-state="pending">
        Rendering here uses OpenSCAD, which is free software under the GPL. Its licence and source
        offer load with the engine.
      </p>
    )
  }
  return (
    <details className="of-gen-licence" data-state="loaded">
      <summary>
        Rendering uses {licence.program} {licence.version}, {licence.spdx}. Licence and source offer.
      </summary>
      <ul className="of-gen-sources">
        {licence.sources.map((source) => (
          <li key={source.url}>
            {source.what} — <a href={source.url}>{source.url}</a>
            {source.commit === null ? null : ` @ ${source.commit}`}
          </li>
        ))}
      </ul>
      <pre className="of-gen-offer">{licence.offer}</pre>
      <pre className="of-gen-copying">{licence.text}</pre>
    </details>
  )
}

/* ------------------------------------------------------- the honest notes */

/**
 * What the archive cannot give for this parameter's current value.
 *
 * Three of these are measured facts about the corpus rather than opinions, and
 * all three are cases where the control is offering something real that the
 * archive does not hold — which is the generator's whole reason to exist, so
 * they are notes rather than blocks.
 */
export function noteFor(name: string, values: Readonly<Record<string, RecipeValue>>): string | null {
  if (name === 'SQUARE_BASIS' && values.SQUARE_BASIS !== 'inch') {
    return 'No archived base uses this basis. All 1,963 are the inch grid; this one only generates.'
  }
  if ((name === 'x' || name === 'y') && values[name] === 1) {
    return 'A unit dimension: 147 archived bases have one, and this dropdown starts at 2 because the .scad file does.'
  }
  if (name === 'LOCK' && values.LOCK === 'openlock') {
    return 'The archive also holds topless-openlock bases, swept with LOCK="openlock_topless" — a value this file\'s own dropdown does not offer.'
  }
  return null
}

/** The geometry's own refusal, quoted, before anything is rendered. */
export function warningFor(name: string, values: Readonly<Record<string, RecipeValue>>): string | null {
  if (name !== 'LOCK' && name !== 'SQUARE_BASIS') return null
  const lock = values.LOCK
  if (values.SQUARE_BASIS === 'inch' || typeof lock !== 'string') return null
  if (lock !== 'dragonlock' && lock !== 'infinitylock') return null
  return `${lock} is only compatible with the inch basis. The geometry refuses this combination and emits nothing.`
}
