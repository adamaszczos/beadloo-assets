# beadloo-assets

Beadloo bead asset pipelines, generated color mappings, metadata, and dimension tables.

Supported brand/type pipelines:

- Miyuki Delica
- Miyuki Round Rocailles
- Preciosa Rocailles
- TOHO Round

Each supported brand/type exposes a `sync` command for scraping, downloading, thumbnail generation, color extraction, metadata generation, and validation, plus a `blob` command for diffing and uploading original assets.

See [scripts/beads/README.md](scripts/beads/README.md) for the full command reference and pipeline details.
