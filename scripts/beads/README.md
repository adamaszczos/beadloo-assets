# Bead Scripts

Scripts for syncing and managing bead data, organized by brand and type.

Every brand+type pair exposes exactly two pnpm commands:

| Command | Purpose |
|---------|---------|
| `pnpm beads:<brand>:<type>:sync` | Scrape, download, generate thumbnails, extract colors, build metadata, validate |
| `pnpm beads:<brand>:<type>:blob` | Diff local originals against Vercel Blob and optionally upload |

## Quick Start

```bash
# Full local sync for Miyuki Delica (scrape + download + thumbnails + colors + metadata + validate)
pnpm beads:miyuki:delica:sync

# Same thing but skip network (rebuild from already-downloaded images)
pnpm beads:miyuki:delica:sync -- --local-only

# See what Vercel Blob is missing without uploading
pnpm beads:miyuki:delica:blob

# Upload new/changed originals to Vercel Blob
pnpm beads:miyuki:delica:blob -- --upload

# Full local sync for Miyuki Round Rocailles
pnpm beads:miyuki:round_rocailles:sync

# Rebuild Miyuki Round Rocailles from local files only
pnpm beads:miyuki:round_rocailles:sync -- --local-only

# Upload Miyuki Round Rocailles originals to Vercel Blob
pnpm beads:miyuki:round_rocailles:blob -- --upload

# Full local sync for Preciosa Rocailles
pnpm beads:preciosa:rocailles:sync

# Rebuild Preciosa Rocailles from local files only
pnpm beads:preciosa:rocailles:sync -- --local-only

# Upload Preciosa Rocailles originals to Vercel Blob
pnpm beads:preciosa:rocailles:blob -- --upload

# Full local sync for TOHO Round
pnpm beads:toho:round:sync

# Rebuild TOHO Round from local files only
pnpm beads:toho:round:sync -- --local-only

# Upload TOHO originals to Vercel Blob
pnpm beads:toho:round:blob -- --upload
```

## Repo-Wide Rebuilds

```bash
# Rebuild every supported bead type from local files only and refresh generated/data/bead-metadata.ts
pnpm beads:miyuki:delica:sync -- --local-only && \
pnpm beads:miyuki:round_rocailles:sync -- --local-only && \
pnpm beads:preciosa:rocailles:sync -- --local-only && \
pnpm beads:toho:round:sync -- --local-only

# Run the full scrape/download/build pipeline for every supported bead type
pnpm beads:miyuki:delica:sync && \
pnpm beads:miyuki:round_rocailles:sync && \
pnpm beads:preciosa:rocailles:sync && \
pnpm beads:toho:round:sync
```

## Directory Structure

```
scripts/beads/
├── common/                         # Shared across all brands
│   ├── extract-colors.ts           # Color extraction from bead images
│   ├── generate-metadata.ts        # Metadata TypeScript generation
│   ├── validate-bead-type.ts       # Validation checks
│   └── lib/
│       ├── paths.ts                # Central path resolution (BEADS_ROOT, etc.)
│       ├── blob.ts                 # Vercel Blob diff + upload (manifest-based SHA-256)
│       ├── beadRender.ts           # Single-bead 16×16 renderer (metadata + finish driven)
│       └── thumbnails.ts           # Derivatives: 16×16 rendered bead + 48×48 centre crop
├── miyuki/                         # Miyuki brand
│   ├── common/
│   │   └── scrape-metadata.ts      # Web scraper for Miyuki bead metadata
│   ├── delica/                     # Miyuki Delica specific
│   │   ├── sync.ts                 # Full sync pipeline
│   │   ├── sync.test.ts            # Tests
│   │   └── blob.ts                 # Blob upload entry point
│   └── round_rocailles/            # Miyuki Round Rocailles specific
│       ├── sync.ts                 # Full sync pipeline
│       ├── sync.test.ts            # Tests
│       └── blob.ts                 # Blob upload entry point
├── preciosa/                       # Preciosa brand
│   └── rocailles/                  # Preciosa Rocailles specific
│       ├── sync.ts                 # Full sync pipeline
│       ├── blob.ts                 # Blob upload entry point
│       └── lib/
│           └── config.ts           # Size tables and dimensions loading
├── toho/                           # TOHO brand
│   └── round/                      # TOHO Round specific
│       ├── sync.ts                 # Full sync pipeline
│       ├── sync.test.ts            # Tests
│       ├── blob.ts                 # Blob upload entry point
│       └── lib/
│           ├── config.ts           # Size tables, dimension normalization
│           └── config.test.ts      # Tests
└── README.md
```

## Sync Scripts

All sync scripts follow the same pipeline:

1. **Scrape** — fetch the online catalog for the brand
2. **Download** — pull missing original images
3. **Thumbnails** — render the **16×16** single bead (shape/material/finish read from each bead's `.metadata.json` sidecar, colour sampled from the source photo) and a **48×48** centre crop of the source. The 16×16 render requires the metadata sidecar to exist first (written earlier in the run); without it, the legacy centre-crop is used as a fallback.
4. **Colors** — extract dominant colors from images
5. **Metadata** — build consolidated metadata files
6. **Validate** — integrity checks on the resulting data

### Miyuki Delica Sync (`miyuki/delica/sync.ts`)

```bash
pnpm beads:miyuki:delica:sync [options]
```

| Flag | Description |
|------|-------------|
| `--local-only` | Skip scraping and downloading; rebuild from local files only |
| `--sizes 11,15` | Limit to specific sizes (default: `8,10,11,15`) |
| `--dry-run` | Report what would change without writing |
| `--force` | Force-regenerate thumbnails even when up to date |
| `--verbose` | Detailed progress output |

### Miyuki Round Rocailles Sync (`miyuki/round_rocailles/sync.ts`)

```bash
pnpm beads:miyuki:round_rocailles:sync [options]
```

| Flag | Description |
|------|-------------|
| `--local-only` | Skip scraping and downloading; rebuild from local files only |
| `--sizes 11,15` | Limit to specific sizes (default: `2,5,6,8,11,15`) |
| `--dry-run` | Report what would change without writing |
| `--force` | Force-regenerate thumbnails even when up to date |
| `--verbose` | Detailed progress output |

### Preciosa Rocailles Sync (`preciosa/rocailles/sync.ts`)

```bash
pnpm beads:preciosa:rocailles:sync [options]
```

| Flag | Description |
|------|-------------|
| `--local-only` | Skip catalog scraping and rebuild from local files only |
| `--sizes 10,11` | Limit to specific sizes (default: sizes found in the live catalog and local data) |
| `--dry-run` | Report what would change without writing |
| `--force` | Redownload metadata/assets and regenerate thumbnails |
| `--verbose` | Detailed progress output |

Preciosa sync keeps full-size originals as `.webp` in `downloaded/` and generates `.jpg` `_16x16` and `_48x48` derivatives in `beads/`.
Preciosa assets are stored under article subdirectories so the filenames can consistently stay as the color number, for example `331-19001/20420.webp` and `331-19001/20420_48x48.jpg`.

### TOHO Round Sync (`toho/round/sync.ts`)

```bash
pnpm beads:toho:round:sync [options]
```

| Flag | Description |
|------|-------------|
| `--local-only` | Skip scraping and downloading; rebuild from local files only |
| `--sizes 3,6` | Limit to specific sizes (default: `3,6,8,11,15`) |
| `--dry-run` | Report what would change without writing |
| `--force` | Redownload and regenerate even when local files exist |
| `--verbose` | Detailed progress output |

## Blob Scripts

Both blob scripts use a manifest-based SHA-256 diff to determine which original images need uploading.

### Miyuki Delica Blob (`miyuki/delica/blob.ts`)

```bash
pnpm beads:miyuki:delica:blob [options]
```

| Flag | Description |
|------|-------------|
| `--upload` | Upload new/changed originals (without this flag, only reports the diff) |
| `--sizes 11,15` | Limit to specific sizes (default: `8,10,11,15`) |

### Miyuki Round Rocailles Blob (`miyuki/round_rocailles/blob.ts`)

```bash
pnpm beads:miyuki:round_rocailles:blob [options]
```

| Flag | Description |
|------|-------------|
| `--upload` | Upload new/changed originals (without this flag, only reports the diff) |
| `--sizes 11,15` | Limit to specific sizes (default: `2,5,6,8,11,15`) |

### Preciosa Rocailles Blob (`preciosa/rocailles/blob.ts`)

```bash
pnpm beads:preciosa:rocailles:blob [options]
```

| Flag | Description |
|------|-------------|
| `--upload` | Upload new/changed originals (without this flag, only reports the diff) |
| `--sizes 10,11` | Limit to specific sizes (default: all supported sizes) |

### TOHO Round Blob (`toho/round/blob.ts`)

```bash
pnpm beads:toho:round:blob [options]
```

| Flag | Description |
|------|-------------|
| `--upload` | Upload new/changed originals (without this flag, only reports the diff) |
| `--sizes 3,6` | Limit to specific sizes (default: `3,6,8,11,15`) |

Blob scripts require a `BLOB_READ_WRITE_TOKEN` environment variable for uploads.

## Common Libraries

These modules are shared across all brands. They are imported by the sync/blob scripts — they do not have standalone pnpm commands.

| Module | Purpose |
|--------|---------|
| `common/lib/paths.ts` | Central path resolution (`BEADS_ROOT`, `getBeadTypeDirectory`, etc.) |
| `common/lib/blob.ts` | Manifest-based SHA-256 diff and Vercel Blob upload |
| `common/lib/beadRender.ts` | Renders an authentic single bead into the 16×16 space from the bead's metadata (shape/material/finish) + a colour sampled from the source photo. See "16×16 bead rendering" below. |
| `common/lib/thumbnails.ts` | Derivative generation via Sharp: the 16×16 single-bead render (delegates to `beadRender.ts`) and the 48×48 centre crop of the source |
| `common/extract-colors.ts` | Dominant color extraction from bead images and per-size color mapping JSON generation |
| `common/generate-metadata.ts` | Consolidated metadata TypeScript generation |
| `common/validate-bead-type.ts` | Data integrity validation |

## 16×16 Bead Rendering

The `_16x16.jpg` thumbnails are the images used by Beadloo's **bead-pattern preview**, so they must read as a single recognisable bead, not a crop of the source pile photo (every source image is a photo of dozens of loose beads). `common/lib/beadRender.ts` renders one stylised-but-authentic bead per output, driven entirely by the bead's own `.metadata.json`:

- **Colour** — sampled from the source photo (perceptual, centre-weighted dominant; iridescent beads also sample a hue palette, picasso beads an earthy speckle tone).
- **Shape** (`metadata.shape`) — `Delica` → a horizontal **tube** (cylinder); everything else → a **round** bead.
- **Material** (`glassGroup` + `finish`) — **glass** (translucent, luminous core, bright rim), **metal** (reflective banding), or **opaque** (solid soft sheen).
- **Finish modifiers** (`finish`/`galvanized`/`plating`) — `matte` (frosted), `luster`/`pearl`, `lined`/`silver-lined` (bright core), `iris` (AB/Rainbow/Special Coating → multi-hue oil-slick sheen), `picasso`/`travertine` (earthy mottle), `cornelian` (white core), `silk`/glass-enamel (satin streak).

The bead fills the frame **edge-to-edge (no margin)** with slightly **concave left/right ends** that hint the hole openings, composited on a dark background (`#0d0d0d`; JPEG has no alpha). The renderer is deterministic. The **48×48** derivative is intentionally left as a plain centre crop of the source — it is not used by the preview feature.

> If a bead has no `.metadata.json` sidecar, `thumbnails.ts` falls back to the legacy centre-crop (and the Miyuki SVG overlay when an `overlay` is passed).

## pnpm Scripts

```bash
pnpm test                          # Run all unit tests (vitest)
pnpm test:watch                    # Run tests in watch mode

pnpm beads:miyuki:delica:sync      # Full Miyuki Delica sync pipeline
pnpm beads:miyuki:delica:blob      # Miyuki Delica blob diff/upload

pnpm beads:miyuki:round_rocailles:sync  # Full Miyuki Round Rocailles sync pipeline
pnpm beads:miyuki:round_rocailles:blob  # Miyuki Round Rocailles blob diff/upload

pnpm beads:preciosa:rocailles:sync      # Full Preciosa Rocailles sync pipeline
pnpm beads:preciosa:rocailles:blob      # Preciosa Rocailles blob diff/upload

pnpm beads:toho:round:sync         # Full TOHO Round sync pipeline
pnpm beads:toho:round:blob         # TOHO Round blob diff/upload
```

## Adding a New Bead Brand or Type

1. Create the script directory following the hierarchy: `scripts/beads/<brand>/<type>/`
2. Create `sync.ts` implementing the same pipeline (scrape → download → thumbnails → colors → metadata → validate)
3. Create `blob.ts` as a thin entry point wrapping `common/lib/blob.ts`
4. Add two pnpm scripts to `package.json`:
   ```json
   "beads:<brand>:<type>:sync": "tsx scripts/beads/<brand>/<type>/sync.ts",
   "beads:<brand>:<type>:blob": "tsx scripts/beads/<brand>/<type>/blob.ts"
   ```
5. Create the corresponding bead and downloaded directories under `beads/<brand>/<type>/` and `downloaded/<brand>/<type>/`
6. Add tests under `tests/` mirroring the script structure, for example `tests/beads/<brand>/<type>/sync.test.ts`

## Error Handling

All scripts return appropriate exit codes:
- `0` — Success
- `1` — Error (check console output)

The validation step distinguishes:
- **Errors** — Must fix (missing files, invalid JSON)
- **Warnings** — Should review (duplicate colors)
- **Info** — Statistics and summaries
