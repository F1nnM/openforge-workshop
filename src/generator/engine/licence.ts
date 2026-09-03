/**
 * The GPL-2 text and the source offer, bundled into the same chunk as the engine.
 *
 * This is compliance by construction rather than by documentation. GPL-2 §1
 * requires that a copy of the licence accompany the program, and §3 that the
 * recipient can get the source. A `COPYING` file sitting in `vendor/` accompanies
 * the *repository*; it does not accompany the **binary a browser downloads**.
 * Importing both documents as `?raw` puts them in the same lazily-loaded chunk
 * that loads `openscad.wasm`, so there is no build configuration, no deployment
 * step and no code path in which the engine ships and the licence does not. They
 * are either both there or neither is.
 *
 * The cost is 18,382 bytes of licence and ~6.8 KB of offer inside a chunk whose
 * companion asset is 10.5 MB. It rounds to nothing, and it removes an entire
 * class of "we forgot to copy the licence to the CDN" failure.
 *
 * **Row S4 must surface {@link ENGINE_LICENCE} in the generator panel.** A link
 * or a disclosure that reaches the full text and the offer; the plan's B3
 * publisher declaration is a separate obligation and this is not it. The engine
 * refuses to run without the notice loaded — see {@link assertNoticePresent} —
 * so a build that tree-shook it away fails on the first render rather than
 * shipping quietly.
 */
import copying from '../../../vendor/openscad-wasm/COPYING?raw'
import writtenOffer from '../../../vendor/openscad-wasm/WRITTEN-OFFER.md?raw'

import { ENGINE_SOURCE_COMMIT, ENGINE_VERSION } from './verify'

export interface EngineLicence {
  /** The program being redistributed. */
  readonly program: string
  /** Version string, as the binary itself prints it. */
  readonly version: string
  /** SPDX identifier. The CGAL linking exception is in the text, not the id. */
  readonly spdx: string
  /** The complete, unmodified licence text, including the exception header. */
  readonly text: string
  /** The §3(b) written offer, verbatim from `vendor/openscad-wasm/`. */
  readonly offer: string
  /** Where the corresponding source is, without invoking the offer. */
  readonly sources: readonly EngineSource[]
}

export interface EngineSource {
  readonly what: string
  readonly url: string
  /** The commit, when one is pinned. */
  readonly commit: string | null
}

/**
 * Everything a recipient of the binary is owed, as one value.
 *
 * The two repositories are both named because §3's "complete source code"
 * includes *"the scripts used to control compilation and installation"*, and for
 * this artefact those live in a different repository from the program.
 */
export const ENGINE_LICENCE: EngineLicence = {
  program: 'OpenSCAD',
  version: ENGINE_VERSION,
  spdx: 'GPL-2.0-only',
  text: copying,
  offer: writtenOffer,
  sources: [
    {
      what: 'OpenSCAD, the program',
      url: 'https://github.com/openscad/openscad',
      commit: ENGINE_SOURCE_COMMIT,
    },
    {
      what: 'openscad-wasm, the Emscripten cross-build',
      url: 'https://github.com/openscad/openscad-wasm',
      commit: null,
    },
  ],
}

/**
 * The two phrases that prove the text is the licence and not a stub.
 *
 * Checked as substrings rather than by hash: the hash belongs in
 * `MANIFEST.sha256`, where `vendor.test.ts` asserts it against the file on disk.
 * What this guards is the *runtime* path — a `?raw` import that resolved to an
 * empty string, or a bundler that replaced it — and for that, presence is the
 * question.
 */
const REQUIRED_PHRASES = ['GNU GENERAL PUBLIC LICENSE', 'TERMS AND CONDITIONS FOR COPYING'] as const

export class EngineLicenceError extends Error {
  override readonly name = 'EngineLicenceError'
}

/**
 * Refuse to run without the notice. Called once, at engine boot.
 *
 * The alternative — logging a warning — produces a build that distributes a
 * GPL-2 binary with no licence and tells nobody who could act on it. This turns
 * that into a failure at the first render, in development, before it ships.
 */
export function assertNoticePresent(licence: EngineLicence = ENGINE_LICENCE): void {
  for (const phrase of REQUIRED_PHRASES) {
    if (!licence.text.includes(phrase)) {
      throw new EngineLicenceError(
        `the GPL-2 notice for ${licence.program} ${licence.version} is missing "${phrase}"; ` +
          'refusing to run an engine whose licence did not ship with it',
      )
    }
  }
  if (!licence.offer.includes('machine-readable copy of the corresponding source code')) {
    throw new EngineLicenceError(
      `the written source offer for ${licence.program} ${licence.version} did not load; ` +
        'GPL-2 section 3 requires it to accompany the binary',
    )
  }
}
