/**
 * `GENERATED.txt` — and the 11 KB of Apache-2.0 licence that has to ride with a
 * generated mesh.
 *
 * **This module is behind a dynamic `import()` and that is the whole reason it
 * is a module.** It was written inside `pack.ts`, and then the wiring was built:
 * reaching `buildGeneratedPack` from the builder's download hook took the entry
 * chunk from **648,981 B to 669,815 B**, with the complete Apache licence text
 * in the bundle every visitor to every page downloads. There is no chunk
 * boundary between the download path and the entry bundle to hide behind:
 * `@/download` is eagerly reachable, because `src/three/loadModel.ts` and
 * `useStlModel.ts` both import it.
 *
 * So the licence loads the way S3's GPL-2 notice loads: through
 * `loadGeneratedNotice()`, one `await` inside a user gesture that is already
 * asynchronous and already about to stream hundreds of megabytes. The same
 * wiring then measured **654,241 B** — **15,574 B raw and 5,244 B gzipped off
 * the entry bundle** — with this file emitted as its own **15,963 B (5,820 B
 * gzipped)** chunk, fetched by the person downloading a generated mesh and by
 * nobody else.
 *
 * What is *not* traded away by that: the licence still ships in the same build,
 * from the same `?raw` import, with no deployment step that could omit it, and
 * {@link assertGeometryLicencePresent} still refuses to produce a notice if
 * either document failed to load. `engine/licence.ts` makes exactly this trade
 * for exactly this reason — its 18 KB rides in the lazy chunk beside the WASM,
 * not in the entry bundle — and `boundary.test.ts` asserts that no static path
 * from this row reaches this file.
 */
import licenceTextRaw from '../scad/LICENSE?raw'
import noticeTextRaw from '../scad/NOTICE?raw'

import type { BlobId } from '@/catalog'
import { CORPUS_LICENCE } from '@/download/attribution'

import type { GeneratedBillLine } from './bill'
import { SCAD_UPSTREAM, SELF_ADDRESSED_PHRASE } from './provenance'

/** The Apache-2.0 text or NOTICE did not ship with this build. */
export class GeneratedLicenceError extends Error {
  override readonly name = 'GeneratedLicenceError'
}

/** The two phrases that prove the Apache text is the licence rather than a stub. */
const REQUIRED_LICENCE_PHRASES = ['Apache License', 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION'] as const

/**
 * Refuse to build a section without the geometry's licence.
 *
 * `engine/licence.ts`'s reasoning, applied to the other vendored licence: the
 * alternative is a build that distributes a derivative of Apache-2.0 sources
 * with no licence and tells nobody who could act on it. A `?raw` import that
 * resolved to an empty string, or a bundler that replaced it, fails here — on
 * the first download attempt, in development — rather than shipping quietly.
 */
export function assertGeometryLicencePresent(licence = licenceTextRaw, notice = noticeTextRaw): void {
  for (const phrase of REQUIRED_LICENCE_PHRASES) {
    if (!licence.includes(phrase)) {
      throw new GeneratedLicenceError(
        `the Apache-2.0 licence for the vendored geometry is missing "${phrase}"; refusing to pack a ` +
          'derivative of sources whose licence did not ship with it',
      )
    }
  }
  if (!notice.includes(SCAD_UPSTREAM.url)) {
    throw new GeneratedLicenceError(
      `the geometry's NOTICE does not name ${SCAD_UPSTREAM.url}; refusing to pack a derivative with no attribution`,
    )
  }
}

/**
 * `GENERATED.txt` — the attribution table and the licence for the `generated/`
 * subtree.
 *
 * Everything a recipient of these bytes is owed and cannot get from
 * `LICENSE.txt`: what they are, what they are not, what produced them, at which
 * commit, under which licence, and the licence itself.
 */
export function generatedNotice(
  groups: readonly { blob: BlobId; bytes: number; lines: readonly GeneratedBillLine[] }[],
  licence = licenceTextRaw,
  notice = noticeTextRaw,
): string {
  const title = 'OpenForge Workshop — generated bases'
  const lines: string[] = [
    title,
    '='.repeat(title.length),
    '',
    'WHAT THESE FILES ARE',
    '',
    'Every file under generated/ was produced in a web browser by OpenSCAD, from the',
    `OpenSCAD sources of ${SCAD_UPSTREAM.repo}, pinned at commit`,
    `${SCAD_UPSTREAM.commit}. Those sources are ${SCAD_UPSTREAM.spdx}, by`,
    `${SCAD_UPSTREAM.author}. Their licence and their NOTICE are reproduced in full below,`,
    'as sections 4(a) and 4(d) of that licence ask.',
    '',
    'WHAT THEY ARE NOT',
    '',
    'They are not the base files the OpenForge archive publishes, and they are not',
    'copies of them. The published bases are ASCII STL exported by an earlier revision',
    'of this same geometry: 184 renders across the whole connector space of the',
    'published 1x1 square matched neither its md5 nor even its facet count — 760',
    'published facets against 296 and 1,428. So a set of parameters can name a',
    'published file and still describe a different mesh from the one rendered here.',
    'Where a published file existed for the parameters asked for, that file is in this',
    'archive under models/ instead, and it is listed in ATTRIBUTION.csv.',
    '',
    'ATTRIBUTION.csv does not list the files under generated/. That table is for the',
    `archive's published models, which are ${CORPUS_LICENCE.id}; these are a derivative of`,
    `${SCAD_UPSTREAM.spdx} sources. This file is their table.`,
    '',
    'THE DIGESTS ARE SELF-ADDRESSED',
    '',
    'Each md5 below was computed over the bytes beside it, in the same browser session',
    `that produced them. It ${SELF_ADDRESSED_PHRASE}:`,
    'both sides of the digest come from one run. Nothing here has been checked against',
    'a published file, because — see above — no published file is expected to match.',
    '',
    'THE FILES',
    '',
  ]

  for (const group of groups) {
    for (const line of group.lines) {
      lines.push(`  md5 ${group.blob}`)
      lines.push(`  bytes ${String(group.bytes)} · copies ${String(line.quantity)} · recipe ${line.recipeId}`)
      lines.push(`  ${line.name}, ${line.size} grid squares, ${String(line.foot.heightMm)} mm tall`)
      lines.push(`  entry point ${line.entry}`)
      for (const parameter of line.parameters) lines.push(`      -D ${parameter.name}=${parameter.value}`)
      lines.push('')
    }
  }

  lines.push(
    'THE OPENSCAD BINARY IS NOT IN THIS ARCHIVE',
    '',
    'The renders were made by a WebAssembly build of OpenSCAD, which is GPL-2.0-only.',
    'That program is not redistributed here, so this archive conveys nothing under its',
    'licence; the application that produced the archive displays the full GPL-2 text',
    'and a written offer for its corresponding source in the generator panel itself.',
    '',
    '----------------------------------------------------------------------',
    'NOTICE — the vendored geometry',
    '----------------------------------------------------------------------',
    '',
    notice.trimEnd(),
    '',
    '----------------------------------------------------------------------',
    `LICENCE — ${SCAD_UPSTREAM.spdx}, the geometry these meshes derive from`,
    '----------------------------------------------------------------------',
    '',
    licence.trimEnd(),
    '',
  )

  return lines.join('\n')
}
