# Written offer for the corresponding source code

This directory redistributes **OpenSCAD in executable form** (`openscad.wasm` and its
`openscad.js` loader) as part of the OpenForge Workshop. OpenSCAD is free software,
licensed under the **GNU General Public License, version 2**, with the CGAL linking
exception reproduced at the top of [`COPYING`](COPYING). The complete, unmodified licence
text sits next to the binary in this directory and is bundled into the same JavaScript
chunk that loads the binary, so it travels with every copy.

GPL-2 §3 requires that anyone who receives the executable can get the source it was built
from. This is that guarantee, in the §3(b) form.

## The offer

**For a period of three years from the date of the commit that added this file, the
maintainers of the OpenForge Workshop will give any third party, on request, a complete
machine-readable copy of the corresponding source code for the OpenSCAD executable
distributed here, on a medium customarily used for software interchange, for a charge no
more than the cost of physically performing the distribution.**

Request it by opening an issue on <https://github.com/F1nnM/openforge-workshop/issues>
titled `GPL source request: openscad-wasm`. State how you would like to receive it.

The offer covers the source code for the executable in this directory, the scripts used to
control its compilation and installation, and the complete source of any library whose code
is statically linked into it — which for a WebAssembly build is all of them, since there is
no dynamic linking. See *What "corresponding source" is here*, below.

## The exact release this offer is about

Naming the release precisely is the whole point of a source offer, so every identifier
below was read from the artefact or from a checksum published alongside it, not inferred.

| | |
| --- | --- |
| Program | **OpenSCAD** |
| Version, as the binary reports it | **`2026.01.02.wasm30346`** |
| Source commit, as the binary reports it | **`git 7a2053ed`** → `7a2053ed9cef679a77c148e149fb51ce118c4016` |
| Toolchain, as the binary reports it | **Emscripten 4.0.10**, `wasm32`, `1 CPU` |
| Upstream release artefact | `OpenSCAD-2026.01.02.wasm30346-WebAssembly-web.zip` |
| Downloaded from | <https://files.openscad.org/snapshots/OpenSCAD-2026.01.02.wasm30346-WebAssembly-web.zip> |
| Published checksum | `390b86b441b2fe8649e7acadf8267b359c6899c28af205625aaff160fcb9792b` — from `…zip.sha256` at the same URL, verified before extraction |
| Signed by | OpenPGP key `E2EBDADD336FF516ADD51A78F3E12CCC22164A0F` (`…zip.asc`), signature made 2026-01-02 13:51:08 UTC. **Not verified here** — the key is not on `keys.openpgp.org` and no trusted copy was obtained. The SHA-256 above is the check that was actually performed. |
| Licence | **GPL-2.0-only, with the CGAL linking exception** — `COPYING`, verbatim |

## Where the corresponding source is, right now

The offer above stands on its own, but nobody should have to invoke it. The source is
public, and these are the exact pointers:

- **The program.** <https://github.com/openscad/openscad> at commit
  [`7a2053ed9cef679a77c148e149fb51ce118c4016`](https://github.com/openscad/openscad/tree/7a2053ed9cef679a77c148e149fb51ce118c4016).
  That hash is not a guess: the binary prints it. `openscad.wasm --info` reports
  `OpenSCAD Version: 2026.01.02.wasm30346 (git 7a2053ed)`, and the AppImage from the same
  snapshot batch (`…ai30348`) reports the same `git 7a2053ed`.
- **The scripts used to control compilation.** <https://github.com/openscad/openscad-wasm>,
  also GPL-2.0. This is the Emscripten cross-build: it compiles OpenSCAD's dependency tree
  to WebAssembly and links the headless module. It is a separate repository from the
  program, which is why both are named here — a source offer that pointed only at
  `openscad/openscad` would omit the build system, and §3's definition of corresponding
  source includes it.

### What "corresponding source" is here, and the one thing this offer cannot promise

A WebAssembly build has no dynamic linking, so **every library is statically linked into
`openscad.wasm`**. GPL-2 §3's "complete source code" therefore reaches all of them. The
binary itself enumerates its dependencies and their versions, which is the useful starting
list — read out of the vendored file with `--info`:

> Boost 1_87 · Eigen 3.4.90 · CGAL 6.0.1-I-900 · Clipper2 1.5.2 · **Manifold 3.3.2** ·
> GLib 2.83.2 · lodepng 20230410 · libzip 1.11.4 · fontconfig 2.16.2 · freetype 2.13.3 ·
> harfbuzz 11.2.1 · lib3mf 2.3.2 · Clang 21.0.0git
> (`8f7e57485ee73205e108d74abb5565d5c63beaca`)

`openscad-wasm`'s build files pin the versions and patches for those, which is the second
reason it is named above rather than left implicit.

**The honest limit:** this project did not build the binary and does not hold a source
archive corresponding to it byte-for-byte. What it can supply on request is the two
repositories at the identifiers above, the pinned dependency set the build system names,
and the exact executable bytes it received — whose SHA-256 is in
[`MANIFEST.sha256`](MANIFEST.sha256), so a requester can confirm that what they are given
corresponds to what they were shipped. If upstream ever deletes commit `7a2053ed` or the
snapshot, honouring this offer means serving copies this project keeps, which is why the
identifiers are recorded here rather than only linked.

## What was and was not done to the program

- **Nothing was modified.** `openscad.wasm` and `openscad.js` are byte-for-byte the two
  members of the upstream zip. Verified by `cmp` against a freshly downloaded,
  checksum-verified archive; the hashes are in `MANIFEST.sha256` and a test re-checks them
  on every run.
- **Nothing was relicensed.** The engine stays GPL-2. This project's own code is not
  claimed to be, and no notice was stripped — the binary carries no textual notice to
  strip, and `COPYING` was copied in whole, including the CGAL exception header that
  precedes the licence.
- **Nothing was removed from `COPYING`.** Its GPL-2 body was diffed word-by-word against
  the FSF's canonical text: **zero differences inside the operative terms of §0–12.** The
  six differences that exist are all outside them — the 1991 FSF postal address, the
  Preamble's 1991 name for the LGPL ("Library" rather than "Lesser"), the appendix's
  fill-in-the-blank signatory, and the appendix's "write to the FSF" rather than a URL.
  These are the two published renderings of the same licence.
- **The engine is kept separable.** It lives here in `vendor/`, is loaded through a
  dynamically-imported chunk of its own, and this project's code talks to it across a
  worker message boundary. See `PROVENANCE.md` for what that does and does not settle.
