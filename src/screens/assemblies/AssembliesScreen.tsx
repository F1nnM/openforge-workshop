/**
 * `/assemblies` — the 40 recipe templates, picked through one part at a time.
 *
 * `assembly.ts` carries the semantics and every measurement. This file is the
 * control, and five decisions in it are worth stating.
 *
 * ## The narrowing is *disclosed*, not implied
 *
 * The whole capability of this screen is that a pick makes the next part
 * smaller — 8,645 of 11,938 observations, median 4.0× — and the honest way to
 * show that is to say the two numbers. So a step reads *"27 items fit, over 27
 * files. Narrowed from 88 by what you have already chosen."*, and a card reads
 * *"Narrows floor 88 to 27."* before it is pressed. A progress bar would be the
 * wrong control twice over: the narrowing is front-loaded — the first pick does
 * 72 of the 90 narrowings and the third onward do none — so a bar would flatten
 * out and look broken, and it would put a shape on the flow instead of a fact on
 * the part.
 *
 * ## One step open at a time, and the page inside it
 *
 * Both bounds are about the same hazard C2 named: a sprite sheet is 2,560×1,024
 * and decodes to roughly **10.5 MB**, so the largest grid here — 428 items on
 * `Wall (Any, Modular)` — would be about **4.5 GB** of bitmap if it all mounted.
 * The open step defaults to `state.next`, so a five-part recipe decodes one grid
 * rather than five, and {@link STEP_PAGE} bounds that one.
 *
 * It is a page and not a virtualiser deliberately. `VirtuosoGrid` measures one
 * item and extrapolates, which is a scroll-position estimate jsdom cannot
 * exercise at all — the catalog grid needs it for 3,822 items and pays for a
 * `VirtuosoGridMockContext` in its tests to get near it. Here **only 4 of the
 * 128 parts exceed one page when walked in order** (39 do cold), so a "show the
 * next 48" button covers the corpus and is a control a test can actually press.
 *
 * ## A dead end is `aria-disabled`, never `disabled`
 *
 * C2's rule and its reasoning, unchanged: `disabled` takes the button out of the
 * tab order and its accessible name with it, so a screen-reader user would meet
 * a grid that silently has fewer members. A dead end stays focusable, carries
 * `aria-disabled="true"`, and its `aria-label` states the consequence. The click
 * handler declines rather than the attribute preventing.
 *
 * Every reason rides in an `aria-label` rather than in a `VisuallyHidden` span,
 * following A5 and C2 — D6's `VisuallyHidden` is `position: fixed` with pinned
 * offsets, and a scrolling grid cell is the last place to discover what that does
 * to a clipped span.
 *
 * ## The choice is component state, and the completed assembly goes to the library
 *
 * `@/store`'s docblock is explicit that everything in `WorkshopState` is
 * persisted and that ephemeral UI state belongs in a component, so the choice
 * lives here, keyed by {@link assemblyStepKey}. What a *finished* recipe can
 * honestly do is put its files in the library — the same destination C2's builder
 * panel uses for the same reason, and the one place in this app where "these are
 * the tiles I am going to print" is already modelled.
 *
 * ## It has no route yet, and that is one line in a file this row does not own
 *
 * `src/routes/**` is row A4's. The route this screen needs is
 * `createRoute({ getParentRoute: () => rootRoute, path: '/assemblies', component: AssembliesScreen })`
 * plus its name in `routeTree.addChildren`, and no search params — for
 * `/library`'s reason, that there is nothing on this screen worth linking but the
 * screen itself. The selected recipe is deliberately *not* a search param: A4's
 * argument that a link must not freeze a preference applies exactly, and a
 * half-finished pick set in a URL is a preference of the worst kind.
 *
 * The deleted `/settings` route shipped in the same position and was called out
 * in that row's report the same way. (Row X9 mounted this screen; row L1 deleted
 * `/settings`, so the precedent survives only as a note.)
 */
import { useMemo, useState } from 'react'

import type { CatalogFile, DesignId, TileId } from '@/catalog'
import type { MaterialId } from '@/materials'
import { useCatalogIndex } from '@/screens/catalog'
import { SlotFills, compositionIndexFor, tileMaterials } from '@/screens/detail/slots'
import { addToLibrary } from '@/store'
import { Button, Chip, Eyebrow } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { AssemblyChoice, AssemblyOption, AssemblyStep, RecipeTemplate } from './assembly'
import {
  STEP_PAGE,
  assemblyState,
  assemblyStepKey,
  createRecipeIndex,
  deadEndSentence,
  emptyStepSentence,
  narrowingSentence,
  stepCountSentence,
} from './assembly'
import { RECIPE_TEMPLATES } from './templates'

import './assemblies.css'

/**
 * The two build kinds, read off the templates' own tags rather than parsed out
 * of their names.
 *
 * 20 recipes carry `build|s2w|single_piece` and 20 carry `build|s2w|modular`, and
 * the distinction is the one that matters most before you pick: a single-piece
 * wall brings its own base, a modular one needs a separate one. Grouping on the
 * tag means a fixture that added a third kind would group rather than fall into
 * whichever bucket a substring match guessed.
 */
const BUILD_KINDS = [
  { tag: 'build|s2w|single_piece', label: 'Single piece' },
  { tag: 'build|s2w|modular', label: 'Modular' },
] as const

function kindOf(template: RecipeTemplate): string {
  return BUILD_KINDS.find((kind) => template.tags.includes(kind.tag))?.label ?? 'Other'
}

export function AssembliesScreen() {
  const state = useCatalogIndex()
  const [openId, setOpenId] = useState<string | null>(null)
  const [choices, setChoices] = useState<Readonly<Record<string, TileId>>>({})

  const template = RECIPE_TEMPLATES.find((entry) => entry.id === openId)

  return (
    <section aria-labelledby="of-asm-heading" className="of-asm">
      <header className="of-asm-head">
        <h1 className="of-asm-title" id="of-asm-heading">
          Guided assemblies
        </h1>
        <p className="of-asm-summary">
          {`${String(RECIPE_TEMPLATES.length)} recipes from the archive's own blueprint fixtures. `}
          Each names the parts a piece is built from; choosing one part narrows the rest, and the
          choices that lead nowhere are greyed before you make them.
        </p>
      </header>

      {state.status === 'error' ? (
        <p className="of-asm-note">
          {`The catalog index did not load: ${state.error.message}`}{' '}
          <button className="of-asm-inline" onClick={state.retry} type="button">
            Try again
          </button>
        </p>
      ) : null}

      {template === undefined ? (
        <RecipeList
          onOpen={(id) => {
            setOpenId(id)
          }}
        />
      ) : (
        <Recipe
          catalog={state.status === 'ready' ? state.index.file : undefined}
          choices={choices}
          onBack={() => {
            setOpenId(null)
          }}
          onChoose={(key, tile) => {
            setChoices((prev) => {
              const next = { ...prev }
              if (tile === undefined) delete next[key]
              else next[key] = tile
              return next
            })
          }}
          template={template}
        />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ the list */

/**
 * The 40 recipes, grouped by build kind.
 *
 * No thumbnails: a template is not a file and has no sprite of its own, so
 * there is nothing to render but its name and its parts. That is also why this
 * list needs no catalog — it is the one part of the screen that works before the
 * 5.6 MB index has landed.
 */
function RecipeList({ onOpen }: { onOpen: (id: string) => void }) {
  const groups = BUILD_KINDS.map((kind) => ({
    label: kind.label,
    templates: RECIPE_TEMPLATES.filter((template) => template.tags.includes(kind.tag)),
  })).filter((group) => group.templates.length > 0)

  return (
    <div className="of-asm-groups">
      {groups.map((group) => (
        <div className="of-asm-group" key={group.label}>
          <Eyebrow as="h2" className="of-asm-grouphead">
            {`${group.label} — ${String(group.templates.length)}`}
          </Eyebrow>
          <ul className="of-asm-list">
            {group.templates.map((template) => (
              <li key={template.id}>
                <button
                  className="of-asm-recipe"
                  onClick={() => {
                    onOpen(template.id)
                  }}
                  type="button"
                >
                  <span className="of-asm-recipename">{template.name}</span>
                  <span className="of-asm-recipeparts">
                    {template.parts.map((part) => part.name).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- one recipe */

function Recipe({
  catalog,
  choices,
  onBack,
  onChoose,
  template,
}: {
  catalog: CatalogFile | undefined
  choices: Readonly<Record<string, TileId>>
  onBack: () => void
  onChoose: (key: string, tile: TileId | undefined) => void
  template: RecipeTemplate
}) {
  /* C2's `compositionIndexFor` rather than a second `createCompositionIndex`:
     it is a `WeakMap` on the parsed file, so this screen and the tile drawer
     share one 409,432-byte inverted index and one 10.7 ms build. */
  const recipes = useMemo(
    () => (catalog === undefined ? undefined : createRecipeIndex(catalog, compositionIndexFor(catalog))),
    [catalog],
  )

  /* C2's `tileMaterials` rather than a second record join: an `AssemblyOption`'s
     variant carries no tags, and `resolveMaterial` needs the full de-interned
     list because the `texture` shortcut is wrong on 691 of 8,702 records. Lazy
     for the same reason it is there — a recipe nobody opens builds no map. */
  const materialOf = useMemo(() => (catalog === undefined ? null : tileMaterials(catalog)), [catalog])

  /* Only this recipe's part names, so switching recipes cannot carry a pick
     across. The key is `(template, part)`; see `assembly.ts` on why that needs
     nothing private from A1. */
  const choice: AssemblyChoice = useMemo(() => {
    const out: Record<string, TileId> = {}
    for (const part of template.parts) {
      const tile = choices[assemblyStepKey(template, part.name)]
      if (tile !== undefined) out[part.name] = tile
    }
    return out
  }, [choices, template])

  // Recomputed on every pick, because that is the row: median 11.3 ms, worst 86.2.
  const state = useMemo(
    () => (recipes === undefined ? undefined : assemblyState(recipes, template, choice)),
    [choice, recipes, template],
  )

  const [opened, setOpened] = useState<string | null>(null)
  const open = opened ?? state?.next ?? null

  return (
    <div className="of-asm-recipeview">
      <Button className="of-asm-back" onClick={onBack} size="sm" tone="secondary">
        ← All recipes
      </Button>

      <Eyebrow as="h2" className="of-asm-openname">
        {template.name}
      </Eyebrow>
      <p className="of-asm-note">
        {`${kindOf(template)} · ${String(template.parts.length)} parts · from ${template.source}`}
      </p>

      {state === undefined ? (
        <p className="of-asm-note">Loading the catalog index…</p>
      ) : (
        <>
          <p className="of-asm-progress">
            {`${String(state.filled)} of ${String(template.parts.length)} parts answered.`}
            {state.redundant.length === 0
              ? ''
              : ` ${state.redundant.join(' and ')} ${state.redundant.length === 1 ? 'holds a choice' : 'hold choices'} nothing needs any more.`}
          </p>

          {state.steps.map((step) => (
            <Step
              catalog={catalog}
              key={step.key}
              materialOf={materialOf}
              onChoose={(tile) => {
                onChoose(step.key, tile)
              }}
              onOpen={() => {
                setOpened(step.name)
              }}
              open={open === step.name}
              step={step}
            />
          ))}

          {state.complete ? <Finished catalog={catalog} tiles={state.tiles} /> : null}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ one step */

function Step({
  catalog,
  materialOf,
  onChoose,
  onOpen,
  open,
  step,
}: {
  catalog: CatalogFile | undefined
  /** `null` exactly when `catalog` is undefined — see {@link Recipe}. */
  materialOf: ((id: TileId) => MaterialId) | null
  onChoose: (tile: TileId | undefined) => void
  onOpen: () => void
  open: boolean
  step: AssemblyStep
}) {
  const [pages, setPages] = useState(1)
  const shown = step.options.slice(0, pages * STEP_PAGE)
  const dead = step.options.filter((option) => option.deadEnd).length
  const label = `Choose the ${step.name}`

  return (
    /* `role="group"` and not a `<section>`, for C2's reason: a named section is a
       landmark, and a five-part recipe would put five regions in the rotor. */
    <div aria-label={label} className="of-asm-step" data-open={open ? '' : undefined} role="group">
      <Eyebrow as="p" className="of-asm-stephead">
        {step.name}
      </Eyebrow>

      {step.coveredBy === undefined ? (
        <p className="of-asm-note">{step.deadEnd ? emptyStepSentence(step) : stepCountSentence(step)}</p>
      ) : (
        <p className="of-asm-note">
          {`Covered by the ${step.coveredBy} you chose — it stands in for this part, so there is nothing to pick.`}
          {step.redundant ? ' The choice still here is no longer needed.' : ''}
        </p>
      )}

      {step.redundant ? (
        <Button
          onClick={() => {
            onChoose(undefined)
          }}
          size="sm"
          tone="secondary"
        >
          {`Drop the ${step.name}`}
        </Button>
      ) : null}

      {step.coveredBy !== undefined || step.deadEnd ? null : open ? (
        <>
          <ul className="of-asm-grid">
            {shown.map((option) => (
              <li key={String(option.address)}>
                <OptionCard
                  catalog={catalog}
                  chosen={option.variant.id === step.chosen}
                  materialOf={materialOf}
                  onChoose={() => {
                    onChoose(option.variant.id === step.chosen ? undefined : option.variant.id)
                  }}
                  option={option}
                />
              </li>
            ))}
          </ul>
          {shown.length < step.options.length ? (
            <Button
              onClick={() => {
                setPages((value) => value + 1)
              }}
              size="sm"
              tone="secondary"
            >
              {`Show ${String(Math.min(STEP_PAGE, step.options.length - shown.length))} more of ${String(step.options.length)}`}
            </Button>
          ) : null}
          {dead === 0 ? null : (
            <p className="of-asm-note">
              {`${String(dead)} of these would leave another part with nothing to fill it, and ${dead === 1 ? 'is' : 'are'} greyed.`}
            </p>
          )}
        </>
      ) : (
        <Button onClick={onOpen} size="sm" tone="secondary">
          {step.chosen === undefined
            ? `Choose — ${String(step.options.length)} to pick from`
            : `Filled — change`}
        </Button>
      )}

      {/*
        The chosen file's own accessory slots, handed to C2's picker rather than
        re-rendered here. `nested` is the same list with this part's `fulfills`
        applied, and it is the gate: `SlotFills` decides for itself which slots to
        offer, so asking it only when there is something left to offer keeps the
        two rows from disagreeing about an empty panel.
      */}
      {step.chosen !== undefined && step.nested.length > 0 ? (
        <div className="of-asm-nested">
          <p className="of-asm-note">
            {`The ${step.name} you chose is itself a composition.`}
            {step.covered.length === 0
              ? ''
              : ` Its ${step.covered.join(' and ')} is covered by this recipe's ${step.name} part.`}
          </p>
          <SlotFills catalog={catalog} parent={step.chosen} />
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ one card */

function OptionCard({
  catalog,
  chosen,
  materialOf,
  onChoose,
  option,
}: {
  catalog: CatalogFile | undefined
  chosen: boolean
  materialOf: ((id: TileId) => MaterialId) | null
  onChoose: () => void
  option: AssemblyOption
}) {
  const reason = deadEndSentence(option)
  const narrowing = narrowingSentence(option)

  return (
    <button
      aria-disabled={option.deadEnd ? true : undefined}
      aria-label={cardLabel(option, reason, narrowing)}
      aria-pressed={option.deadEnd ? undefined : chosen}
      className="of-asm-card"
      data-dead={option.deadEnd ? '' : undefined}
      onClick={() => {
        // Declined rather than prevented: see the module note on `aria-disabled`.
        if (!option.deadEnd) onChoose()
      }}
      type="button"
    >
      {catalog === undefined || materialOf === null ? null : (
        <TileThumb
          assets={catalog.assets}
          blob={option.variant.blob}
          material={materialOf(option.variant.id)}
          sheet={catalog.sprite}
          sprite={option.variant.sprite}
          thumb={option.variant.thumb}
        />
      )}
      <span className="of-asm-cardname">{option.aggregate.name}</span>
      {option.deadEnd ? <span className="of-asm-why">{reason}</span> : null}
      {narrowing === '' ? null : (
        <span className="of-asm-why" data-tone="narrow">
          {narrowing}
        </span>
      )}
    </button>
  )
}

/** The accessible name of a card: what it is, which file, and what it would do. */
function cardLabel(option: AssemblyOption, reason: string, narrowing: string): string {
  const parts = [option.aggregate.name, option.variant.file]
  if (option.deadEnd) parts.push(`unavailable — ${reason}`)
  else if (narrowing !== '') parts.push(narrowing)
  return parts.join(' — ')
}

/* ----------------------------------------------------------------- the finish */

/**
 * What a finished recipe offers.
 *
 * The library and nothing else, for C2's reason: `WorkshopState` holds a library
 * and placements, the bill of tiles is built from placements, and row G5 owns the
 * selection channel. A recipe is a set of files to print, which is exactly what
 * the library is for.
 *
 * **The two counts can differ, and both are shown.** A recipe names *files* —
 * that is what a composition resolves to and what the list below prints — while
 * row V1 made the library a set of *items*. Two parts of one recipe can be two
 * prints of the same design, so "5 files to print" can be four items saved, and
 * a button that said "add all" while quietly saving fewer keys than the list has
 * rows would be lying about what it did. The saved count is therefore stated
 * rather than assumed, and it is the same collapse the whole V row exists for.
 *
 * `catalog` may be `undefined` — the screen renders the template list before the
 * 5.6 MB index lands — but not here: a recipe cannot *complete* without the
 * index it was resolved against. The guard is a type obligation rather than a
 * reachable state, and it disables the button instead of saving nothing, because
 * a press that silently did nothing is the one outcome with no honest label.
 */
function Finished({ catalog, tiles }: { catalog: CatalogFile | undefined; tiles: readonly TileId[] }) {
  const [added, setAdded] = useState(false)

  // One pass over the index per completed recipe, keyed on the two inputs, so
  // pressing the button twice does not re-derive and neither does a re-render.
  const designs = useMemo(() => {
    if (catalog === undefined) return null
    const wanted = new Set<string>(tiles)
    const out = new Set<DesignId>()
    for (const record of catalog.records) if (wanted.has(record.id)) out.add(record.design)
    return [...out]
  }, [catalog, tiles])

  return (
    <div className="of-asm-done">
      <Chip>Complete</Chip>
      <p className="of-asm-note">
        {`${String(tiles.length)} ${tiles.length === 1 ? 'file' : 'files'} to print`}
        {designs === null || designs.length === tiles.length
          ? '.'
          : `, ${String(designs.length)} ${designs.length === 1 ? 'item' : 'items'} to save.`}
      </p>
      <ul className="of-asm-bill">
        {tiles.map((tile) => (
          <li key={tile}>{tile}</li>
        ))}
      </ul>
      <Button
        disabled={designs === null}
        onClick={() => {
          if (designs === null) return
          for (const design of designs) addToLibrary(design)
          setAdded(true)
        }}
        tone="primary"
      >
        {added ? 'Added to your library' : 'Add all to library'}
      </Button>
    </div>
  )
}
