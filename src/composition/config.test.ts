/**
 * The catalog frontend's 69 tests, ported.
 *
 * **All 69 came across, none dropped.** They are two files upstream and one here:
 *
 *   - `openforge-catalog/src/utils/__tests__/config-processing.test.ts` — 34
 *     tests, 22 on `processConfigValues` and 12 on `createDeepLink`.
 *   - `openforge-catalog/src/utils/__tests__/config-spec-compliance.test.ts` —
 *     35 tests, scoring the same function against `docs/config-spec.md` clause by
 *     clause.
 *
 * The two `describe` blocks below are kept in their upstream order and with their
 * upstream titles, so a reviewer can diff them against the source line for line.
 * What changed, and it is all of what changed:
 *
 *   - `jest` globals → `vitest` imports.
 *   - `ConfigTags` → {@link SlotTags}. Same fields, and `PartSlot['tags']` from
 *     `@/catalog` is assignable to it.
 *   - `processConfigValues(configValues, parentTags, siblingSelections)` keeps its
 *     name, its argument order and its defaults.
 *
 * Nothing was relaxed and no expectation was rewritten. Two of the upstream
 * assertions are worth flagging because they are easy to read as bugs and are
 * not:
 *
 *   - `'always includes exact matches for constraint tags'` expects **both**
 *     `texture` and `texture|stone` out of a sibling carrying `texture`,
 *     `texture|stone` and `texture|stone|rough`. The exact match is unconditional
 *     and the specificity filter runs only over the strict prefixes.
 *   - `'should handle complex inheritance scenarios for backend'` expects
 *     `connection` to inherit from the parent **and** from the named sibling.
 *     `siblings: [...]` restricts which siblings are read; it does not imply
 *     `parent: false`. Upstream even says so in a comment, and the corpus never
 *     exercises it — zero live `constrain` entries carry either property.
 *
 * The three tests appended at the end are **not** part of the 69. They cover the
 * two places this port is wider than its source — `accept`, which the catalog
 * leaves to its backend, and `nestedSlots`, which upstream never tested.
 */
import { describe, expect, it } from 'vitest'

import type { SlotTags } from './config'
import { createDeepLink, nestedSlots, processConfigValues, resolveSlotTags } from './config'

/* ------------------------------------------------- config-processing.test.ts */

describe('config-processing', () => {
  describe('processConfigValues', () => {
    it('returns empty arrays when configValues is null', () => {
      const result = processConfigValues(null)
      expect(result).toEqual({ require: [], deny: [] })
    })

    it('processes require tags correctly', () => {
      const configValues: SlotTags = {
        require: [{ tag: 'required1' }, { tag: 'required2' }],
        deny: [],
        accept: [],
        constrain: [],
      }

      expect(processConfigValues(configValues)).toEqual({
        require: ['required1', 'required2'],
        deny: [],
      })
    })

    it('processes deny tags correctly', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [{ tag: 'denied1' }, { tag: 'denied2' }],
        accept: [],
        constrain: [],
      }

      expect(processConfigValues(configValues)).toEqual({
        require: [],
        deny: ['denied1', 'denied2'],
      })
    })

    it('processes require and deny tags together', () => {
      const configValues: SlotTags = {
        require: [{ tag: 'required1' }, { tag: 'required2' }],
        deny: [{ tag: 'denied1' }, { tag: 'denied2' }],
        accept: [],
        constrain: [],
      }

      expect(processConfigValues(configValues)).toEqual({
        require: ['required1', 'required2'],
        deny: ['denied1', 'denied2'],
      })
    })

    it('filters out empty tag properties', () => {
      const configValues: SlotTags = {
        require: [{ tag: 'required1' }, { tag: '' }],
        deny: [{ tag: 'denied1' }, { tag: '' }],
        accept: [],
        constrain: [],
      }

      expect(processConfigValues(configValues)).toEqual({
        require: ['required1'],
        deny: ['denied1'],
      })
    })

    it('handles configValues with no tags section', () => {
      const configValues: SlotTags = { require: [], deny: [], accept: [], constrain: [] }

      expect(processConfigValues(configValues)).toEqual({ require: [], deny: [] })
    })

    it('processes constrain tags with tag constraints', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'base' }, { filter: 'base|level1' }, { filter: 'base|level2' }],
      }

      const siblingSelections = [
        { partName: 'wall', tags: ['base|level1|sub', 'base|level3|sub', 'other|tag'] },
      ]

      // Included because it starts with `base` and matches no filter.
      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({
        require: ['base|level3|sub'],
        deny: [],
      })
    })

    it('handles constrain logic with no matching tags', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'base' }, { filter: 'base|level1' }],
      }

      const siblingSelections = [{ partName: 'wall', tags: ['other|tag', 'different|tag'] }]

      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({ require: [], deny: [] })
    })

    it('handles constrain logic with exact filter match', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'base' }, { filter: 'base|level1' }],
      }

      const siblingSelections = [{ partName: 'wall', tags: ['base|level1'] }]

      // Empty: the tag is exactly the filter.
      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({ require: [], deny: [] })
    })

    it('handles constrain logic with prefix filter match', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'base' }, { filter: 'base|level1' }],
      }

      const siblingSelections = [{ partName: 'wall', tags: ['base|level1|sub'] }]

      // Empty: the tag is under the filter.
      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({ require: [], deny: [] })
    })

    it('handles constrain logic when tag starts with filter', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'base' }, { filter: 'base|level1|sub' }],
      }

      const siblingSelections = [{ partName: 'wall', tags: ['base|level1'] }]

      // Empty: the filter is under the tag, so keeping it would readmit the filtered branch.
      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({ require: [], deny: [] })
    })

    it('always includes exact matches for constraint tags', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture' }],
      }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture', 'texture|stone', 'texture|stone|rough'] },
      ]

      // The exact match is unconditional; the filter runs over strict prefixes only.
      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({
        require: ['texture', 'texture|stone'],
        deny: [],
      })
    })

    it('filters out more specific tags while keeping same-level tags', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture' }],
      }

      const siblingSelections = [
        {
          partName: 'wall',
          tags: [
            'texture|wood',
            'texture|dungeon_stone',
            'texture|dungeon_stone|block',
            'texture|cave|detailed',
            'texture|cave',
          ],
        },
      ]

      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({
        require: ['texture|wood', 'texture|dungeon_stone', 'texture|cave'],
        deny: [],
      })
    })

    it('handles multiple levels of tag specificity', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture' }],
      }

      const siblingSelections = [
        {
          partName: 'wall',
          tags: [
            'texture|stone',
            'texture|stone|rough',
            'texture|stone|rough|cracked',
            'texture|wood',
            'texture|wood|oak|stained',
          ],
        },
      ]

      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({
        require: ['texture|stone', 'texture|wood'],
        deny: [],
      })
    })

    it('selects tag with least segments when multiple tags match constraint', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture' }],
      }

      const siblingSelections = [
        {
          partName: 'wall',
          tags: ['texture|dungeon_stone', 'texture|dungeon_stone|block', 'texture|cave', 'texture|cave|detailed'],
        },
      ]

      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({
        require: ['texture|dungeon_stone', 'texture|cave'],
        deny: [],
      })
    })

    it('inherits from parent tags when parent is enabled', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture' }],
      }

      const parentTags = ['texture|dungeon_stone', 'connection|openforge']

      expect(processConfigValues(configValues, parentTags, [])).toEqual({
        require: ['texture|dungeon_stone'],
        deny: [],
      })
    })

    it('does not inherit from parent when parent is disabled', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture', parent: false }],
      }

      const parentTags = ['texture|dungeon_stone', 'connection|openforge']

      expect(processConfigValues(configValues, parentTags, [])).toEqual({ require: [], deny: [] })
    })

    it('inherits from specific siblings when siblings array is provided', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture', siblings: ['wall'] }],
      }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|dungeon_stone'] },
        { partName: 'floor', tags: ['texture|wood'] },
      ]

      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({
        require: ['texture|dungeon_stone'],
        deny: [],
      })
    })

    it('does not inherit from siblings when siblings array is empty', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture', siblings: [] }],
      }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|dungeon_stone'] },
        { partName: 'floor', tags: ['texture|wood'] },
      ]

      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({ require: [], deny: [] })
    })

    it('inherits from all siblings when siblings is undefined', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture' }],
      }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|dungeon_stone'] },
        { partName: 'floor', tags: ['texture|wood'] },
      ]

      expect(processConfigValues(configValues, [], siblingSelections)).toEqual({
        require: ['texture|dungeon_stone', 'texture|wood'],
        deny: [],
      })
    })

    it('combines parent and sibling inheritance', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture' }],
      }

      const parentTags = ['texture|dungeon_stone']
      const siblingSelections = [{ partName: 'wall', tags: ['texture|wood'] }]

      expect(processConfigValues(configValues, parentTags, siblingSelections)).toEqual({
        require: ['texture|dungeon_stone', 'texture|wood'],
        deny: [],
      })
    })

    it('combines parent and specific sibling inheritance', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture', siblings: ['wall'] }],
      }

      const parentTags = ['texture|dungeon_stone']
      const siblingSelections = [
        { partName: 'wall', tags: ['texture|wood'] },
        { partName: 'floor', tags: ['texture|stone'] },
      ]

      expect(processConfigValues(configValues, parentTags, siblingSelections)).toEqual({
        require: ['texture|dungeon_stone', 'texture|wood'],
        deny: [],
      })
    })

    it('excludes parent when parent is false and uses specific siblings', () => {
      const configValues: SlotTags = {
        require: [],
        deny: [],
        accept: [],
        constrain: [{ tag: 'texture', parent: false, siblings: ['wall'] }],
      }

      const parentTags = ['texture|dungeon_stone']
      const siblingSelections = [
        { partName: 'wall', tags: ['texture|wood'] },
        { partName: 'floor', tags: ['texture|stone'] },
      ]

      expect(processConfigValues(configValues, parentTags, siblingSelections)).toEqual({
        require: ['texture|wood'],
        deny: [],
      })
    })
  })

  describe('createDeepLink', () => {
    it('creates deep link with tags only', () => {
      expect(createDeepLink(['tag1', 'tag2'])).toBe('tag=tag1&tag=tag2')
    })

    it('creates deep link with tags and search term', () => {
      expect(createDeepLink(['tag1', 'tag2'], 'test search')).toBe('tag=tag1&tag=tag2&search=test+search')
    })

    it('handles empty tags array', () => {
      expect(createDeepLink([])).toBe('')
    })

    it('handles tags with special characters', () => {
      expect(createDeepLink(['tag with spaces', 'tag|with|pipes'])).toBe(
        'tag=tag+with+spaces&tag=tag%7Cwith%7Cpipes',
      )
    })

    it('handles search term with special characters', () => {
      expect(createDeepLink(['tag1'], 'search with spaces & symbols')).toBe(
        'tag=tag1&search=search+with+spaces+%26+symbols',
      )
    })

    it('creates deep link with deny tags only', () => {
      expect(createDeepLink([], null, ['deny1', 'deny2'])).toBe('deny=deny1&deny=deny2')
    })

    it('creates deep link with both tags and deny tags', () => {
      expect(createDeepLink(['tag1', 'tag2'], null, ['deny1', 'deny2'])).toBe(
        'tag=tag1&tag=tag2&deny=deny1&deny=deny2',
      )
    })

    it('creates deep link with deny tags and search term', () => {
      expect(createDeepLink([], 'test', ['deny1'])).toBe('deny=deny1&search=test')
    })

    it('creates deep link with tags, deny tags, and search term', () => {
      expect(createDeepLink(['tag1'], 'test', ['deny1'])).toBe('tag=tag1&deny=deny1&search=test')
    })

    it('handles empty deny tags array', () => {
      expect(createDeepLink(['tag1'], null, [])).toBe('tag=tag1')
    })

    it('handles deny tags with special characters', () => {
      expect(createDeepLink([], null, ['deny with spaces', 'deny|with|pipes'])).toBe(
        'deny=deny+with+spaces&deny=deny%7Cwith%7Cpipes',
      )
    })
  })
})

/* -------------------------------------------- config-spec-compliance.test.ts */

describe('Config Spec Compliance Tests', () => {
  describe('Backend Constraint Computation', () => {
    it('should compute final require constraints for backend API', () => {
      const configValues: SlotTags = { require: [{ tag: 'shape|base' }, { tag: 'size|width|2' }] }

      expect(processConfigValues(configValues).require).toEqual(['shape|base', 'size|width|2'])
    })

    it('should compute final deny constraints for backend API', () => {
      const configValues: SlotTags = { deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }] }

      expect(processConfigValues(configValues).deny).toEqual(['shape|wall', 'build|s2w'])
    })

    it('should combine direct constraints with inherited constraints', () => {
      const configValues: SlotTags = {
        require: [{ tag: 'shape|base' }],
        constrain: [{ tag: 'texture' }],
      }

      expect(processConfigValues(configValues, ['texture|dungeon_stone'], []).require).toEqual([
        'shape|base',
        'texture|dungeon_stone',
      ])
    })
  })

  describe('Require Constraints', () => {
    it('should enforce exact tag matching', () => {
      const configValues: SlotTags = { require: [{ tag: 'shape|base' }, { tag: 'size|width|2' }] }

      expect(processConfigValues(configValues).require).toEqual(['shape|base', 'size|width|2'])
    })

    it('should create AND relationship for multiple require entries', () => {
      const configValues: SlotTags = {
        require: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'connection|openforge' }],
      }

      expect(processConfigValues(configValues).require).toEqual([
        'shape|wall',
        'build|s2w',
        'connection|openforge',
      ])
    })
  })

  describe('Deny Constraints', () => {
    it('should enforce exclusion matching', () => {
      const configValues: SlotTags = { deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }] }

      expect(processConfigValues(configValues).deny).toEqual(['shape|wall', 'build|s2w'])
    })

    it('should create OR relationship for multiple deny entries', () => {
      const configValues: SlotTags = {
        deny: [{ tag: 'shape|column|low' }, { tag: 'shape|option|notch' }],
      }

      expect(processConfigValues(configValues).deny).toEqual(['shape|column|low', 'shape|option|notch'])
    })
  })

  describe('Accept Constraints', () => {
    it('should support hierarchical tag matching', () => {
      const configValues: SlotTags = { accept: [{ tag: 'shape|wall' }] }

      // `accept` is not processed by processConfigValues; it is handled at the
      // UI/selection level. See `resolveSlotTags` for where this port carries it.
      expect(processConfigValues(configValues).require).toEqual([])
    })
  })

  describe('Constrain System - Parent Inheritance', () => {
    it('should inherit from parent tags when parent is enabled (default)', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture' }] }

      expect(
        processConfigValues(configValues, ['texture|dungeon_stone', 'connection|openforge'], []).require,
      ).toEqual(['texture|dungeon_stone'])
    })

    it('should not inherit from parent when parent is disabled', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture', parent: false }] }

      expect(
        processConfigValues(configValues, ['texture|dungeon_stone', 'connection|openforge'], []).require,
      ).toEqual([])
    })

    it('should inherit from parent by default when parent is not specified', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'connection' }] }

      expect(processConfigValues(configValues, ['connection|openforge', 'texture|stone'], []).require).toEqual([
        'connection|openforge',
      ])
    })
  })

  describe('Constrain System - Sibling Inheritance', () => {
    it('should inherit from all siblings when siblings is undefined (default)', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture' }] }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|dungeon_stone'] },
        { partName: 'floor', tags: ['texture|wood'] },
      ]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([
        'texture|dungeon_stone',
        'texture|wood',
      ])
    })

    it('should inherit from specific siblings when siblings array is provided', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture', siblings: ['wall'] }] }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|dungeon_stone'] },
        { partName: 'floor', tags: ['texture|wood'] },
      ]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([
        'texture|dungeon_stone',
      ])
    })

    it('should not inherit from siblings when siblings array is empty', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture', siblings: [] }] }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|dungeon_stone'] },
        { partName: 'floor', tags: ['texture|wood'] },
      ]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([])
    })

    it('should handle invalid sibling names gracefully', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture', siblings: ['nonexistent'] }] }

      const siblingSelections = [{ partName: 'wall', tags: ['texture|dungeon_stone'] }]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([])
    })
  })

  describe('Constrain System - Combined Inheritance', () => {
    it('should combine parent and sibling inheritance', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture' }] }

      const siblingSelections = [{ partName: 'wall', tags: ['texture|wood'] }]

      expect(processConfigValues(configValues, ['texture|dungeon_stone'], siblingSelections).require).toEqual([
        'texture|dungeon_stone',
        'texture|wood',
      ])
    })

    it('should combine parent and specific sibling inheritance', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture', siblings: ['wall'] }] }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|wood'] },
        { partName: 'floor', tags: ['texture|stone'] },
      ]

      expect(processConfigValues(configValues, ['texture|dungeon_stone'], siblingSelections).require).toEqual([
        'texture|dungeon_stone',
        'texture|wood',
      ])
    })

    it('should exclude parent when parent is false and use specific siblings', () => {
      const configValues: SlotTags = {
        constrain: [{ tag: 'texture', parent: false, siblings: ['wall'] }],
      }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|wood'] },
        { partName: 'floor', tags: ['texture|stone'] },
      ]

      expect(processConfigValues(configValues, ['texture|dungeon_stone'], siblingSelections).require).toEqual([
        'texture|wood',
      ])
    })
  })

  describe('Filter Mechanism', () => {
    it('should remove filtered tag prefixes from inherited tags', () => {
      const configValues: SlotTags = {
        constrain: [{ tag: 'connection' }, { filter: 'connection|side' }],
      }

      const siblingSelections = [
        { partName: 'wall', tags: ['connection|openforge', 'connection|side|female'] },
      ]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([
        'connection|openforge',
      ])
    })

    it('should handle multiple filters', () => {
      const configValues: SlotTags = {
        constrain: [{ tag: 'connection' }, { filter: 'connection|side' }, { filter: 'connection|openforge' }],
      }

      const siblingSelections = [
        {
          partName: 'wall',
          tags: ['connection|openforge', 'connection|side|female', 'connection|other'],
        },
      ]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual(['connection|other'])
    })

    it('should apply filters after inheritance', () => {
      const configValues: SlotTags = {
        constrain: [{ tag: 'connection' }, { filter: 'connection|side' }],
      }

      const siblingSelections = [{ partName: 'wall', tags: ['connection|side|female'] }]

      expect(processConfigValues(configValues, ['connection|openforge'], siblingSelections).require).toEqual([
        'connection|openforge',
      ])
    })
  })

  describe('Tag Specificity Filtering', () => {
    it('should filter out more specific tags while keeping same-level tags', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture' }] }

      const siblingSelections = [
        {
          partName: 'wall',
          tags: [
            'texture|wood',
            'texture|dungeon_stone',
            'texture|dungeon_stone|block',
            'texture|cave|detailed',
            'texture|cave',
          ],
        },
      ]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([
        'texture|wood',
        'texture|dungeon_stone',
        'texture|cave',
      ])
    })

    it('should handle multiple levels of tag specificity', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture' }] }

      const siblingSelections = [
        {
          partName: 'wall',
          tags: [
            'texture|stone',
            'texture|stone|rough',
            'texture|stone|rough|cracked',
            'texture|wood',
            'texture|wood|oak|stained',
          ],
        },
      ]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([
        'texture|stone',
        'texture|wood',
      ])
    })
  })

  describe('Real-world Blueprint Examples', () => {
    it('should handle S2W corner blueprint column constraints', () => {
      const configValues: SlotTags = {
        require: [{ tag: 'shape|column|corner' }, { tag: 'build|s2w' }, { tag: 'size|column_shape|L' }],
        deny: [{ tag: 'shape|column|low' }],
        constrain: [{ tag: 'connection|side' }],
      }

      const result = processConfigValues(configValues)
      expect(result.require).toEqual(['shape|column|corner', 'build|s2w', 'size|column_shape|L'])
      expect(result.deny).toEqual(['shape|column|low'])
    })

    it('should handle S2W corner blueprint right wall with fulfillment', () => {
      const configValues: SlotTags = {
        require: [
          { tag: 'build|s2w' },
          { tag: 'shape|corner|right' },
          { tag: 'connection|openforge' },
          { tag: 'size|width|2' },
        ],
        deny: [{ tag: 'shape|column|low' }],
        constrain: [{ tag: 'connection|side' }],
      }

      const result = processConfigValues(configValues)
      expect(result.require).toEqual([
        'build|s2w',
        'shape|corner|right',
        'connection|openforge',
        'size|width|2',
      ])
      expect(result.deny).toEqual(['shape|column|low'])
    })

    it('should handle S2W corner blueprint base with connection filtering', () => {
      const configValues: SlotTags = {
        require: [
          { tag: 'shape|base' },
          { tag: 'shape|base|square' },
          { tag: 'size|width|2' },
          { tag: 'size|depth|2' },
        ],
        deny: [{ tag: 'shape|wall' }, { tag: 'build|s2w' }, { tag: 'shape|option|notch' }],
        constrain: [{ tag: 'connection' }, { filter: 'connection|side' }],
      }

      const siblingSelections = [
        { partName: 'right wall', tags: ['connection|openforge', 'connection|side|female'] },
        { partName: 'left wall', tags: ['connection|openforge', 'connection|side|male'] },
      ]

      const result = processConfigValues(configValues, [], siblingSelections)
      expect(result.require).toEqual([
        'shape|base',
        'shape|base|square',
        'size|width|2',
        'size|depth|2',
        'connection|openforge',
      ])
      expect(result.deny).toEqual(['shape|wall', 'build|s2w', 'shape|option|notch'])
    })
  })

  describe('Constraint Conflict Handling', () => {
    it('should handle conflicting constraints from multiple siblings', () => {
      const configValues: SlotTags = { constrain: [{ tag: 'texture' }] }

      const siblingSelections = [
        { partName: 'wall', tags: ['texture|stone'] },
        { partName: 'floor', tags: ['texture|wood'] },
      ]

      // Both are kept: the conflict is resolved downstream, by there being no
      // tile that carries them both.
      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([
        'texture|stone',
        'texture|wood',
      ])
    })

    it('should handle conflicting constraints with filters', () => {
      const configValues: SlotTags = {
        constrain: [{ tag: 'connection' }, { filter: 'connection|side' }],
      }

      const siblingSelections = [
        { partName: 'wall', tags: ['connection|openforge', 'connection|side|female'] },
        { partName: 'floor', tags: ['connection|openforge', 'connection|side|male'] },
      ]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual([
        'connection|openforge',
      ])
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty config values', () => {
      expect(processConfigValues(null)).toEqual({ require: [], deny: [] })
    })

    it('should handle config with no tags section', () => {
      expect(processConfigValues({})).toEqual({ require: [], deny: [] })
    })

    it('should handle empty arrays in all constraint types', () => {
      const configValues: SlotTags = { require: [], deny: [], accept: [], constrain: [] }

      expect(processConfigValues(configValues)).toEqual({ require: [], deny: [] })
    })

    it('should handle constrain with only filter entries', () => {
      const configValues: SlotTags = {
        constrain: [{ filter: 'connection|side' }, { filter: 'connection|openforge' }],
      }

      expect(processConfigValues(configValues)).toEqual({ require: [], deny: [] })
    })

    it('should handle constrain with mixed tag and filter entries', () => {
      const configValues: SlotTags = {
        constrain: [{ tag: 'texture' }, { filter: 'texture|stone' }],
      }

      const siblingSelections = [{ partName: 'wall', tags: ['texture|stone', 'texture|wood'] }]

      expect(processConfigValues(configValues, [], siblingSelections).require).toEqual(['texture|wood'])
    })
  })

  describe('API Integration', () => {
    it('should produce backend-compatible constraint arrays', () => {
      const configValues: SlotTags = {
        require: [{ tag: 'shape|base' }],
        deny: [{ tag: 'build|s2w' }],
        constrain: [{ tag: 'texture' }],
      }

      const result = processConfigValues(configValues, ['texture|dungeon_stone'], [])
      expect(result.require).toEqual(['shape|base', 'texture|dungeon_stone'])
      expect(result.deny).toEqual(['build|s2w'])
    })

    it('should handle complex inheritance scenarios for backend', () => {
      const configValues: SlotTags = {
        require: [{ tag: 'shape|wall' }],
        constrain: [{ tag: 'connection', siblings: ['floor'] }, { tag: 'texture', parent: false }],
      }

      const parentTags = ['texture|stone', 'connection|openforge']
      const siblingSelections = [
        { partName: 'floor', tags: ['connection|side|female'] },
        { partName: 'ceiling', tags: ['connection|top'] },
      ]

      const result = processConfigValues(configValues, parentTags, siblingSelections)
      // `connection` inherits from the parent AND from the `floor` sibling:
      // `siblings` restricts which siblings are read, not whether the parent is.
      // `texture` inherits from neither, because `parent: false` and it names no sibling.
      expect(result.require).toEqual(['shape|wall', 'connection|openforge', 'connection|side|female'])
      expect(result.deny).toEqual([])
    })
  })
})

/* --------------------------------------------- beyond the port (not of the 69) */

describe('the two places this port is wider than its source', () => {
  it('carries `accept` through instead of dropping it', () => {
    const tags: SlotTags = {
      require: [{ tag: 'shape|base' }],
      accept: [{ tag: 'shape|wall' }],
      constrain: [{ tag: 'texture' }],
    }

    const resolved = resolveSlotTags(tags, ['texture|dungeon_stone'], [])
    expect(resolved.require).toEqual(['shape|base', 'texture|dungeon_stone'])
    expect(resolved.accept).toEqual(['shape|wall'])
  })

  it('resolves `accept` to nothing when the slot declares none', () => {
    expect(resolveSlotTags({ require: [{ tag: 'shape|base' }] }).accept).toEqual([])
  })

  it('opens one level of nested slots and no more', () => {
    const door = { config: { parts: [{ name: 'handle', tags: { require: [{ tag: 'interface|handle' }] } }] } }
    const nested = nestedSlots({ door, base: { config: {} }, torch: {} })

    expect(Object.keys(nested)).toEqual(['door'])
    expect(nested.door?.map((slot) => slot.name)).toEqual(['handle'])
  })
})
