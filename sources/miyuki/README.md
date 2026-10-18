# Official Miyuki data (committed sources)

Everything Beadloo stores about a Miyuki bead must trace back to an official
Miyuki publication (issue adamaszczos/beadloo#203, section 2). This directory
is the committed home of those publications and of the provenance of every
bead in `beads/miyuki/**`. Nothing enters `beads/miyuki/**` without a row in
`registry/`, and `pnpm beads:miyuki:audit` fails when one is missing.

| File | Source | Fetched | SHA-256 of the stored bytes |
|---|---|---|---|
| `official/durability.sjis.tsv` | https://www.miyuki-beads.co.jp/common/data/csv/seedbeads/durability.tsv (Shift-JIS as served; the official Delica colour list: `DB#`, `Seed#`, `old#`, discontinued flag, glass type / finish, durability grades) | 2026-10-16 | `b9bcca2a254704ae025ad44db809d36dbda09a5d8c70ff0369ce8729c0cedd19` |
| `official/durability.tsv` | the same file converted to UTF-8 (`iconv -f SHIFT_JIS -t UTF-8`) | 2026-10-16 | `5d7724a66df2c259bd6b2795dd223207103ca547be9b2c69a88b28172752be65` |
| `official/color_change.tsv` | https://www.miyuki-beads.co.jp/common/data/csv/seedbeads/color_change.tsv (old / tentative colour numbers to unified numbers; ASCII, so one copy; the shape and size of a section sit in `new_flag2` on its first row only and must be forward-filled) | 2026-10-16 | `d323482838a857273441c24b4a6cd967255a7343a2d81c0bf6c300d7994bb4f8` |
| `size-tables.json` | transcribed from the English site, catalogue GB-6 and the Style & Size sheet (URLs inside the file) | 2026-10-16 | n/a (hand-transcribed) |
| `directory/products.json` | reduced dump of the directory's WooCommerce Store API (`https://directory.miyuki-beads.co.jp/wp-json/wc/store/v1/products`), written by `pnpm beads:miyuki:directory -- --fetch` | see the `fetchedAt` field inside | n/a (regenerated) |
| `catalogue/gb-6/*.csv` | cell-by-cell parse of catalogue GB-6 (`https://www.miyuki-beads.co.jp/english/wp-content/uploads/sites/2/2026/09/GB-6.pdf`, 57.6 MB, not committed) by `pnpm beads:miyuki:catalogue` | 2026-10-16 | n/a (regenerated) |
| `catalogue/gb-6/delica-metadata.csv` | hand-mapped official metadata for the catalogue-only Delica colours that have no regular bead of the same number to lend theirs (DB665, DB1130, DB1140): the `durability.tsv` finish string and the evidence for each mapping | as mapped | n/a |
| `registry/<type>.csv` | one row per bead and size: where its listing, image and size come from, and how accurate its colour is; written by the syncs, checked by the audit | continuous | n/a |
| `decisions.csv` | human decisions on directory products the parsers hold out (a name whose SKU carries another number): `accept` with the bead ID to use, or `reject` with the reason; read by the enumerator, so a rerun keeps the decision | as decided | n/a |
| `hold-out.csv` | colours an official source names without stating a size (held out of `beads/` until a source states one); written by the audit | continuous | n/a |

Refreshing a snapshot: download the file again, update the row (date and
hash), and commit the file together with whatever the pipeline changed because
of it. Never edit a snapshot by hand.

Not a source: retailers, community sites, colour names, anything derived from
a colour value. See the issue for the full rule.
