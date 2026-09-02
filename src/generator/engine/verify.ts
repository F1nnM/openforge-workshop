/**
 * What "verified" can honestly mean for a mesh nobody stored.
 *
 * The brief for this row said *"verify a produced STL against its md5"*, and the
 * plan's blocker **B5** asks for `Access-Control-Expose-Headers: ETag` because
 * *"ETag equals the md5, which is how a fetched STL is verified to be the file a
 * recipe named"*. Both of those are about **fetched** objects. This module is
 * about generated ones, and the difference is not a detail — so it is written
 * down here rather than left for somebody to infer from a green checkmark.
 *
 * ## Three claims, and only two of them are integrity claims
 *
 * **1. The engine is the engine we audited. This is a real guarantee.**
 * `openscad.wasm` is fetched at runtime as a hashed build asset. Before it
 * reaches `WebAssembly.compile`, its SHA-256 is computed with
 * `crypto.subtle.digest` and compared to {@link ENGINE_SHA256}, a constant
 * inlined at build time from the vendored file. A CDN that served the wrong
 * bytes, a truncated download, a cache poisoned between deploys: all refused
 * before a single instruction runs. Both sides of that comparison do **not**
 * come from the same source — one is the network, one is the bundle — which is
 * what makes it worth anything.
 *
 * **2. The mesh matches the catalogued file. A real guarantee, when it applies.**
 * S4's resolution is catalog-first: the 1,962 catalogued bases *are* generator
 * output from this same geometry via upstream's `bases.py`, so a parameter tuple
 * that resolves to one has a **known md5 in the index**. Comparing a generated
 * mesh's MD5 to that is a genuine cross-check of the whole pipeline — engine,
 * parameters, and the resolver's claim that this tuple means that file. That is
 * {@link Verification} `'catalogued-match'`, and its negative,
 * `'catalogued-mismatch'`, is a bug worth surfacing loudly rather than a
 * cosmetic difference. Note what it is *not*: S2 found that native and WASM
 * OpenSCAD **do not always agree** — 45 of 48 configurations matched and a curved
 * 4×4 differed by +26 triangles — and the catalogued corpus was generated
 * natively. So a mismatch on a curved shape is expected, and this module reports
 * the fact without ruling on it.
 *
 * **3. The MD5 of a generated mesh, on its own, is a content address and not an
 * integrity check.** When no catalogued file exists there is nothing to compare
 * against. Hashing bytes we just produced and announcing that they hash to what
 * they hash to attests nothing: both sides of the comparison come from the same
 * run, so a wrong render produces a wrong mesh with a perfectly correct digest.
 * That case is {@link Verification} `'self-addressed'`, named so that no caller
 * can mistake it for the other two, and the reason it is computed at all is that
 * a content address is genuinely useful — it dedupes a mesh against the download
 * pack, keys a cache, and gives the bill a stable name for a file that has no
 * catalogue entry.
 *
 * ## Why the hash and not the header, even for fetched objects
 *
 * W1 measured it: **58.5% of the corpus's 8,353 distinct blobs are above R2's
 * multipart threshold**, and a multipart ETag is the MD5 of concatenated part
 * digests with `-N` appended — not the object's MD5. So B5's premise holds for
 * only 42% of the corpus, and any check built on the header silently degrades to
 * nothing on the majority of large meshes. Hashing content is strictly stronger
 * and needs no CORS header at all. Nothing in this module reads a header.
 */
import { md5 } from './md5'

/**
 * SHA-256 of `vendor/openscad-wasm/openscad.wasm`, 10,531,863 bytes.
 *
 * The same digest is in `vendor/openscad-wasm/MANIFEST.sha256`, and
 * `vendor.test.ts` asserts the two agree against the file on disk — so this
 * constant cannot drift from the binary without failing the suite.
 */
export const ENGINE_SHA256 = 'fd887f516ff5accb2060d78bf1127cb357f52346e708f0f5970dc151d517d508'

/** Byte length of the vendored binary. Checked before hashing, so a truncated
 * response fails with a length rather than an opaque digest mismatch. */
export const ENGINE_BYTES = 10_531_863

/** The version string the vendored binary prints. Read from the artefact. */
export const ENGINE_VERSION = '2026.01.02.wasm30346'

/** The OpenSCAD commit the vendored binary reports for itself, via `--info`. */
export const ENGINE_SOURCE_COMMIT = '7a2053ed'

export class EngineIntegrityError extends Error {
  override readonly name = 'EngineIntegrityError'
}

/**
 * Refuse to run an engine binary that is not the vendored one.
 *
 * Throws rather than warning. A binary that is not the audited one is a binary
 * whose licence, provenance and measured behaviour this project has not
 * established, and running it anyway would make every other statement in
 * `vendor/openscad-wasm/PROVENANCE.md` conditional on the network.
 */
export async function assertEngineIntegrity(bytes: Uint8Array): Promise<void> {
  if (bytes.length !== ENGINE_BYTES) {
    throw new EngineIntegrityError(
      `the engine binary is ${bytes.length.toLocaleString('en-GB')} bytes, expected ` +
        `${ENGINE_BYTES.toLocaleString('en-GB')} — a truncated or substituted asset`,
    )
  }
  const digest = await sha256(bytes)
  if (digest !== ENGINE_SHA256) {
    throw new EngineIntegrityError(
      `the engine binary hashes to ${digest}, expected ${ENGINE_SHA256} — refusing to compile it`,
    )
  }
}

/** Hex SHA-256 via WebCrypto, which every target of this app has. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * What was actually established about a mesh.
 *
 * A discriminated union rather than a boolean and a comment, because the three
 * cases carry different weight and a caller that cannot tell them apart will
 * present the weakest one as if it were the strongest.
 */
export type Verification =
  | {
      /** Hashes to the MD5 the index holds for the base this resolved to. */
      readonly kind: 'catalogued-match'
      readonly md5: string
      readonly expected: string
    }
  | {
      /**
       * Does *not* hash to the catalogued MD5. Real information, not necessarily
       * a defect: S2 found native and WASM disagree on 3 of 48 configurations,
       * and the corpus was generated natively.
       */
      readonly kind: 'catalogued-mismatch'
      readonly md5: string
      readonly expected: string
    }
  | {
      /**
       * No catalogued file exists for these parameters, so the digest is a
       * content address and attests nothing about correctness.
       */
      readonly kind: 'self-addressed'
      readonly md5: string
    }

/**
 * Hash a generated mesh, and say precisely what that did and did not prove.
 *
 * `expected` is the index's `blob` for the base S4's resolver matched, or
 * `undefined` when it matched none. Passing it is the only way to get an
 * integrity claim out of this function, which is the intended shape: the honest
 * answer is the default.
 */
export function verifyGeneratedMesh(bytes: Uint8Array, expected?: string): Verification {
  const digest = md5(bytes)
  if (expected === undefined) return { kind: 'self-addressed', md5: digest }
  return expected === digest
    ? { kind: 'catalogued-match', md5: digest, expected }
    : { kind: 'catalogued-mismatch', md5: digest, expected }
}

/**
 * One line of prose per case, for the panel and the bill.
 *
 * Here rather than in the panel because the wording is the substance: this is
 * where "verified" stops being a checkmark and says what it covers. S4 renders
 * this string; it does not get to write its own.
 */
export function describeVerification(verification: Verification): string {
  switch (verification.kind) {
    case 'catalogued-match':
      return `Matches the catalogued file byte-for-byte (md5 ${verification.md5.slice(0, 8)}).`
    case 'catalogued-mismatch':
      return (
        `Differs from the catalogued file: generated ${verification.md5.slice(0, 8)}, ` +
        `catalogued ${verification.expected.slice(0, 8)}. The corpus was generated by native ` +
        'OpenSCAD, which does not always agree with this WebAssembly build.'
      )
    case 'self-addressed':
      return (
        `Generated here; no catalogued file to compare against, so md5 ` +
        `${verification.md5.slice(0, 8)} identifies these bytes rather than vouching for them.`
      )
  }
}
