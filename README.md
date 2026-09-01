# OpenForge Workshop

A catalog and room builder for the [OpenForge](https://openforge.tools) library of
3D-printable modular dungeon terrain.

Browse ~8,700 tiles with real previews, keep a library of the pieces you actually print
with, lay out a room on a virtual workbench, and download exactly the STL files that build
needs — plus generate parametric bases on the fly.

## Status

**Planning.** Nothing is implemented yet. The architecture plan is in
[`docs/architecture-plan.md`](docs/architecture-plan.md).

## What this is, and is not

This is a **separate project** from `openforge-catalog`. It shares two things with it and
nothing else:

- **Assets** — STL files and sprite-sheet previews are served from the existing public
  Cloudflare R2 bucket at `objects.openforge.tools`. This project never writes to it.
- **Metadata** — tile data is imported at build time from the catalog repo's JSON
  fixtures and compiled into a static index. There is no shared database, no shared API,
  and no shared code.

It deliberately does not follow the catalog's architecture, conventions, or stack.

## Shape

Static single-page app, no always-on backend. The whole catalog index ships to the browser,
so search and filtering need no server at all. See the plan for the full picture.

## Getting started

The toolchain is pinned in `mise.toml` — Node and Python versions, and the tasks
that wrap them. [mise](https://mise.jdx.dev) is the only prerequisite.

```bash
mise install      # fetch the pinned toolchain
mise run setup    # npm ci
mise run check    # lint, typecheck, test, build — the same order CI runs
mise run facts    # re-derive the catalog numbers the plan quotes
npm run dev       # dev server
```

The Node floor is a constraint, not a preference. `wrangler` requires 22, and on
Node 20 npm silently resolves down to a version that violates its own peer range;
`jsdom` then pushes the floor to 22.22.2. `mise.toml` holds the exact version.

## Repository layout

| Path | What it holds |
| --- | --- |
| `design/` | Source of the approved visual design, mirrored from Claude Design |
| `docs/` | Architecture plan, design contract, and the research behind them |

## Licensing

**Unresolved — see the plan.** The OpenForge models are CC BY-NC-SA 4.0 as distributed,
and the upstream OpenSCAD web harness is GPL-3.0. Both constrain what this project can be
and how it can be deployed. Do not publish anything until that section is settled.
