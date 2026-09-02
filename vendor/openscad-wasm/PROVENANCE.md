# OpenSCAD WebAssembly — vendored, and somebody else's

`openscad.wasm` and `openscad.js` are **byte-for-byte copies** of the two members of one
published OpenSCAD snapshot archive. Nothing in them is edited, minified further, patched or
regenerated. `COPYING` is a byte-for-byte copy of the licence from the commit they were built
from. This project's own code sits around them — the driver in `src/generator/engine/` — and
they are treated the way `vendor/client-zip/` is treated: input, not source we maintain.

Same arrangement as `src/generator/PROVENANCE.md` describes for the `.scad` geometry, with
one difference that changes everything about this directory: **the geometry is Apache-2.0 and
the engine is GPL-2.** Row S3 was gated on blocker **B4** — a legal read on bundling a GPL-2
engine *inside* this app rather than conveying it separately. The project owner waived the
gate. The obligations did not go away, so they are discharged mechanically here rather than
argued: see *The licence, and how it is actually satisfied* below.

| | |
| --- | --- |
| Program | **OpenSCAD**, the WebAssembly build |
| Upstream | <https://github.com/openscad/openscad> · build system <https://github.com/openscad/openscad-wasm> |
| Release | **`OpenSCAD-2026.01.02.wasm30346-WebAssembly-web`** |
| Version, self-reported | **`2026.01.02.wasm30346`** |
| Source commit, self-reported | **`7a2053ed`** → `7a2053ed9cef679a77c148e149fb51ce118c4016` |
| Downloaded from | <https://files.openscad.org/snapshots/OpenSCAD-2026.01.02.wasm30346-WebAssembly-web.zip> |
| Archive SHA-256 | `390b86b441b2fe8649e7acadf8267b359c6899c28af205625aaff160fcb9792b` — matches the published `.zip.sha256` |
| Copied | 2026-09-02 |
| Licence | **GPL-2.0-only, with the CGAL linking exception** — `COPYING`, unmodified |
| Source offer | `WRITTEN-OFFER.md` — GPL-2 §3(b), naming this exact release |
| Copied files | `openscad.wasm` (10,531,863 B), `openscad.js` (99,718 B), `COPYING` (18,382 B) |
| Ours, not upstream's | `PROVENANCE.md`, `WRITTEN-OFFER.md`, `openscad.d.ts`, `MANIFEST.sha256`, `.gitattributes` |
| Checksums | `MANIFEST.sha256` — 3 lines, `sha256sum -c` compatible |
| Verify | `cd vendor/openscad-wasm && sha256sum -c MANIFEST.sha256` |
| Guarded by | `src/generator/engine/vendor.test.ts` (hashes, licence, memory flags, bundle discipline) |

```
fd887f516ff5accb2060d78bf1127cb357f52346e708f0f5970dc151d517d508  openscad.wasm
92d8730b548b721fff4203825eb932ea29bc78d5c0eeffdc93aa36a560d80868  openscad.js
1805a29c3bccbc0428ce0048a1dfdeb9b1867677410e99c89c3c30932ae8c7d5  COPYING
```

## The release identity was read out of the artefact, not inferred

This matters because a source offer that names the wrong commit is not a source offer. The
snapshots page publishes no source tarball and the filename carries only a build number, so
the temptation is to infer the commit from the publication date. That was not done.

Running the vendored binary with `--info` prints:

```
OpenSCAD Version: 2026.01.02.wasm30346 (git 7a2053ed)
System information: Emscripten 4.0.10 #1 wasm32 1 CPU 4.00 GB RAM
Compiler: Clang "21.0.0git (…llvm-project 8f7e57485ee73205e108d74abb5565d5c63beaca)"
CGAL version, kernels: 6.0.1-I-900, …    Manifold version: 3.3.2
```

So the commit is the binary's own claim. Two independent corroborations: the AppImage from
the same snapshot batch (`…ai30348`) reports the same `git 7a2053ed`, and
`7a2053ed9cef679a77c148e149fb51ce118c4016` is upstream `master` HEAD at
2026-01-02T13:42:55Z, eight minutes before the archive's GPG signature timestamp
(2026-01-02T13:51:08Z). `render.test.ts` asserts the live engine still reports exactly this.

`COPYING` was taken from that commit rather than from `master`, and the two are identical —
the file has not been touched upstream since 2012 (`c514f8041eca93bd3bb85b616be37a2d5ade3a48`,
*"Fixed FSF address"*), so there is no window in which the licence text and the build could
have diverged.

### What was verified, and what was not

- **Verified: the published SHA-256.** `sha256sum -c` against `…zip.sha256` from the same
  URL, before extraction, and the two extracted members `cmp` clean against the files here.
- **Not verified: the OpenPGP signature.** `…zip.asc` is signed by
  `E2EBDADD336FF516ADD51A78F3E12CCC22164A0F` (short id `F3E12CCC22164A0F`), but that key is
  not on `keys.openpgp.org` and no trusted copy of it was obtained, so `gpg --verify` returns
  *"Can't check signature: No public key"*. The signature's existence and its key id are
  recorded; the check that was actually performed is the SHA-256. Stated plainly because a
  reader would otherwise reasonably assume a signed artefact was signature-checked.

## The licence, and how it is actually satisfied

`COPYING` is the canonical GNU General Public License version 2, preceded by OpenSCAD's CGAL
linking exception. Checked rather than assumed: its GPL-2 body was diffed **word by word**
against the FSF's canonical text at
<https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt>, giving **six differences, none of
them inside the operative terms.** The terms and conditions occupy words 471–2483 of the
canonical text, and every difference falls outside that span:

| Where | Canonical (gnu.org) | `COPYING` |
| --- | --- | --- |
| front matter | `Inc., <https://fsf.org/>` | the 1991 postal address |
| Preamble | `Lesser General Public License` | `Library General Public License` — the LGPL's 1991 name |
| appendix | `see <https://www.gnu.org/licenses/>` | `write to the Free Software Foundation…` |
| appendix ×2 | `Moe Ghoul` | `Ty Coon` — the fictitious signatory in the template |
| appendix | `Lesser` | `Library`, again |

These are the two published renderings of the same licence: the original 1991 text, which is
what upstream ships, and gnu.org's modernised copy. **Not one byte of §0–12 differs.**

What GPL-2 asks of a redistribution of a binary, and what was done:

- **§1 — hand recipients the licence.** `COPYING`, unmodified. And not only in the
  repository: `src/generator/engine/licence.ts` imports it as `?raw`, so the text is bundled
  into the **same lazily-loaded chunk that loads the binary**. There is no build
  configuration and no deployment step in which the engine ships and the licence does not.
  The engine refuses to boot if the notice did not load — `assertNoticePresent` — so a
  tree-shake that dropped it fails on the first render instead of shipping quietly.
- **§3 — make the corresponding source available.** `WRITTEN-OFFER.md`, a §3(b) offer valid
  three years, naming this release, its digest, both upstream repositories and the commit.
  It also states what this project cannot promise: it did not build the binary and holds no
  byte-corresponding source archive.
- **§2(a) — modified files must say so.** Nothing is modified, so there is nothing to
  declare. `vendor.test.ts` asserts all three files' SHA-256, so this claim cannot rot
  without failing the build.
- **Nothing is relicensed.** The engine stays GPL-2; this project's own code makes no claim
  about its own licence here, and none of the engine's code is copied into `src/`.
- **No notice was stripped.** There is none in the binary to strip — checked, not assumed:
  `strings` over `openscad.wasm` finds no copyright or licence banner. `COPYING` was copied
  whole, including the exception header that precedes the licence proper.

### Separability, which is the other half of the arrangement

The engine is kept clearly separable from this project's code, and the reason is not only
legal hygiene — it is the same discipline that keeps three.js at a 1.5 kB eager cost:

- it lives in `vendor/`, which `eslint.config.js` ignores;
- `openscad.js` is imported by exactly three of this project's modules — `runtime.ts`,
  `spawn.ts` and `licence.ts` — and `vendor.test.ts` asserts that list;
- `openscad.wasm` is imported as `?url`, so it is emitted as a build asset and **enters no
  chunk at all**; and
- everything on this side of the boundary talks to it across a worker `postMessage`.

**Row S4 must surface the notice in the generator panel.** `loadEngineLicence()` in
`src/generator/engine/` returns the text, the offer and the source pointers for exactly that
purpose.

## Single-threaded, with unshared linear memory. No COOP/COEP.

`architecture-plan.md` §12: *"Cross-origin isolation is not required. Every shipped
openscad-wasm build is single-threaded with unshared linear memory… Do not set COOP/COEP on
the Workshop."* That is load-bearing rather than incidental — blocker **B6** exists because
without `Cross-Origin-Resource-Policy: cross-origin` on the bucket, cross-origin isolation
would block the entire catalog on day one. So it is confirmed on the vendored binary rather
than taken from release notes, three ways:

1. **The memory section.** The module declares **exactly one memory, defined in-module**,
   with limits `flags=0x01` — `has_max` set, **the `shared` bit (0x02) clear**, `mem64`
   clear — `min=256` pages (16 MiB), `max=65536` pages (4 GiB). **No memory is imported**:
   153 imports, none of kind `memory`, so there is no seam through which a host could hand
   this module a shared heap.
2. **The glue knows nothing about threads.** Zero occurrences of `SharedArrayBuffer`,
   `pthread`, `PThread`, `Atomics`, `ENVIRONMENT_IS_PTHREAD` or `new WebAssembly.Memory` in
   all 99,718 bytes of `openscad.js`.
3. **The engine says so.** `--info` reports `Emscripten 4.0.10 #1 wasm32 1 CPU`.

Asserted twice, so neither claim can rot: `vendor.test.ts` re-parses the memory section and
re-greps the glue, and `assertUnsharedMemory` in `runtime.ts` checks the **live**
`WebAssembly.Instance` at boot and refuses to run an engine whose exported memory is backed
by a `SharedArrayBuffer`.

One trap worth naming, because it would make that runtime check pass vacuously for ever.
**Emscripten does not publish the memory on the module object.** `openscad.js` keeps it in a
module-local `var wasmMemory` and assigns only `calledRun`, `callMain`, `ENV`, `ERRNO_CODES`,
`FS`, `_main`, `PATH`, `postRun`, `preInit` and `preRun` to `Module`. A check written against
`Module.wasmMemory` reads `undefined`; if it treats absence as acceptable it never checks
anything. `openscad.d.ts` therefore deliberately does **not** declare `wasmMemory`, and the
check reads the `WebAssembly.Instance`'s exports instead — where the memory is exported under
the minified name `Tb`.

## Two exit-code traps in this binary

S2 recorded the first and paid for it: *"The WASM build exits 7 on `--version` while printing
to stderr. S2's first probe trusted the exit code and silently fell through to native."*
Driven in-process through `callMain`, it is worse than a bad status. Measured on this file:

| argv | `callMain` returns | throws | where the text goes |
| --- | --- | --- | --- |
| `--version` | `undefined` | **yes** — `program has already aborted!` | stderr |
| `--info` | **`1`** | no | stdout |
| a successful render | `0` | no | — |

`--version`'s `exit(7)` becomes an Emscripten `ExitStatus`, surfacing as a throw *after* the
version has already been printed. And `--info` returns `1` for an unrelated reason: it cannot
create an offscreen GL context under WebAssembly. So neither "zero means fine" nor "non-zero
means broken" is a usable rule. `version.ts` treats the **output as the only signal**, and
the sole failure is the absence of a version line.

## One Emscripten instance serves exactly one render

Not a licence matter, but the sharpest trap in driving this file, so it belongs with the
other measurements. A second `callMain` on the same instance is refused:

| | first `callMain` | second `callMain` |
| --- | --- | --- |
| `noExitRuntime: false` | 109 ms, returns `0` | **0.1 ms, throws `program has already aborted!`** |
| `noExitRuntime: true` | 111 ms, returns `0` | **0.3 ms, throws `1839784`** |

The danger is what survives: `out.stl` from the first render is **still on the virtual
filesystem**, so a driver that reads the output path without checking whether the run happened
returns the *previous* mesh, at a plausible byte length, with no error. A parameter change
would appear to do nothing.

So `runtime.ts` reuses the compiled `WebAssembly.Module` and takes a **fresh instance per
render** — which is what pays S2's 281 ms startup floor once — and unlinks every output path
*before* running, so a stale read is impossible rather than merely unlikely.

## What it costs, and what it does, measured

Two builds of the app — one with `src/generator/engine/` and this directory present, one with
both moved aside — produced **the identical entry bundle down to its content hash**:
`index-2dMoR84-.js`, 591,300 bytes, 512 modules, either way. So 10.6 MB of vendored engine
plus 197 KB of vendored geometry currently cost the shipped app **nothing**, which is the
property S1 established for the geometry and this row inherits.

That is partly because nothing imports the engine yet. A second build, with a temporary entry
that reaches `loadGeneratorEngine()` and `loadEngineLicence()` — which is what row S4's panel
will do — emitted this split:

| Chunk or asset | Bytes | Fetched when |
| --- | --- | --- |
| the entry | **1,572** | always |
| `client-*.js` | 1,662 | the panel opens |
| `spawn-*.js` | 404 | the panel opens |
| `worker-*.js` | **298,062** | the first request |
| `licence-*.js` | 25,727 | the notice is displayed |
| `openscad-*.wasm` | **10,531,863** (3,258,940 gzipped) | the first request |

The worker chunk is the Emscripten glue plus the 35 `.scad` sources plus the GPL-2 notice, and
it contains **40 `include <`** occurrences — 39 statements and the one commented-out line S1
found — so the whole virtual filesystem really is in there. The `.wasm` asset `cmp`s clean
against the file in this directory: it is emitted, never bundled, and no chunk holds a base64
run longer than 200 characters.

### Timed in Chromium, through the worker, with no COOP or COEP

Served over plain HTTP with `Content-Type: application/wasm` and **no** cross-origin isolation
headers, driven headless (Chromium 1223, 12 cores). Warm figures discard the first render at
each size; `n = 6` each.

| | wall median | wall p95 | inside `main` | fresh instance |
| --- | --- | --- | --- | --- |
| 1×1 | **32.2 ms** | 37.6 ms | 21.7 ms | 6.6 ms |
| 2×2 | **64.5 ms** | 67.8 ms | 53.3 ms | 5.9 ms |
| 4×4 | **102.1 ms** | 107.1 ms | 91.4 ms | 5.5 ms |

- **Against S2's 437 ms median / 481 ms p95 at 4×4**, this is 4.3× faster. Not a faster
  engine — the same one. S2's harness spawned a Node process per render, so every render
  re-read 14 MB of glue and recompiled the module. Here one worker served **21 renders on one
  compile**, and the per-render fixed cost is the ~6 ms fresh instance rather than the
  ~281 ms startup floor.
- **Cold first request: 170.5 ms**, covering the asset fetch, `WebAssembly.compile` (14.8 ms
  as Chromium reports it, which is baseline compilation and defers the rest) and one instance
  running `--info`. Over a real network the 10.5 MB transfer dominates this, not the compile.
- Importing the lazy chunk: **3.6 ms**.
- `--export-format=param` for `bases-square.scad`: **24.6 ms**, yielding **15 parameters in 8
  groups**.
- The page reported **`crossOriginIsolated: false`** and **`typeof SharedArrayBuffer ===
  'undefined'`** throughout. The engine is not merely compatible with the absence of
  COOP/COEP; it was measured in a context where a `SharedArrayBuffer` does not exist.

## Refreshing

There is no refresh script, deliberately. `scripts/refresh-scad.ts` exists for the geometry
because upstream's `.scad` files change often and the diff is readable; a 10.5 MB binary's
diff is not, and adopting a new engine is a decision that needs a human to re-check the
licence, the memory flags and the latency, not a `--write` flag.

The manual procedure:

```sh
V=OpenSCAD-<version>-WebAssembly-web
curl -sSLO https://files.openscad.org/snapshots/$V.zip
curl -sSLO https://files.openscad.org/snapshots/$V.zip.sha256
sha256sum -c $V.zip.sha256
unzip -q $V.zip -d /tmp/engine
node -e 'require("/tmp/engine/openscad.js")' # or run --info, to read the git hash
```

Then, and all of these or none:

1. copy `openscad.js` and `openscad.wasm` in, and re-copy `COPYING` from the commit the new
   binary reports;
2. regenerate `MANIFEST.sha256`;
3. update `ENGINE_SHA256`, `ENGINE_BYTES`, `ENGINE_VERSION` and `ENGINE_SOURCE_COMMIT` in
   `src/generator/engine/verify.ts`;
4. update the release, digests and commit in `WRITTEN-OFFER.md` **and** this file;
5. re-check the memory section and the glue's thread markers;
6. re-run `npx vitest run src/generator`, which fails on every one of the above until it is
   done, and `npm run build`, which is where a size regression shows up.

Step 4 is the one that matters most and the one a script would get wrong: a new binary with
an old source offer is a compliance failure that no test can detect on its own, which is why
`vendor.test.ts` cross-checks the offer's text against the constants in `verify.ts`.
