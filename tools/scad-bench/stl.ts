/**
 * Reading the output, because the exit code is not the result.
 *
 * From `docs/base-generator-integration.md` §3.4, on OpenSCAD's error channel:
 *
 * > Never trust the exit code. Check the triangle count in the output STL header
 * > (bytes 80–83). Zero triangles is a failure regardless of what `callMain`
 * > returned.
 *
 * That matters more for a benchmark than for the app. A configuration the
 * geometry refuses — `dragonlock` on a non-inch basis, say — exits 0, writes a
 * well-formed 84-byte STL with a zero triangle count, and does it very fast. Timed
 * naively it becomes the quickest row in the table and the headline number is a
 * measurement of nothing.
 *
 * The triangle count is also the point of comparison the plan asked for: its
 * latency estimates were derived from catalog STL byte sizes via
 * `triangles = (bytes − 84) / 50`, so reading the same quantity back out of a
 * real render is what lets the extrapolation be checked rather than replaced.
 */

/** Binary STL: 80-byte header, uint32 count, then 50 bytes per facet. */
export const STL_HEADER_BYTES = 80
export const STL_COUNT_BYTES = 4
export const STL_FACET_BYTES = 50

export interface StlSummary {
  readonly bytes: number
  readonly triangles: number
}

/** The count the plan's extrapolation used: `(bytes − 84) / 50`. */
export function trianglesFromBytes(bytes: number): number {
  return (bytes - STL_HEADER_BYTES - STL_COUNT_BYTES) / STL_FACET_BYTES
}

/**
 * Triangle count and size, or a reason the output is not a usable render.
 *
 * Refuses ASCII STL explicitly. `export.cc:102` aliases the `stl` suffix to
 * `asciistl`, so a harness that lost its `--export-format=binstl` would silently
 * start measuring the exporter instead of the kernel; catching it here means that
 * mistake surfaces as an error rather than as a slower graph.
 */
export function readStl(data: Uint8Array): { ok: true; summary: StlSummary } | { ok: false; reason: string } {
  // ASCII is checked before length: an ASCII STL can be shorter than a binary
  // header, and "too short" would be a true but useless diagnosis of it.
  if (isAscii(data)) {
    return {
      ok: false,
      reason:
        'output is ASCII STL, not binary — --export-format=binstl was lost. ' +
        'export.cc aliases the `stl` suffix to `asciistl`.',
    }
  }
  if (data.length < STL_HEADER_BYTES + STL_COUNT_BYTES) {
    return { ok: false, reason: `output is ${String(data.length)} bytes, too short for an STL header` }
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const triangles = view.getUint32(STL_HEADER_BYTES, true)
  if (triangles === 0) {
    return {
      ok: false,
      reason: 'zero triangles: OpenSCAD emitted no geometry. Exit code 0 does not mean it rendered.',
    }
  }
  const expected = STL_HEADER_BYTES + STL_COUNT_BYTES + triangles * STL_FACET_BYTES
  if (data.length !== expected) {
    return {
      ok: false,
      reason:
        `header claims ${String(triangles)} triangles (${String(expected)} bytes) but the file is ` +
        `${String(data.length)} bytes — truncated or not binary STL`,
    }
  }
  return { ok: true, summary: { bytes: data.length, triangles } }
}

/** `solid` at the start is the ASCII form's only marker. */
function isAscii(data: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(data.subarray(0, 6)).toLowerCase()
  return head.startsWith('solid ') || head.startsWith('solid\n') || head.startsWith('solid\r')
}

/**
 * The `ERROR:` lines the `.scad` files echo, since there is not one `assert()`
 * in the set and `echo()` is the whole error channel.
 */
export function echoedErrors(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => /ECHO:\s*"?ERROR/i.test(line) || /^ERROR:/i.test(line.trim()))
    .map((line) => line.trim())
}

/**
 * `Ignoring unknown variable "X"` warnings, deduplicated with their counts.
 *
 * Worth surfacing rather than swallowing: the vendored set at the pinned commit
 * emits `Ignoring unknown variable "DUAL" in file connectors.scad` on every
 * square render, because the upstream commit that added dual connector walls
 * references `DUAL` from `connectors.scad` without any entry point declaring it.
 * It is upstream's, not ours, and it changes what the default geometry is.
 */
export function unknownVariables(stderr: string): { name: string; occurrences: number }[] {
  const counts = new Map<string, number>()
  for (const line of stderr.split('\n')) {
    const match = /Ignoring unknown variable "([^"]+)"/.exec(line)
    if (match?.[1] !== undefined) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, occurrences]) => ({ name, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name))
}
