/**
 * A folded assembly's size domain, derived from the corpus.
 *
 * Split from `pipeline/fold.ts` so that the fold itself stays pure over the
 * fixtures and `fold.test.ts` needs no `catalog.json` to run. What is here needs
 * the archive: whether a `(width, depth)` pair leaves every slot a candidate,
 * and whether it pins the assembly to one footprint, are both facts about
 * records rather than about the recipe.
 *
 * ## Every position names both spans, and there is no `any size`
 *
 * The 47 generated families each carry an `any size` position and keep it: 7 of
 * them have a size no `size|` tag can name, so forcing a choice on a family
 * would make those rows unplaceable. An **assembly** is the opposite case — the
 * project owner asked that an assembly always have a fixed size no matter the
 * slot selection — so a domain here is only the pairs that pin, and a template
 * whose domain comes out empty fails the import rather than shipping a row
 * nobody can place.
 *
 * That is also why a width-only `run` position has no place here.
 * `families.ts#positionFor` falls back to one when a cell is inexpressible, and
 * measured over the family domains 24 of the 47 such positions span two to
 * seven depths. A position that admits four depths is exactly what
 * *"no matter the slot selection"* rules out.
 *
 * ## What pinning means, and what it deliberately does not
 *
 * A position pins when the **cell slot** — `rules.ts`' `layout.cell`, the `floor`
 * on all three conventions — admits exactly one footprint. The wall slot beside
 * it may still admit several *geometries* at a pinned size: at 2 x 2 it offers a
 * straight `wall:2`, four diagonals across the same square and one triangle. All
 * of those occupy the 2 x 2 cell, so the assembly's size is fixed and its wall's
 * shape is not. That is a shape choice inside a fixed size and this module does
 * not try to remove it.
 */
import type { CatalogFile, CatalogRecord } from '../src/catalog'
import { footprintKey } from '../src/assembly/footprint'
import { resolveSlotTags } from '../src/composition/config'
import type { SlotName } from '../src/template/rules'
import { conventionFor } from '../src/template/rules'
import { formatUnits, sizeRefs, sizeRefsResolve } from '../src/template/size'

import type { ControlPosition, FoldedAssembly } from './fold'
import { resolveGridSize } from './size'

/** Records by tag string, so a resolved slot is one intersection rather than a scan. */
interface Corpus {
  readonly records: readonly CatalogRecord[]
  readonly tags: readonly string[]
  readonly has: (tag: string) => boolean
  readonly tagsOf: (record: CatalogRecord) => readonly string[]
  readonly matching: (require: readonly string[], deny: readonly string[]) => readonly CatalogRecord[]
}

function corpusOf(file: CatalogFile): Corpus {
  const index = new Map(file.tags.map((tag, id) => [tag, id]))
  const tagsOf = (record: CatalogRecord): readonly string[] =>
    record.tags.map((id) => file.tags[id] ?? '').filter((tag) => tag !== '')
  return {
    records: file.records,
    tags: file.tags,
    has: (tag) => index.has(tag),
    tagsOf,
    matching: (require, deny) => {
      const want = require.map((tag) => index.get(tag))
      // A ref the table does not hold admits nothing, which is the honest answer
      // and the one `candidates.ts` gives it.
      if (want.some((id) => id === undefined)) return []
      const refuse = deny.map((tag) => index.get(tag)).filter((id): id is number => id !== undefined)
      return file.records.filter((record) => {
        /* `Set<number>` and not `Set<TagId>`: `CatalogRecord.tags` is branded and
           the table's own positions are not, so the widened set is what lets one
           lookup serve both without a cast at every call. */
        const owned = new Set<number>(record.tags)
        return want.every((id) => id !== undefined && owned.has(id)) && !refuse.some((id) => owned.has(id))
      })
    },
  }
}

/** One slot's candidates under a template's tags plus a position. */
function candidatesFor(
  corpus: Corpus,
  assembly: FoldedAssembly,
  slot: FoldedAssembly['parts'][number],
  position: readonly string[],
): readonly CatalogRecord[] {
  const parentTags = [...assembly.tags, ...position]
  /* The app's own resolver, so a `constrain` block is read here exactly as
     `fill.ts` reads it — including the specificity filter and the sibling
     defaults. No siblings are passed: a domain is a property of the template and
     not of a half-made choice. */
  const resolved = resolveSlotTags(slot.tags, parentTags, [])
  return corpus.matching(resolved.require, resolved.deny)
}

/** The cell slot's name — `layout.cell`, and `floor` on all three conventions. */
function cellSlotOf(assembly: FoldedAssembly): SlotName {
  const layout = conventionFor(assembly.parts.map((part) => part.name))
  if (layout === undefined) {
    throw new Error(`${assembly.id} has no layout convention, so it has no cell slot to size against`)
  }
  return layout.cell
}

/**
 * The size domain of one assembly: every `(width, depth)` pair that leaves each
 * slot a candidate and pins the cell slot to one footprint.
 *
 * The candidate pairs come from the cell slot's **own** records — their resolved
 * grid size, `pipeline/size.ts#resolveGridSize`, the same reading the family
 * domains use — so the domain is what the archive has rather than a cross
 * product of the tag values.
 */
function domainOf(corpus: Corpus, assembly: FoldedAssembly): readonly ControlPosition[] {
  const cellSlot = cellSlotOf(assembly)
  const slot = assembly.parts.find((part) => part.name === cellSlot)
  if (slot === undefined) throw new Error(`${assembly.id} declares no ${cellSlot} slot`)

  const cells = new Map<string, { w: number; d: number }>()
  for (const record of candidatesFor(corpus, assembly, slot, [])) {
    const size = resolveGridSize(record.foot, corpus.tagsOf(record))
    if (size === undefined) continue
    cells.set(`${String(size.w)}x${String(size.d)}`, size)
  }

  const positions: ControlPosition[] = []
  for (const { w, d } of [...cells.values()].sort((a, b) => a.w - b.w || a.d - b.d)) {
    const predicate = { kind: 'cell', w, d } as const
    if (!sizeRefsResolve(predicate, corpus.has)) continue
    const tags = sizeRefs(predicate).require

    const perSlot = assembly.parts.map((part) => candidatesFor(corpus, assembly, part, tags))
    // Every slot has to have something, or the position is a row that cannot be
    // filled — which is the one thing a domain must not offer.
    if (perSlot.some((candidates) => candidates.length === 0)) continue

    const cellCandidates = perSlot[assembly.parts.indexOf(slot)] ?? []
    const feet = new Set(
      cellCandidates.map((record) => footprintKey(record.foot) ?? record.foot.shape),
    )
    if (feet.size !== 1) continue

    positions.push({ label: `${formatUnits(w)} wide by ${formatUnits(d)} deep`, tags })
  }

  return positions
}

/**
 * The 10, with their size domains filled in.
 *
 * Throws on an empty domain rather than emitting one. An assembly with no size
 * has no `any size` position to fall back on — that is the decision this row
 * implements — so an empty domain is a palette row that can be armed and never
 * placed, and it must fail the import loudly instead of reaching a user.
 */
export function deriveAssemblySizes(
  folded: readonly FoldedAssembly[],
  file: CatalogFile,
): readonly FoldedAssembly[] {
  const corpus = corpusOf(file)
  return folded.map((assembly) => {
    const size = domainOf(corpus, assembly)
    if (size.length === 0) {
      throw new Error(
        `${assembly.id} has no size position that fills every slot and pins one footprint, so it ` +
          `cannot be placed at any size. An assembly carries no "any size" position by design.`,
      )
    }
    return { ...assembly, controls: { ...assembly.controls, size } }
  })
}
