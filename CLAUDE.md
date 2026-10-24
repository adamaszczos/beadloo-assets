# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is a **data-asset pipeline package**, not an application. It scrapes bead catalogs from manufacturer websites, downloads original bead images, generates thumbnails and color/metadata tables, and uploads originals to Vercel Blob. The published npm package (`@adamaszczos/beadloo-assets`) ships only the `beads/**` directory (see `files` in `package.json`); everything in `scripts/`, `downloaded/`, `generated/`, and `outputs/` is build tooling and intermediate state.

## Commands

```bash
pnpm install              # Install dependencies (pnpm, not npm)
pnpm test                 # Run all unit tests (vitest)
pnpm test:watch           # Watch mode
pnpm test -- <pattern>    # Run a subset by file pattern
npx vitest run tests/beads/toho/round/sync.test.ts   # Run a single test file
npx tsc --noEmit          # Type-check without emitting
```

Every supported bead brand+type exposes exactly two pnpm scripts following the `beads:<brand>:<type>:<verb>` namespace:

```bash
pnpm beads:<brand>:<type>:sync    # Full local pipeline: scrape → download → thumbnails → colors → metadata → validate
pnpm beads:<brand>:<type>:blob    # Diff local originals vs Vercel Blob (add -- --upload to push)
```

Supported pairs today: `miyuki:delica`, `miyuki:round_rocailles`, `preciosa:rocailles`, `toho:round`.

Miyuki is sourced from official Miyuki data only (issue adamaszczos/beadloo#203). The two Miyuki syncs read
the committed directory dump `sources/miyuki/directory/products.json` (`pnpm beads:miyuki:directory -- --fetch`
refreshes it, throttled, and exits 1 on any unparsed product name) and record every added bead in
`sources/miyuki/registry/`. `pnpm beads:miyuki:audit` compares `beads/miyuki/**` with the official sources and
fails on a bead without a valid registry row, on a broken retailer rule (the `confirmation: "Retailer"` beads)
and on a colour number whose glass or finish differs between sizes. Never add URL guessing to a Miyuki script:
the directory's Wordfence blocks a client that 404s too often, for hours. `sources/miyuki/README.md` lists the snapshots and their hashes.

Miyuki's `-1` colours (`DB106-1`, `366-1`) are products of their own, not new names for the plain
numbers: the official Delica list gives them a Glass Enamel finish while the directory still sells the
plain number under its old finish, and sample card N-2 photographs a different strand. So the plain
number stays the directory's bead and the `-1` is a separate bead (the 51 Delica at 11/0, photo from
card N-2 via `pnpm beads:miyuki:sample-cards:add-delica`); never alias one to the other or rename one
into the other. A round-rocaille `-1` seed number comes in only at a size an official source states:
card TE-64 photographs nine of the Delica list's eleven at 15/0, 11/0, 8/0 and 6/0 (and `429-1` and
`3551L-1`, which the list does not name; `pnpm beads:miyuki:sample-cards:add-glass-enamel`), while
`2562-1` and `3318-1` have no official size and stay in `hold-out.csv`. A card, the catalogue and the
directory print the plain number, and their adders keep it.

Common flags (passed after `--`): `--local-only` (rebuild from already-downloaded files, no network), `--sizes 11,15` (limit sizes), `--dry-run`, `--force`, `--verbose`. Blob uploads require a `BLOB_READ_WRITE_TOKEN` env var (see `.env`). The full flag reference and per-type size defaults live in **`scripts/beads/README.md`**.

## Architecture

The directory hierarchy intentionally mirrors the pnpm script namespace: `beads:<brand>:<type>` ↔ `scripts/beads/<brand>/<type>/`. Each brand+type owns its complete pipeline in a self-contained `sync.ts`, plus a thin `blob.ts` entry point that wraps the shared blob library.

```
scripts/beads/
├── common/              # Brand-agnostic pipeline stages + shared libs
│   ├── extract-colors.ts, generate-metadata.ts, validate-bead-type.ts
│   └── lib/{paths,blob,thumbnails,beadRender}.ts
├── miyuki/common/       # Shared across Miyuki types (directory dump, registry, official lists, aliases)
├── miyuki/{delica,round_rocailles}/   # sync.ts + blob.ts per type
├── preciosa/rocailles/  # + lib/config.ts (size tables)
└── toho/round/          # + lib/config.ts (size tables, dimension normalization)
```

**Data flows through three sibling directories at the repo root, all resolved exclusively through `common/lib/paths.ts`:**

- `downloaded/<brand>/<type>/<size>/` — original full-size images pulled from catalogs (intermediate, not published)
- `beads/<brand>/<type>/<size>/` — published `_16x16` and `_48x48` thumbnail derivatives (the npm package payload)
- `generated/data/<brand>/<type>/` — per-size `<size>-colors.json` and `<size>-metadata.json`, plus the consolidated `generated/data/bead-metadata.ts` aggregating every type

`paths.ts` is the single source of truth for filesystem layout — **never hard-code `beads/`, `downloaded/`, or `generated/` paths elsewhere.** It also drives discovery: `discoverBeadTypesOnDisk()` and `discoverGeneratedMetadataFiles()` walk these trees, and the `<brand>-<type>` ↔ `<brand>/<type>` mapping (e.g. `miyuki-delica` ↔ `miyuki/delica`) is centralized in `getBeadTypeSegments()`. Data-output roots are overridable via `BEAD_ASSETS_DATA_DIR` / `BEAD_ASSETS_OUTPUTS_DIR` env vars.

All sync pipelines run the same six stages in order: **scrape → download → thumbnails → colors → metadata → validate**. The **16×16** thumbnail is a single-bead *render* (`common/lib/beadRender.ts`): shape/material/finish come from the bead's `.metadata.json` sidecar and the colour is sampled from the source photo — it is **not** a crop of the (multi-bead) source pile. These 16×16 images are what Beadloo's pattern-preview feature consumes. The **48×48** derivative is intentionally a plain centre crop and is not used by the preview. The validate stage classifies issues as errors (must-fix: missing files, invalid JSON), warnings (e.g. duplicate colors), and info.

Blob sync uses a **manifest-based SHA-256 diff**: it hashes local originals against a stored manifest (e.g. `outputs/preciosa-rocailles-blob-manifest.json`) to decide what to upload, so re-running without changes is a no-op.

## Conventions

- TypeScript strict mode, ES2020, ESM. **Use `.js` extensions in import paths** (required by the `bundler` module resolution). **No default exports** — named exports only.
- Place pure functions and types near the top of files; side-effects (fs, network) near the bottom. Keep parsing logic separate from I/O so the pure helpers stay unit-testable, and export them.
- Tests mirror the script tree: `scripts/beads/foo/bar.ts` → `tests/beads/foo/bar.test.ts`.
- Size tables and dimension normalization belong in each type's `lib/config.ts` — import them, don't duplicate lookup logic.
- When adding a new brand/type, follow the nesting and the checklist in `scripts/beads/README.md` ("Adding a New Bead Brand or Type"): new `sync.ts`/`blob.ts`, two `package.json` scripts, mirrored data dirs, and mirrored tests. Also register the new `<brand>-<type>` segment mapping in `paths.ts` if it isn't derivable from the default `split('-')`.

See `AGENTS.md` and `scripts/beads/README.md` for additional detail.
