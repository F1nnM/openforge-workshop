import { describe, expect, it } from 'vitest'

import { MAX_QUERY_TOKENS, stripExtension, tokenise, tokeniseQuery } from './text'

describe('tokenise', () => {
  it('splits on every separator the corpus actually uses', () => {
    // architecture-plan.md §6 names `[|_+,%#.-]`; the corpus also carries `°`
    // (hex-corner sweeps in display names) and `/` (family paths).
    expect(tokenise('texture|dungeon_stone|eroded')).toEqual(['texture', 'dungeon', 'stone', 'eroded'])
    expect(tokenise('cave%aggregate+2#corner.IL+corner,90.openlock')).toEqual([
      'cave',
      'aggregate',
      '2',
      'corner',
      'il',
      'corner',
      '90',
      'openlock',
    ])
    expect(tokenise('Hex Corner 120°')).toEqual(['hex', 'corner', '120'])
    expect(tokenise('tiles/cave/thick_wall')).toEqual(['tiles', 'cave', 'thick', 'wall'])
  })

  it('does not split `dungeon_stone` into two tokens by accident', () => {
    // `_` is a separator, so the root arrives as two tokens — which is exactly
    // what makes the two-word query "dungeon stone" work.
    expect(tokenise('dungeon_stone')).toEqual(['dungeon', 'stone'])
  })

  it('lowercases and drops empty edges', () => {
    expect(tokenise('#Corner+Wall.')).toEqual(['corner', 'wall'])
    expect(tokenise('')).toEqual([])
    expect(tokenise('###')).toEqual([])
  })

  it('keeps size tokens intact and never rewrites `x` to `×`', () => {
    // §6: `×` occurs zero times in the corpus, and the mock's rewrite took `4x4`
    // from 347 hits to 0. Sizes are matched exactly as the corpus spells them.
    expect(tokenise('Aztlan Floor 4x4')).toEqual(['aztlan', 'floor', '4x4'])
    expect(tokenise('Plain Curved Base 2r90')).toEqual(['plain', 'curved', 'base', '2r90'])
    expect(tokenise('4×4')).toEqual(['4', '4'])
  })

  it('makes `concave` a token that `cave` does not match', () => {
    // The whole point of word boundaries: substring `cave` hits 658 concave
    // pieces, taking a query for cave-textured tiles from ~407 to 1,080.
    expect(tokenise('Cut Stone Concave Curved Wall')).toContain('concave')
    expect(tokenise('Cut Stone Concave Curved Wall')).not.toContain('cave')
  })
})

describe('tokeniseQuery', () => {
  it('caps the token count without rejecting the query', () => {
    const many = Array.from({ length: 40 }, (_, i) => `w${String(i)}`).join(' ')
    expect(tokeniseQuery(many)).toHaveLength(MAX_QUERY_TOKENS)
  })

  it('passes a normal query through unchanged', () => {
    expect(tokeniseQuery('dungeon stone 2x2')).toEqual(['dungeon', 'stone', '2x2'])
  })
})

describe('stripExtension', () => {
  it('removes the `.stl` that sits on 100% of documents', () => {
    expect(stripExtension('aztlan#floor.4x4.openforge.stl')).toBe('aztlan#floor.4x4.openforge')
  })

  it('leaves a dotfile and an extensionless name alone', () => {
    expect(stripExtension('.hidden')).toBe('.hidden')
    expect(stripExtension('torch')).toBe('torch')
  })
})
