#!/usr/bin/env tsx
/**
 * Re-fetch the real-mesh test fixture from the bucket.
 *
 *     tsx tools/lod/fixtures/mkfixture.ts [md5]
 *
 * The fixture is the bucket's bytes unmodified, so this script's only real job is
 * to prove that claim: it fetches, hashes, and refuses to write anything whose
 * md5 is not the md5 asked for. See `PROVENANCE.md` for why this particular mesh.
 */
import { writeFileSync } from 'node:fs'

import { FIXTURE_BLOB, FIXTURE_PATH } from './wall'
import { USER_AGENT, etagMd5, md5Hex } from '../fetch'

async function main(blob: string): Promise<void> {
  const url = `https://objects.openforge.tools/models/${blob.slice(0, 6)}/${blob}.stl`
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`)
  const bytes = Buffer.from(await response.arrayBuffer())

  const actual = md5Hex(bytes)
  if (actual !== blob) throw new Error(`${url}: asked for ${blob}, body hashes to ${actual}`)

  writeFileSync(FIXTURE_PATH, bytes)
  process.stdout.write(
    `${FIXTURE_PATH}\n  source ${url}\n  ${String(bytes.byteLength)} bytes · md5 ${actual} · ` +
      `ETag ${response.headers.get('etag') ?? '(none)'} ` +
      `(${etagMd5(response.headers.get('etag')) === null ? 'multipart — not comparable' : 'single-part — equals the md5'})\n`,
  )
}

await main(process.argv[2] ?? FIXTURE_BLOB)
