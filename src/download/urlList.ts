/**
 * The degradation path: a list of URLs instead of an archive.
 *
 * §11: *"Size is a warning surface. A 50-placement room at p95 is well over a
 * gigabyte. Warn above a threshold and offer a URL list as the degradation
 * path."* This is that offer, and it is the answer to three situations the ZIP
 * path cannot serve:
 *
 *   - an archive above `BLOB_FALLBACK_LIMIT_BYTES` (512 MB) on a browser with no
 *     streaming save — iOS Safari, always;
 *   - a room past the bill's `huge` verdict (2 GB), where a progress bar is a
 *     promise nobody should make over a phone connection;
 *   - a user who would rather feed the list to `wget` or a download manager and
 *     walk away.
 *
 * Two artefacts, and the second is not optional: the URL list carries no
 * attribution, so a caller offering it must offer `ATTRIBUTION.csv` alongside —
 * which the plan already holds, as its second entry. §10's obligation does not
 * lapse because the transport changed.
 *
 * The list is plain URLs, one per line, no comments and no blank lines, because
 * that is the only format `wget -i` and `curl` both accept. It is deliberately
 * *not* a shell script: handing somebody a script to run is a different kind of
 * ask, and a paste-into-a-download-manager list is what people actually want.
 */
import type { ArchivePlan } from './plan'

/**
 * One URL per model, in archive order, newline-terminated.
 *
 * Deduped already — the plan holds one entry per distinct md5 — so a file shared
 * by nine catalog rows is listed once, exactly as the archive would hold it once.
 *
 * Note what is lost by taking this path: the URLs end in `{md5}.stl`, so every
 * file lands on disk under its content address rather than under a readable name,
 * and the entry-name disambiguation that keeps 89 colliding filenames apart does
 * not apply. That is a feature here, not a regression — md5 filenames cannot
 * collide — but it does mean the `entry` column of `ATTRIBUTION.csv`
 * is the only way back to a human-readable name.
 */
export function urlListText(plan: ArchivePlan): string {
  return plan.files.map((file) => file.url).join('\n') + '\n'
}

/** The suggested filename for {@link urlListText}, matching the archive's stem. */
export function urlListFilename(plan: ArchivePlan): string {
  return plan.filename.replace(/\.zip$/, '') + '-urls.txt'
}
