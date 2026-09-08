/**
 * The Content-Security-Policy against the asset bases it has to permit.
 *
 * `public/_headers` and `pipeline/version.ts` are two files that must agree and
 * share no import. Nothing joined them until this test, and the gap cost a
 * production bug: moving `thumbs` and `lod` to their own bucket updated
 * `ASSET_BASES` and left the CSP naming only the old host, so **every** LOD
 * fetch failed with `Refused to connect because it violates the document's
 * Content Security Policy` — before any request, so the store's own 404s and
 * CORS headers were irrelevant and the symptom looked like a partly-populated
 * store rather than a policy error.
 *
 * The two directives are checked separately because they fail differently and
 * at different times:
 *
 *  - **`connect-src`** gates `fetch`, so it governs `/models/` (the browser-side
 *    STL conversion) and `/lod/`. Wrong, and the 3D builder draws nothing.
 *  - **`img-src`** gates `<img>`, so it governs `/sprites/` and `/thumbs/`.
 *    Wrong, and the grid shows broken images — which, when this test was
 *    written, was a *latent* bug: `thumbs` had already moved hosts but nothing
 *    had ever been uploaded there, so no image had yet been requested from it.
 *
 * Deriving the expectation from `ASSET_BASES` rather than pinning literals is
 * the point. A future base change fails here with a diff naming the host to add,
 * instead of shipping and failing in a browser console.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ASSET_BASES } from './version'

const HEADERS = readFileSync('public/_headers', 'utf8')

/** The CSP as served for every path. */
function csp(): string {
  const line = HEADERS.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:'))
  if (line === undefined) throw new Error('public/_headers declares no Content-Security-Policy')
  return line.slice(line.indexOf(':') + 1).trim()
}

/** One directive's source list, by name. */
function directive(name: string): string[] {
  const found = csp()
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))
  if (found === undefined) throw new Error(`the CSP declares no ${name} directive`)
  return found.split(/\s+/).slice(1)
}

/** Distinct origins the index tells the app to fetch from. */
function assetOrigins(): Record<keyof typeof ASSET_BASES, string> {
  return {
    models: new URL(ASSET_BASES.models).origin,
    sprites: new URL(ASSET_BASES.sprites).origin,
    thumbs: new URL(ASSET_BASES.thumbs).origin,
    lod: new URL(ASSET_BASES.lod).origin,
  }
}

describe('the CSP in public/_headers', () => {
  it('permits fetch from every base the app fetches — models and lod', () => {
    const allowed = directive('connect-src')
    const origins = assetOrigins()
    expect(allowed, `connect-src must allow ${origins.models} for the STL fallback`).toContain(origins.models)
    expect(allowed, `connect-src must allow ${origins.lod} for the LOD store`).toContain(origins.lod)
  })

  it('permits images from every base the app renders — sprites and thumbs', () => {
    const allowed = directive('img-src')
    const origins = assetOrigins()
    expect(allowed, `img-src must allow ${origins.sprites} for sprite sheets`).toContain(origins.sprites)
    expect(allowed, `img-src must allow ${origins.thumbs} for thumbnails`).toContain(origins.thumbs)
  })

  it('names no asset origin the index does not use, so stale hosts are noticed', () => {
    // A host left behind after a move is not a security hole, but it is a lie
    // about where the app talks, and the next reader trusts it.
    const used = new Set(Object.values(assetOrigins()))
    const listed = [...directive('connect-src'), ...directive('img-src')].filter((src) => src.startsWith('https://'))
    for (const src of listed) {
      expect(used, `${src} is in the CSP but no longer in ASSET_BASES`).toContain(src)
    }
  })

  it('still restricts by default, so this file cannot drift into permitting everything', () => {
    expect(directive('default-src')).toEqual(["'self'"])
    for (const name of ['connect-src', 'img-src']) {
      expect(directive(name), `${name} must not use a wildcard`).not.toContain('*')
      expect(directive(name), `${name} must not allow plain http`).not.toContain('http:')
    }
  })
})
