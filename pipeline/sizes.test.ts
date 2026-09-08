/**
 * The assembly size domains, against the live archive.
 *
 * Skips loudly without `public/catalog/catalog.json`, the precedent every other
 * corpus block in this repo sets. What it proves is the property the project
 * owner asked for and nothing weaker: **an assembly placed at a position of its
 * size control has a fixed size, whatever fills its slots.**
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CatalogFile } from '../src/catalog'
import { footprintKey } from '../src/assembly/footprint'
import { resolveSlotTags } from '../src/composition/config'

import { foldRecipes } from './fold'
import { deriveAssemblySizes } from './sizes'
import { loadTemplateFixtures, templateFixturesDir } from './templates'

const CATALOG = 'public/catalog/catalog.json'
const hasCatalog = existsSync(CATALOG)
const describeCorpus = hasCatalog ? describe : describe.skip

describeCorpus(
  hasCatalog
    ? 'the assembly size domains against the live archive'
    : `the assembly size domains — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`,
  () => {
    const file = CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
    const sized = deriveAssemblySizes(foldRecipes(loadTemplateFixtures(templateFixturesDir())), file)
    const tagId = new Map(file.tags.map((tag, id) => [tag, id]))

    const matching = (require: readonly string[], deny: readonly string[]) => {
      const want = require.map((tag) => tagId.get(tag))
      if (want.some((id) => id === undefined)) return []
      const refuse = deny.map((tag) => tagId.get(tag)).filter((id): id is number => id !== undefined)
      return file.records.filter((record) => {
        const owned = new Set<number>(record.tags)
        return want.every((id) => id !== undefined && owned.has(id)) && !refuse.some((id) => owned.has(id))
      })
    }

    it('gives all 10 assemblies a domain, and no domain is empty', () => {
      expect(sized).toHaveLength(10)
      for (const assembly of sized) {
        expect(assembly.controls.size.length, assembly.id).toBeGreaterThan(0)
      }
    })

    it('carries no any-size position, so every assembly placement is sized', () => {
      /* The decision this row implements, stated as a property rather than as a
         count: the 47 families keep their `any size` because 7 of them have a
         size no tag can name, and an assembly has no such excuse. */
      for (const assembly of sized) {
        expect(assembly.controls.size.filter((position) => position.tags.length === 0), assembly.id).toEqual(
          [],
        )
      }
    })

    it('names a width and a depth on every position, never a width alone', () => {
      /* A width-only position is what leaves size floating — measured over the
         family domains, 24 of the 47 such positions span two to seven depths. */
      for (const assembly of sized) {
        for (const position of assembly.controls.size) {
          expect(position.tags.filter((tag) => tag.startsWith('size|width|')), position.label).toHaveLength(1)
          expect(position.tags.filter((tag) => tag.startsWith('size|depth|')), position.label).toHaveLength(1)
        }
      }
    })

    it('fills every slot at every position of every domain', () => {
      const empty: string[] = []
      for (const assembly of sized) {
        for (const position of assembly.controls.size) {
          for (const slot of assembly.parts) {
            const resolved = resolveSlotTags(slot.tags, [...assembly.tags, ...position.tags], [])
            if (matching(resolved.require, resolved.deny).length === 0) {
              empty.push(`${assembly.id} / ${position.label} / ${slot.name}`)
            }
          }
        }
      }
      expect(empty).toEqual([])
    })

    it('pins the cell slot to exactly one footprint at every position', () => {
      /* **The property the row exists for.** The floor is the cell slot on all
         three conventions, so its footprint *is* the assembly's size — and at a
         position of the control it has exactly one, whatever else the user picks. */
      const floating: string[] = []
      for (const assembly of sized) {
        const floor = assembly.parts.find((part) => part.name === 'floor')
        if (floor === undefined) continue
        for (const position of assembly.controls.size) {
          const resolved = resolveSlotTags(floor.tags, [...assembly.tags, ...position.tags], [])
          const feet = new Set(
            matching(resolved.require, resolved.deny).map(
              (record) => footprintKey(record.foot) ?? record.foot.shape,
            ),
          )
          if (feet.size !== 1) floating.push(`${assembly.id} / ${position.label}: ${[...feet].join(', ')}`)
        }
      }
      expect(floating).toEqual([])
    })

    it('reports what the domains came out as, because the numbers are the argument', () => {
      const rows = sized.map(
        (assembly) =>
          `  ${assembly.id.padEnd(46)} ${String(assembly.controls.size.length).padStart(2)} positions  ` +
          assembly.controls.size.map((position) => position.label.replace(/ wide by | deep/g, 'x')).join(' '),
      )
      process.stdout.write(`\n[fold] assembly size domains\n${rows.join('\n')}\n`)
      expect(rows).toHaveLength(10)
    })
  },
)
