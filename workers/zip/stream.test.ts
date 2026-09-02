/**
 * The bytes, and the four ways they are made to fail loudly.
 *
 * The archives here are parsed with `testing/readZip.ts` — from the central
 * directory, the way an extractor does — so what is asserted is what a recipient
 * sees rather than what the writer believed it wrote. That distinction is the
 * whole subject: a streamed ZIP records each entry's real size in a trailing
 * descriptor, so a truncated archive opens cleanly with a corrupt mesh inside
 * it, and only a reader that checks CRCs against the bytes can tell.
 *
 * v1 rejected `native-file-system-adapter` because its fallback truncates where
 * nothing can observe it. These tests exist to prove the Worker did not
 * reintroduce that property on the server side.
 */
import { describe, expect, it } from 'vitest'

import { predictZipLength } from '../../src/download/clientZip'

import type { ArchivePlan } from './archive'
import { buildArchivePlan, entryMetadata } from './archive'
import type { FakeObject } from './testing/fixtures'
import { BucketFetchError, ModelLengthError, SubrequestBudgetError, bucketModelSource, subrequestBudget } from './bucket'
import { validateArchiveRequest } from './request'
import { ArchiveLengthMismatchError, openArchiveStream } from './stream'
import { MODELS_BASE, collect, fakeFetch, md5, modelBytes, recordingSource, requestBody, requestFile, urlFor } from './testing/fixtures'
import { METHOD_STORE, readZip } from './testing/readZip'
import { ModelUrlError } from './url'

const SIZES = [4_096, 12_288, 1_000]

function plan(sizes: readonly number[] = SIZES): ArchivePlan {
  const files = sizes.map((bytes, index) => requestFile(index, { name: `models/cave/wall-${String(index)}.stl`, bytes }))
  return buildArchivePlan(validateArchiveRequest(requestBody(files)), MODELS_BASE)
}

/** Objects for a plan, one per model, chunked so the streaming path is exercised. */
function objectsFor(built: ArchivePlan, overrides: (index: number) => Partial<FakeObject> = () => ({})): Map<string, FakeObject> {
  const objects = new Map<string, FakeObject>()
  built.models.forEach((model, index) => {
    objects.set(model.url, { bytes: modelBytes(index, model.bytes), chunks: 5, ...overrides(index) })
  })
  return objects
}

function sourceFor(built: ArchivePlan, overrides?: (index: number) => Partial<FakeObject>) {
  const fetcher = fakeFetch(objectsFor(built, overrides))
  return { fetcher, source: bucketModelSource({ budget: subrequestBudget(), fetchImpl: fetcher.impl }) }
}

describe('the archive an extractor sees', () => {
  it('holds the licensing files then the models, all stored, all UTF-8 flagged', async () => {
    const built = plan()
    const { source } = sourceFor(built)
    const stream = openArchiveStream(built, { source })
    await stream.prime()

    const archive = readZip(await collect(stream.body()))

    expect(archive.entries.map((entry) => entry.name)).toEqual([
      'LICENSE.txt',
      'ATTRIBUTION.csv',
      'models/cave/wall-0.stl',
      'models/cave/wall-1.stl',
      'models/cave/wall-2.stl',
    ])
    for (const entry of archive.entries) {
      expect(entry.method).toBe(METHOD_STORE)
      expect(entry.utf8).toBe(true)
      // Stored, so the two sizes are the same number. This is what makes the
      // length prediction exact and therefore usable as a truncation guard.
      expect(entry.compressedSize).toBe(entry.uncompressedSize)
    }
  })

  it('is exactly the length the plan promised, which is the browser arithmetic', async () => {
    const built = plan()
    const { source } = sourceFor(built)
    const stream = openArchiveStream(built, { source })
    await stream.prime()

    const bytes = await collect(stream.body())
    expect(bytes.byteLength).toBe(built.predictedLength)
    expect(bytes.byteLength).toBe(predictZipLength(entryMetadata(built.entries)))
  })

  it('carries each model byte for byte, verified by CRC and by content', async () => {
    const built = plan()
    const { source } = sourceFor(built)
    const stream = openArchiveStream(built, { source })
    await stream.prime()

    const archive = readZip(await collect(stream.body()))
    // `readZip` already checked every CRC against the bytes it sliced out; this
    // checks the bytes are the *right* model rather than merely a consistent one.
    built.models.forEach((model, index) => {
      const entry = archive.entries[index + 2]
      expect(entry?.uncompressedSize).toBe(model.bytes)
      expect(entry?.data).toEqual(modelBytes(index, model.bytes))
    })
  })

  it('is read strictly enough that the assertions above can fail', async () => {
    // The reader checks every CRC against the bytes it sliced out and refuses an
    // archive whose directory does not line up. Without that, every structural
    // assertion in this file would be vacuous — which is exactly the trap a
    // streamed ZIP sets, since a truncated one still opens.
    const built = plan()
    const { source } = sourceFor(built)
    const stream = openArchiveStream(built, { source })
    await stream.prime()
    const bytes = await collect(stream.body())

    expect(() => readZip(bytes.subarray(0, bytes.byteLength - 1))).toThrow()

    const archive = readZip(bytes)
    const at = archive.entries[2]?.data.byteOffset ?? 0
    const flipped = new Uint8Array(bytes)
    flipped[at] = ((flipped[at] ?? 0) ^ 0xff) & 0xff
    expect(() => readZip(flipped)).toThrow(/CRC/)
  })

  it('holds one entry per md5, so a file shared by nine catalog rows is stored once', async () => {
    // The bill deduplicates and `request.ts` refuses a request that has not; the
    // consequence to assert here is that many catalog paths collapse to one
    // entry, listed once, with every path named in the CSV.
    const files = [requestFile(1, { paths: ['tiles/a.stl', 'tiles/b.stl', 'tiles/c.stl'], bytes: 512 })]
    const built = buildArchivePlan(validateArchiveRequest(requestBody(files)), MODELS_BASE)
    const { fetcher, source } = sourceFor(built)
    const stream = openArchiveStream(built, { source })
    await stream.prime()

    const archive = readZip(await collect(stream.body()))
    expect(archive.entries.filter((entry) => entry.name.startsWith('models/'))).toHaveLength(1)
    expect(fetcher.requested).toEqual([urlFor(1)])

    const csv = new TextDecoder().decode(archive.entries[1]?.data)
    expect(csv).toContain('tiles/a.stl; tiles/b.stl; tiles/c.stl')
  })
})

describe('truncation fails loudly', () => {
  it('fails a model body that is short behind an HTTP 200', async () => {
    const built = plan()
    // The classic silent truncation: the header says the right length, the body
    // stops early. Nothing in the ZIP structure would give this away.
    const { source } = sourceFor(built, (index) => (index === 1 ? { truncateTo: 4_000 } : {}))
    const stream = openArchiveStream(built, { source })
    await stream.prime()

    await expect(collect(stream.body())).rejects.toThrow(ModelLengthError)
  })

  it('fails a model body that is long, because the URL is content-addressed', async () => {
    const built = plan()
    const { source } = sourceFor(built, (index) =>
      index === 1 ? { bytes: modelBytes(1, 20_000), declaredLength: String(12_288) } : {},
    )
    const stream = openArchiveStream(built, { source })
    await stream.prime()

    await expect(collect(stream.body())).rejects.toThrow(ModelLengthError)
  })

  it('fails early on a content-length that disagrees, before transferring the body', async () => {
    const built = plan()
    const { fetcher, source } = sourceFor(built, (index) => (index === 0 ? { declaredLength: '999' } : {}))
    const stream = openArchiveStream(built, { source })

    await expect(stream.prime()).rejects.toThrow(ModelLengthError)
    // One request made, and the mismatch found from its headers rather than
    // after 33 MB of transfer.
    expect(fetcher.requested).toEqual([urlFor(0)])
  })

  it('fails the whole archive if its total is not exactly the predicted length', async () => {
    const built = plan()
    // The outer guard, exercised independently of the per-entry one: a plan that
    // promises one byte more than the entries can produce.
    const lying: ArchivePlan = { ...built, predictedLength: built.predictedLength + 1 }
    const { source } = sourceFor(built)
    const stream = openArchiveStream(lying, { source })
    await stream.prime()

    await expect(collect(stream.body())).rejects.toThrow(ArchiveLengthMismatchError)
  })

  it('cuts a runaway archive off mid-stream rather than after transferring it all', async () => {
    const built = plan()
    const lying: ArchivePlan = { ...built, predictedLength: 200 }
    const { source } = sourceFor(built)
    const stream = openArchiveStream(lying, { source })
    await stream.prime()

    const reader = stream.body().getReader()
    let read = 0
    await expect(
      (async () => {
        for (;;) {
          const { done, value } = await reader.read()
          if (value !== undefined) read += value.byteLength
          if (done) return
        }
      })(),
    ).rejects.toThrow(ArchiveLengthMismatchError)
    // Failed as soon as the promise was broken, not at the end of a 17 KB archive.
    expect(read).toBeLessThan(built.predictedLength)
  })

  it('names the direction and says why a short archive is not saved', () => {
    const error = new ArchiveLengthMismatchError(1_000, 900, 'wrote')
    expect(error.message).toContain('short')
    expect(error.message).toContain('records its sizes at the end')
    expect(new ArchiveLengthMismatchError(1_000, 1_100, 'wrote').message).toContain('long')
  })
})

describe('a bucket failure is surfaced, never absorbed', () => {
  it('surfaces a 403 from the first object before any response is written', async () => {
    const built = plan()
    const { source } = sourceFor(built, (index) => (index === 0 ? { status: 403 } : {}))
    const stream = openArchiveStream(built, { source })

    await expect(stream.prime()).rejects.toThrow(BucketFetchError)
    await expect(stream.prime()).rejects.toThrow(/1010/)
  })

  it('fails the archive on a 403 from a later object rather than finishing short', async () => {
    const built = plan()
    const { source } = sourceFor(built, (index) => (index === 2 ? { status: 403 } : {}))
    const stream = openArchiveStream(built, { source })
    await stream.prime()

    await expect(collect(stream.body())).rejects.toThrow(BucketFetchError)
  })

  it('sends a self-identifying User-Agent, without which the bucket answers 403', async () => {
    const built = plan()
    const { fetcher, source } = sourceFor(built)
    const stream = openArchiveStream(built, { source })
    await stream.prime()
    await collect(stream.body())

    expect(fetcher.agents).toHaveLength(built.models.length)
    for (const agent of fetcher.agents) {
      expect(agent).toContain('openforge-workshop-zip')
      expect(agent).toContain('github.com/MasterworkTools/openforge-workshop')
    }
  })

  it('refuses a redirect that left the models path', async () => {
    const built = plan()
    const { source } = sourceFor(built, (index) => (index === 0 ? { redirectedTo: 'https://example.invalid/thumbs/x.png' } : {}))
    await expect(openArchiveStream(built, { source }).prime()).rejects.toThrow(ModelUrlError)
  })

  it('refuses a body served as an image, which means the bucket is wrong', async () => {
    const built = plan()
    const { source } = sourceFor(built, (index) => (index === 0 ? { contentType: 'image/png' } : {}))
    await expect(openArchiveStream(built, { source }).prime()).rejects.toThrow(ModelUrlError)
  })

  it('spends its subrequest budget and fails rather than being cut off by the platform', async () => {
    const built = plan()
    const fetcher = fakeFetch(objectsFor(built))
    const source = bucketModelSource({ budget: subrequestBudget(2), fetchImpl: fetcher.impl })
    const stream = openArchiveStream(built, { source })
    await stream.prime()

    await expect(collect(stream.body())).rejects.toThrow(SubrequestBudgetError)
    expect(fetcher.requested).toHaveLength(2)
  })
})

describe('nothing is buffered', () => {
  it('fetches nothing until the archive is read', () => {
    const built = plan()
    const { fetcher, source } = sourceFor(built)
    openArchiveStream(built, { source })
    expect(fetcher.requested).toEqual([])
  })

  it('opens one body ahead and never more, so peak memory is a chunk not an archive', async () => {
    const sizes = [2_048, 2_048, 2_048, 2_048, 2_048, 2_048]
    const built = plan(sizes)
    const source = recordingSource((entry) => modelBytes(built.models.findIndex((model) => model.md5 === entry.md5), entry.bytes))
    const stream = openArchiveStream(built, { source, prefetch: 1 })
    await stream.prime()

    const reader = stream.body().getReader()
    for (;;) {
      const { done } = await reader.read()
      // At most the body being written plus the one opened ahead. Two of
      // Cloudflare's six simultaneous connections, whatever the archive size.
      expect(source.live).toBeLessThanOrEqual(2)
      if (done) break
    }
    expect(source.peakLive).toBeLessThanOrEqual(2)
    expect(source.opened).toHaveLength(sizes.length)
  })

  it('opens bodies progressively rather than all at once', async () => {
    const built = plan([2_048, 2_048, 2_048, 2_048, 2_048, 2_048])
    const source = recordingSource(() => modelBytes(0, 2_048))
    const stream = openArchiveStream(built, { source, prefetch: 1 })
    await stream.prime()

    // Priming opens exactly the first body; the rest wait for the reader.
    expect(source.opened).toHaveLength(1)

    const reader = stream.body().getReader()
    await reader.read()
    expect(source.opened.length).toBeLessThan(built.models.length)
    await reader.cancel('done with it')
  })

  it('cancels a prefetched body when the download is abandoned', async () => {
    const built = plan([2_048, 2_048, 2_048])
    const source = recordingSource(() => modelBytes(0, 2_048))
    const stream = openArchiveStream(built, { source, prefetch: 1 })
    await stream.prime()

    const reader = stream.body().getReader()
    await reader.read()
    await reader.cancel('the user closed the tab')
    stream.dispose()

    // Nothing left holding a connection open.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(source.live).toBe(0)
  })

  it('stops between entries when the request is aborted', async () => {
    const built = plan()
    const controller = new AbortController()
    const { source } = sourceFor(built)
    const stream = openArchiveStream(built, { source, signal: controller.signal })
    await stream.prime()
    controller.abort()

    await expect(collect(stream.body())).rejects.toThrow()
  })
})

describe('the md5 dedupe is the identity', () => {
  it('addresses every object by content, so two rows can never share a URL', () => {
    const built = plan()
    const urls = new Set(built.models.map((model) => model.url))
    expect(urls.size).toBe(built.models.length)
    built.models.forEach((model, index) => {
      expect(model.url).toContain(md5(index))
    })
  })
})
