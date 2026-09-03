/**
 * The refusal surface.
 *
 * Every case here is a way a request could produce an archive that looks fine
 * and extracts wrongly, or one this Worker cannot finish. The two that matter
 * most are the md5 dedupe and the entry-name uniqueness: 171 md5s are shared by
 * 520 catalog rows, and 89 filenames carry two or three genuinely different
 * meshes, so both are live properties of this corpus rather than defensive
 * hypotheticals.
 */
import { describe, expect, it } from 'vitest'

import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_FILES, SUBREQUEST_LIMIT, SUBREQUEST_RESERVE } from './limits'
import { ZIP_REQUEST_VERSION, ZipRequestError, readArchiveRequest, validateArchiveRequest } from './request'
import { md5, requestBody, requestFile } from './testing/fixtures'

function refusal(body: unknown): ZipRequestError {
  try {
    validateArchiveRequest(body)
  } catch (error) {
    if (error instanceof ZipRequestError) return error
    throw error
  }
  throw new Error('the request was accepted')
}

describe('a well-formed request', () => {
  it('is accepted and its totals are derived, not trusted', () => {
    const body = requestBody([requestFile(1, { bytes: 100 }), requestFile(2, { bytes: 250 })])
    // A bill's `download.bytes` is the sum over deduplicated lines, and
    // `LICENSE.txt` prints it — so it is computed here rather than read off the
    // wire, where a stale client could disagree.
    const request = validateArchiveRequest({ ...body, modelBytes: 999_999 })
    expect(request.modelBytes).toBe(350)
    expect(request.files).toHaveLength(2)
    expect(request.generatedAt.toISOString()).toBe('2026-09-02T10:00:00.000Z')
  })

  it('keeps the caller row order, because the order is the prediction', () => {
    const request = validateArchiveRequest(requestBody([requestFile(3), requestFile(1), requestFile(2)]))
    expect(request.files.map((file) => file.md5)).toEqual([md5(3), md5(1), md5(2)])
  })
})

describe('the whole-archive invariants', () => {
  it('refuses a repeated md5, which is a caller that lost the bill dedupe', () => {
    const error = refusal(requestBody([requestFile(1), requestFile(1, { name: 'models/other.stl' })]))
    expect(error.code).toBe('duplicate_blob')
    expect(error.status).toBe(400)
  })

  it('refuses two meshes under one entry name, which every extractor resolves by keeping the last', () => {
    const error = refusal(requestBody([requestFile(1, { name: 'models/wall.stl' }), requestFile(2, { name: 'models/wall.stl' })]))
    expect(error.code).toBe('duplicate_entry_name')
  })

  it('refuses an entry that is also a directory', () => {
    const error = refusal(
      requestBody([requestFile(1, { name: 'models/cave' }), requestFile(2, { name: 'models/cave/wall.stl' })]),
    )
    expect(error.code).toBe('entry_is_directory')
  })

  it('refuses an empty archive rather than shipping a licence with no models', () => {
    expect(refusal(requestBody([])).code).toBe('empty_archive')
  })
})

describe('the budgets', () => {
  it('refuses more files than the subrequest allowance, and says to use the URL list', () => {
    const files = Array.from({ length: MAX_ARCHIVE_FILES + 1 }, (_unused, index) =>
      requestFile(index, { name: `models/wall-${String(index)}.stl` }),
    )
    const error = refusal(requestBody(files))
    expect(error.status).toBe(413)
    expect(error.code).toBe('too_many_files')
    expect(error.message).toContain('URL list')
    expect(error.message).toContain(String(SUBREQUEST_LIMIT))
  })

  it('sizes that budget from the Cloudflare subrequest cap', () => {
    expect(MAX_ARCHIVE_FILES).toBe(SUBREQUEST_LIMIT - SUBREQUEST_RESERVE)
  })

  it('leaves the 1.6 GB worst case far inside the file budget', () => {
    // 50 placements at the corpus p95 of 32.87 MB — the case this row exists
    // for. One subrequest per file.
    const worstCaseFiles = 50
    expect(worstCaseFiles).toBeLessThan(MAX_ARCHIVE_FILES)
    expect(worstCaseFiles / SUBREQUEST_LIMIT).toBeCloseTo(0.05, 5)
  })

  it('refuses the whole corpus, which is 9.28x the file budget', () => {
    const corpusBlobs = 8_353
    expect(corpusBlobs).toBeGreaterThan(MAX_ARCHIVE_FILES)
    expect(corpusBlobs / MAX_ARCHIVE_FILES).toBeCloseTo(9.28, 2)
  })

  it('refuses more bytes than it can stream in a sitting', () => {
    const error = refusal(requestBody([requestFile(1, { bytes: MAX_ARCHIVE_BYTES + 1 })]))
    expect(error.status).toBe(413)
    expect(error.code).toBe('archive_too_large')
    expect(error.message).toContain('URL list')
  })

  it('accepts the 1.6 GB worst case', () => {
    const files = Array.from({ length: 50 }, (_unused, index) =>
      requestFile(index, { name: `models/wall-${String(index)}.stl`, bytes: 32_870_000 }),
    )
    expect(validateArchiveRequest(requestBody(files)).modelBytes).toBe(1_643_500_000)
  })
})

describe('the shape', () => {
  it('refuses a version it does not speak, and says to reload', () => {
    const error = refusal(requestBody([requestFile(1)], { v: ZIP_REQUEST_VERSION + 1 }))
    expect(error.code).toBe('bad_version')
    expect(error.message).toContain('Reload')
  })

  it.each([
    ['not an object', 'bad_shape'],
    [{ v: ZIP_REQUEST_VERSION }, 'bad_shape'],
  ])('refuses a body that is %s', (body, code) => {
    expect(refusal(body).code).toBe(code)
  })

  it('refuses a filename that would break Content-Disposition or name a path', () => {
    for (const filename of ['room"; x.zip', 'room.zip\r\nX: y', '../room.zip', 'room/x.zip', 'room.txt', '.zip']) {
      expect(refusal(requestBody([requestFile(1)], { filename })).code).toBe('bad_filename')
    }
  })

  it('refuses a timestamp that is not a date, because LICENSE.txt prints it', () => {
    expect(refusal(requestBody([requestFile(1)], { generatedAt: 'whenever' })).code).toBe('bad_timestamp')
  })

  it.each([
    [{ md5: 'nope' }, 'bad_md5'],
    [{ md5: md5(1).toUpperCase() }, 'bad_md5'],
    [{ bytes: -1 }, 'bad_bytes'],
    [{ bytes: 1.5 }, 'bad_bytes'],
    [{ bytes: 'big' as unknown as number }, 'bad_bytes'],
    [{ copies: 0 }, 'bad_copies'],
    [{ paths: [] }, 'bad_paths'],
  ])('refuses a row with %o', (overrides, code) => {
    expect(refusal(requestBody([requestFile(1, overrides)])).code).toBe(code)
  })
})

describe('entry names', () => {
  it('accepts the corpus characters that look alarming and are not', () => {
    // 1,249 corpus paths carry a non-ASCII character, and `#`, `+`, `,` and `%`
    // are everywhere. They are only special in URLs.
    const name = 'models/cave/plain#base+angled.2x+60°.dragonlock,magnetic+flex%2.stl'
    expect(validateArchiveRequest(requestBody([requestFile(1, { name })])).files[0]?.name).toBe(name)
  })

  it('accepts the ~{md5} disambiguator entries.ts appends', () => {
    const name = `models/tudor/door+narrow~${md5(1)}.stl`
    expect(validateArchiveRequest(requestBody([requestFile(1, { name })])).files[0]?.name).toBe(name)
  })

  it.each([
    ['cave/wall.stl', 'bad_entry_name'],
    ['models/../../etc/passwd', 'bad_entry_name'],
    ['models/./wall.stl', 'bad_entry_name'],
    ['models//wall.stl', 'bad_entry_name'],
    ['models/cave\\wall.stl', 'bad_entry_name'],
    ['models/wall.stl ', 'bad_entry_name'],
    ['models/wall\n.stl', 'bad_entry_name'],
    ['models/wall?.stl', 'bad_entry_name'],
    ['models/wall:1.stl', 'bad_entry_name'],
    ['models/cave./wall.stl', 'bad_entry_name'],
    ['models/cave /wall.stl', 'bad_entry_name'],
    ['models/ cave/wall.stl', 'bad_entry_name'],
    ['LICENSE.txt', 'reserved_entry_name'],
    ['ATTRIBUTION.csv', 'reserved_entry_name'],
  ])('refuses %s', (name, code) => {
    expect(refusal(requestBody([requestFile(1, { name })])).code).toBe(code)
  })

  it('refuses a name past the byte cap, counting UTF-8 rather than code units', () => {
    expect(refusal(requestBody([requestFile(1, { name: `models/${'°'.repeat(600)}.stl` })])).code).toBe('bad_entry_name')
  })
})

describe('reading a request', () => {
  it('accepts application/json, which is what fetch sends', async () => {
    const request = new Request('https://workshop.openforge.tools/zip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody([requestFile(1)])),
    })
    expect((await readArchiveRequest(request)).files).toHaveLength(1)
  })

  it('accepts a form field, which is what a navigation sends — the only shape iOS can use', async () => {
    const form = new URLSearchParams({ build: JSON.stringify(requestBody([requestFile(1)])) })
    const request = new Request('https://workshop.openforge.tools/zip', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    expect((await readArchiveRequest(request)).files).toHaveLength(1)
  })

  it('refuses a form with no build field', async () => {
    const request = new Request('https://workshop.openforge.tools/zip', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'other=1',
    })
    await expect(readArchiveRequest(request)).rejects.toMatchObject({ code: 'missing_field', status: 400 })
  })

  it('refuses a content type it does not know', async () => {
    const request = new Request('https://workshop.openforge.tools/zip', { method: 'POST', headers: { 'content-type': 'text/xml' }, body: '<x/>' })
    await expect(readArchiveRequest(request)).rejects.toMatchObject({ code: 'unsupported_media_type', status: 415 })
  })

  it('refuses a body that is not JSON', async () => {
    const request = new Request('https://workshop.openforge.tools/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    await expect(readArchiveRequest(request)).rejects.toMatchObject({ code: 'malformed_json', status: 400 })
  })
})
