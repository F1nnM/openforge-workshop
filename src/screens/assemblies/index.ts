/**
 * Guided assemblies, as one import: `import { AssembliesScreen } from '@/screens/assemblies'`.
 *
 * Row C3 — **the 40 recipe templates as first-class objects**. Four things live
 * behind this barrel and the split is by kind:
 *
 *   - `templates.ts` — the 40, as generated data. Not in `catalog.json`: none of
 *     them carries `file_metadata`, so none is an STL and none is a
 *     `CatalogRecord`.
 *   - `fixtures.ts` — the strict reader that produced it, with the round-trip
 *     proof that it lost nothing. Node-only, imported by the tests alone.
 *   - `assembly.ts` — pure and headless. Resolves a recipe's parts against a
 *     choice, works out which cards lead nowhere, and reports what each card
 *     would narrow.
 *   - `AssembliesScreen.tsx` — the control.
 *
 * ## What the row measured, and what it changed
 *
 * The row was written as *"with progressive narrowing"*, and row C2 had already
 * measured **0 narrowings in 33,221 sibling-effect observations** on tile
 * parents. Both hold, of different parents: over the templates the same method
 * gives **8,645 narrowings in 11,938 observations** — 72.4%, median 4.0× — and
 * the mechanism is that a template's own tags share **no root** with its
 * `constrain` entries, where a tile's share all of them. `assembly.ts` carries
 * the argument and `measure.ts` computes every figure in it.
 *
 * The user-facing size of that: walked cold, **39 of the 128 parts** would need
 * more than one page of cards. Walked in the recipe's declared order, so each
 * part is narrowed by the ones before it, **4 do**.
 *
 * ## What this row does not own
 *
 *   - **`@/composition`** is C1's — `constrain` semantics, the inverted index,
 *     the 0-byte argument. Imported, never modified. `resolveSlotTags` and
 *     `candidatesFor` are the whole interface this row needs, and it needs them
 *     precisely because a template is not a file: C2's picker takes a `TileId`
 *     parent and a template has no id in the manifest.
 *   - **C2's picker** is imported for two things and reimplemented for neither:
 *     `compositionIndexFor`, so the two screens share one inverted index, and
 *     `SlotFills`, for the accessory slots of a *chosen file*. One level, which
 *     is as deep as the archive goes.
 *   - **A1's private `slotKey`** is not needed. C2 flagged this row as the one
 *     most likely to want it; the parent here is a template, whose part names are
 *     unique within it (0 duplicates over 128), so `(template, part)` is total
 *     without it.
 *   - **The route.** `src/routes/**` is A4's, and this screen has no `path`
 *     entry yet. `AssembliesScreen.tsx` names the exact declaration; it is one
 *     `createRoute` and one array member, with no search params.
 */
export type {
  AssemblyChoice,
  AssemblyOption,
  AssemblyState,
  AssemblyStep,
  RecipeIndex,
  RecipeTemplate,
  StepNarrowing,
  TemplatePart,
} from './assembly'
export {
  STEP_PAGE,
  assemblyState,
  assemblyStepKey,
  createRecipeIndex,
  deadEndSentence,
  emptyStepSentence,
  narrowingSentence,
  resolvePart,
  stepCountSentence,
} from './assembly'

export { RECIPE_TEMPLATES } from './templates'

export { AssembliesScreen } from './AssembliesScreen'
