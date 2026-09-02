/**
 * The landing screen — design-contract.md §2.1.
 *
 * The front door, and the only screen a search engine or a first-time visitor
 * ever sees cold. Four parts, in the contract's order: a two-column hero with
 * four live figures, a numbered three-step sequence, and a credit line.
 *
 * ## What is transcribed and what is changed
 *
 * The hero's structure, the 54 px display headline, the 52ch lede, the two
 * actions, the four figures, the roman-numbered cards and the footer are the
 * mock's (`design/OpenForge-Studio.dc.html`, lines 41–85). Four things are not:
 *
 *   1. **The hero image.** The mock renders a room with three.js at load time.
 *      v1 has no 3D at all, so the hero is a plan drawing in the builder's own
 *      idiom — the full argument, and what was rejected, is in `HeroPlan.tsx`.
 *   2. **The figures are derived, never written down.** See `stats.ts`.
 *   3. **"MB of STLs" is rendered in the unit the value deserves.** The archive
 *      is 108.0 GB; the mock was written against 31 hand-made tiles.
 *   4. **The card copy no longer promises live 3D previews.** v1's detail drawer
 *      turns a tile through the ten pre-rendered sprite-sheet angles (PR 15),
 *      which is a real and defensible feature and is what the card now says.
 *
 * ## The screen renders before its data, and without it
 *
 * Everything except the four figures and the archive host is static content in
 * the markup. The index is 5.6 MB of JSON behind a 45–90 ms validating parse, so
 * it lands well after first paint, and it may not land at all. There is no
 * loading gate and no error boundary path: the figures show `…` while unknown
 * and `—` when unreachable, the footer drops the host from its sentence, and the
 * rest of the page is identical either way. A blank landing page is a worse
 * failure than a missing statistic.
 *
 * The fetch itself is free: `AppFrame`'s header already calls `loadCatalogStats`
 * on every screen, and both routes share one memoised request
 * (`src/ui/shell/catalogStats.tsx`). This screen pays only for the Zod parse.
 *
 * ## Crawlers, and the one thing this PR cannot do
 *
 * This is a client-rendered SPA with no SSR, so the copy below reaches a crawler
 * only if it executes JavaScript. The mitigation belongs in `index.html`, which
 * **PR 1 owns and this PR did not touch**. What it wants from that file, so it
 * can be applied there in one edit:
 *
 * ```html
 * <link rel="canonical" href="https://openforge.tools/" />
 * <meta property="og:type" content="website" />
 * <meta property="og:site_name" content="OpenForge Catalog & Workshop" />
 * <meta property="og:title" content="OpenForge Catalog & Workshop" />
 * <meta property="og:description" content="Search 8,700 3D-printable OpenForge
 *   dungeon tiles, keep a library of the ones you print with, and lay out a room
 *   on the workbench." />
 * <meta property="og:url" content="https://openforge.tools/" />
 * <meta name="twitter:card" content="summary_large_image" />
 * ```
 *
 * plus a `<noscript>` inside `<body>` carrying {@link HEADLINE} and {@link LEDE}
 * as real markup and a link to `/catalog`. `og:image` is deliberately absent
 * from the list: there is no share image to point at, and a tag naming a file
 * that 404s is worse than no tag. The hero here is inline SVG, so a rasterised
 * share card is its own small task.
 *
 * The tile count in the description is rounded and approximate on purpose —
 * `index.html` is a static file with no access to the index, and "8,700" stays
 * true across an import that "8,702" would not.
 *
 * ## Semantics
 *
 * A `<section>`, not a `<main>`: `AppFrame` owns the document's one `<main>`
 * landmark. Heading order is `h1` for the hero and `h2` for each card title. The
 * cards are an ordered list, because I/II/III is a real sequence — the intended
 * user journey — and `role="list"` is restated on the `<ol>` because Safari drops
 * list semantics from a list with `list-style: none`.
 */
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { GRID_UNIT_MM } from '@/catalog'
import { MATERIALS } from '@/materials'
import { Chip, Eyebrow, VisuallyHidden, buttonProps } from '@/ui/primitives'
import { loadCatalogIndex } from '@/ui/shell'

import { HeroPlan } from './HeroPlan'
import './landing.css'
import { PLAN_MATERIALS, chamberExtent } from './plan'
import { deriveLandingStats, formatBytes, formatCount } from './stats'
import type { LandingStats } from './stats'
import { usePrefersReducedMotion } from './useReducedMotion'

/* ---------------------------------------------------------------- hero copy */

const HEADLINE = 'Every tile in the archive, ready for your next dungeon.'

const LEDE =
  'Search the OpenForge catalog, curate a library of the tiles you actually print with, ' +
  'then lay out a full room on the workbench — and download exactly the STL files it needs.'

/**
 * The three steps. `numeral` is spelled out rather than generated from the
 * index, because `III` is a label a reader recognises and not a count.
 */
const STEPS = [
  {
    numeral: 'I',
    stage: 'Search',
    title: 'Find the right tile',
    body: 'Filter the whole archive by component, texture set and build system. Every tile turns through ten rendered angles, so you are not choosing a night of printing from one photograph.',
  },
  {
    numeral: 'II',
    stage: 'Curate',
    title: 'Build your library',
    body: 'Keep the tiles you actually print in one place. Your library is the palette you build rooms from, and it survives a reload.',
  },
  {
    numeral: 'III',
    stage: 'Construct',
    title: 'Lay out the room',
    body: 'Snap tiles to the workbench grid in plan view, watch the bill of tiles add up, and take away one zip holding exactly the files your build needs.',
  },
] as const

/* ------------------------------------------------------------------- figures */

/**
 * `loading` before the index resolves, `unavailable` if it never does.
 *
 * `archiveHost` rides along because the footer names it and it comes out of the
 * same document — the same call the header makes for the same reason.
 */
type IndexState =
  | { status: 'loading' }
  | { status: 'ready'; stats: LandingStats; archiveHost: string }
  | { status: 'unavailable' }

interface FigureProps {
  label: string
  state: IndexState
  /** Pulls the figure and its unit out of the stats. Unit is `null` for a count. */
  read: (stats: LandingStats) => { figure: string; unit: string | null }
}

/**
 * One of the four figures: a mono uppercase label over a mono value.
 *
 * The value is mono at 15 px in the mock and considerably larger here, because
 * four numbers on one line at body size is a footnote and these are the page's
 * evidence. The unit is a separate, smaller span so `108.0 GB` sets like a
 * measurement rather than like a word.
 *
 * `…` while loading is the mock's own placeholder (`statTiles: tiles.length ||
 * '…'`). `—` for unavailable is deliberately a different glyph: "still counting"
 * and "cannot count" are different statements, and the layout does not move
 * between them.
 */
function Figure({ label, state, read }: FigureProps) {
  const value = state.status === 'ready' ? read(state.stats) : null

  return (
    <div className="of-figure">
      <dt className="of-figure-label">
        <Eyebrow>{label}</Eyebrow>
      </dt>
      <dd className="of-figure-value">
        {value === null ? (
          <>
            <span aria-hidden="true">{state.status === 'loading' ? '…' : '—'}</span>
            <VisuallyHidden>
              {state.status === 'loading' ? 'counting' : 'not available'}
            </VisuallyHidden>
          </>
        ) : (
          <>
            {value.figure}
            {value.unit === null ? null : <span className="of-figure-unit">{value.unit}</span>}
          </>
        )}
      </dd>
    </div>
  )
}

function HeroFigures({ state }: { state: IndexState }) {
  return (
    <dl className="of-hero-figures" aria-busy={state.status === 'loading'}>
      <Figure
        label="Catalogued tiles"
        state={state}
        read={(stats) => ({ figure: formatCount(stats.tiles), unit: null })}
      />
      <Figure
        label="Texture sets"
        state={state}
        read={(stats) => ({ figure: formatCount(stats.textureSets), unit: null })}
      />
      <Figure
        label="Build systems"
        state={state}
        read={(stats) => ({ figure: formatCount(stats.buildSystems), unit: null })}
      />
      <Figure
        label="STL geometry"
        state={state}
        read={(stats) => {
          const { figure, unit } = formatBytes(stats.bytes)
          return { figure, unit }
        }}
      />
    </dl>
  )
}

/* -------------------------------------------------------------- hero figure */

/**
 * The plan drawing, its measurements and its legend.
 *
 * The measurements are outside the SVG on purpose: at 375 px the drawing renders
 * about 300 px wide, and type set inside a 560-unit viewBox would arrive at
 * 5 px. Out here it stays 11 px at every width, and it is selectable text.
 *
 * The chamber's size is computed from the drawing's own floor pieces, so the
 * caption cannot end up describing a room the plan does not show.
 */
function HeroFigure() {
  const { w, d } = chamberExtent()
  const mm = (units: number) => Math.round(units * GRID_UNIT_MM)

  return (
    <figure className="of-hero-figure">
      <div className="of-hero-well">
        <HeroPlan />
      </div>
      <figcaption className="of-hero-caption">
        <span className="of-hero-caption-facts">
          <Eyebrow>Plan view</Eyebrow>
          <Chip tone="size">{`${String(w)} × ${String(d)} units`}</Chip>
          <span className="of-hero-caption-mm">{`${String(mm(w))} × ${String(mm(d))} mm`}</span>
          <span className="of-hero-caption-mm">{`1 unit = ${String(GRID_UNIT_MM)} mm`}</span>
        </span>
        <ul className="of-hero-legend" role="list">
          {PLAN_MATERIALS.map((material) => (
            <li key={material}>
              <span
                className="of-hero-swatch"
                aria-hidden="true"
                style={{
                  background: MATERIALS[material].tint,
                  borderColor: MATERIALS[material].edge,
                }}
              />
              {MATERIALS[material].label}
            </li>
          ))}
        </ul>
        <p className="of-hero-note">
          Drawn from the two footprint primitives the workbench places, tinted from the same
          material palette it fills them with.
        </p>
      </figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------------- screen */

/**
 * The screen.
 *
 * No injectable loader and no props: it calls `loadCatalogIndex` directly, and
 * the tests stub `fetch` and clear the shared cache with
 * `resetCatalogIndexCache` instead. That way the test exercises the real path —
 * request, memoisation, Zod parse, derivation, render — rather than a seam that
 * only exists to be tested, and the figures are still driven by a supplied
 * document rather than compared against a constant.
 */
export function Landing() {
  const [state, setState] = useState<IndexState>({ status: 'loading' })
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    let alive = true
    loadCatalogIndex().then(
      (file) => {
        if (!alive) return
        setState({
          status: 'ready',
          stats: deriveLandingStats(file),
          archiveHost: new URL(file.assets.models).host,
        })
      },
      (error: unknown) => {
        if (!alive) return
        console.warn('catalog figures unavailable', error)
        setState({ status: 'unavailable' })
      },
    )
    return () => {
      alive = false
    }
  }, [])

  return (
    <section className="of-landing" data-motion={reducedMotion ? 'off' : 'on'}>
      <div className="of-hero">
        <div className="of-hero-copy">
          <Eyebrow as="div" tone="accent" className="of-hero-eyebrow">
            Open-source printable terrain
          </Eyebrow>
          <h1 className="of-hero-title">{HEADLINE}</h1>
          <p className="of-hero-lede">{LEDE}</p>
          <div className="of-hero-actions">
            {/*
              `buttonProps` rather than `<Button>`: these navigate, so they are
              router `Link`s and not `<button>`s — see `Button.tsx` for why the
              styling is published separately from the element. `size: 'lg'` is
              the hero's size, now asked for by name; until row X2 it arrived
              implicitly through the `.of-action` alias.
            */}
            <Link to="/catalog" {...buttonProps({ tone: 'primary', size: 'lg' })}>
              Browse the catalog
            </Link>
            <Link to="/builder" {...buttonProps({ tone: 'secondary', size: 'lg' })}>
              Open the builder
            </Link>
          </div>
          <HeroFigures state={state} />
        </div>
        <HeroFigure />
      </div>

      <ol className="of-steps" role="list">
        {STEPS.map((step) => (
          <li key={step.numeral} className="of-step">
            <Eyebrow as="div" tone="accent" className="of-step-numeral">
              {`${step.numeral} · ${step.stage}`}
            </Eyebrow>
            <h2 className="of-step-title">{step.title}</h2>
            <p className="of-step-body">{step.body}</p>
          </li>
        ))}
      </ol>

      <p className="of-landing-foot">
        OpenForge tiles by Masterwork Tools
        {state.status === 'ready' ? (
          <>
            {' · STLs served from '}
            <span className="of-landing-host">{state.archiveHost}</span>
          </>
        ) : null}
        {' · this catalog covers the organised, tagged portion of the archive — untagged files ' +
          'exist in storage and are not reachable here yet.'}
      </p>
    </section>
  )
}
