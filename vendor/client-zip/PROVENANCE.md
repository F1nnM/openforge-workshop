# client-zip — vendored, not depended on

`index.js`, `index.d.ts` and `LICENSE.txt` in this directory are **byte-for-byte** the
contents of the published npm tarball. Nothing here is edited; the project's own wrapper
lives in [`src/download/clientZip.ts`](../../src/download/clientZip.ts) and is the only
module allowed to import from here.

| | |
| --- | --- |
| Package | `client-zip` |
| Version | **2.5.0** |
| Published | 2025-03-14 |
| Upstream | <https://github.com/Touffy/client-zip> (`ef971082c8eb31827ebc2a67496f69ae29b465e6`) |
| Licence | MIT — see `LICENSE.txt`, retained as the licence requires |
| npm tarball | `sha512-ydG4nDZesbFurnNq0VVCp/yyomIBh+X/1fZPI/P24zbnG4dtC4tQAfI5uQsomigsUMeiRO2wiTPizLWQh+IAyQ==` |

SHA-256 of each vendored file, so a refresh that changes anything is visible in review:

```
e3925f8d6cffe101eb1c8f8e0afdd7ce76bfe00d6c316dd64971dbb5e18746d3  index.js    (6,463 bytes)
fc1ed40593f478e7234781483998be546408f4a1e4e7056098bc47ce4a1a49c6  index.d.ts  (2,827 bytes)
83a2636dca08f6f9449270dadebf88b54ff574198057c8764f019e23fd9dc596  LICENSE.txt (1,051 bytes)
```

## Why vendored rather than pinned

The full reasoning, with the counter-arguments, is in the header of
[`src/download/clientZip.ts`](../../src/download/clientZip.ts). The short version:

- **Maintenance is inactive but the scope is finished, not abandoned.** Last release
  2025-03; npm flags the package inactive. The repository is not archived, and upstream's
  own roadmap closes ZIP64 as "Done" and rejects compression on the grounds that it is
  incompatible with the length prediction this download path is built on. There is no
  pending work to miss.
- **6.4 KB, zero dependencies, standards-only.** `ReadableStream`, `TextEncoder`,
  `DataView`, `BigInt`. Nothing to keep current, and no transitive tree to audit.
- **An unpublish becomes a non-event.** A `dependencies` entry on an inactive
  single-maintainer package is a build that can stop resolving; a checked-in file is not.
- **The diff is reviewable.** 6.4 KB of minified but unobfuscated ES2020 that writes ZIP
  headers. This is the archive format the download hands to somebody's printer, so being
  able to read the exact bytes that will ship is worth more than a version range.

The cost is that security advisories and fixes do not arrive automatically. Accepted
knowingly: the library takes no untrusted input beyond entry names, performs no parsing,
and makes no network or filesystem calls of its own.

## Refreshing it

```sh
npm pack client-zip@<version>
tar xzf client-zip-<version>.tgz
cp package/index.js package/index.d.ts package/LICENSE.txt vendor/client-zip/
sha256sum vendor/client-zip/*
```

Then update the table above, re-read the diff, and run `npm test` — `src/download`'s tests
parse the emitted archive's central directory, so a behavioural change in the writer fails
them rather than shipping.
