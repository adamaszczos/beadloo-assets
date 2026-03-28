# Project Guidelines

## Code Style

- TypeScript strict mode, ES2020 target, ESM (`import/export`)
- Use `.js` extensions in all import paths (required by bundler module resolution)
- No default exports—use named exports everywhere
- Place pure functions and types near the top of files; side-effects (fs, network) near the bottom

## Architecture

```
scripts/beads/
├── common/              # Shared across all bead brands
│   ├── lib/paths.ts     # Central path resolution (BEADS_ROOT, getBeadTypeDirectory, etc.)
│   ├── lib/blob.ts      # Vercel Blob diff + upload (manifest-based SHA-256)
│   ├── lib/thumbnails.ts# 16×16 / 48×48 derivative generation (Sharp + SVG overlay)
│   └── *.ts             # Brand-agnostic scripts (extract-colors, generate-metadata, validate)
├── miyuki/
│   ├── common/          # Shared across Miyuki bead types (scrape-metadata)
│   └── delica/          # Miyuki Delica specific (sync.ts, blob.ts)
├── toho/
│   └── round/           # TOHO Round specific (sync.ts, blob.ts, lib/config.ts)
└── README.md            # Full script reference and usage examples
```

Directory hierarchy mirrors the `pnpm` script namespace: `beads:<brand>:<type>:sync`, `beads:<brand>:<type>:blob`.

Every brand+type pair exposes exactly two commands: `:sync` (full local pipeline) and `:blob` (Vercel Blob upload).

When adding a new bead brand or type, follow the same nesting: `scripts/beads/<brand>/<type>/`.

## Build and Test

```bash
pnpm install              # Install dependencies
pnpm test                 # Run all unit tests (vitest)
pnpm test -- <pattern>    # Run tests matching a file pattern
npx tsc --noEmit          # Type-check without emitting
```

All `pnpm beads:*` scripts are documented in [scripts/beads/README.md](scripts/beads/README.md).

## Conventions

- Test files live in the `tests/` directory, mirroring the `scripts/` structure: `scripts/beads/foo/bar.ts` → `tests/beads/foo/bar.test.ts`
- Keep sync/scraping scripts self-contained—each brand+type owns its full pipeline
- `paths.ts` is the single source of truth for all filesystem paths—never hard-code `beads/` paths elsewhere
- Config modules (e.g. `toho/round/lib/config.ts`) own size tables and normalization; import them instead of duplicating lookup logic
- Pure helper functions should be exported so they are unit-testable; I/O-heavy functions should be separated from parsing logic
