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
| `official/glass-enamel-discontinued-2023-07-03.tsv` | Miyuki's "Glass Enamel Products Discontinuation Notice" (dated 2023-07-03; gone from the 2026 site): the table the notice page loads, `https://www.miyuki-beads.co.jp/english/seed/glass-enamel-notice/enamel_202307051.tsv`, as archived at `https://web.archive.org/web/20231226084016/` + that URL; 126 Delica and 200 non-Delica numbers, each "Discontinued" or "Discontinued → Alternative color No.: <n>-1" (CRLF stripped, `&#8594;` kept as served). Read by `pnpm beads:miyuki:mark-discontinued` | 2026-10-22 | `7957522fcf0626bf98ed373d557823b3da5ccd674ef517802628e31697586f37` |
| `sample-cards/archived-cards.csv` | official Miyuki sample cards that survive only in the Internet Archive (TE-64, TE-63, the 2006 cards): archived URL, what each states, SHA-256 of the PDF kept under `downloaded/miyuki/sample-cards/archived/` | 2026-10-22 | per row |
| `directory-2017.csv` | Miyuki's 2017 directory offered "Zipped images of Round Rocailles / Delica Beads" (`http://www.miyuki-beads.co.jp/directory/download/`, archived 2017-08-11) as Dropbox links that still resolve: `Round-Rocailles.zip` (150,584,414 bytes, 1,871 photos named `<size>-<number>.jpg` per size folder) and `Delica-Beads.zip` (142,437,271 bytes, 1,735 photos), kept under `downloaded/miyuki/directory-2017/`. Each photo is Miyuki's own product photo of a colour at a size | 2026-10-22 | zips: `f38bf428b1ce00c929c13ec2bb1bc24f042eb92504cae9fdc6d8ed6a64df577a`, `08b17107975cad019b96755ad77b1f4a15013208b043658f8be3cc7a8c69c364` |
| `round-rocaille-attributes.csv` | reviewed glass-and-finish decisions for round-rocaille colour numbers the directory does not list, one row per number with its evidence (the directory beads in the same printed run of a card, the number's Delica-list twin where the directory confirms how that phrase reads, the directory's TILA listing of the same number, Miyuki's notices; 1681 and 1682, Transparent at 15/0 from a heading shared with a transparent run, were set Opaque at every size on 2026-10-24). Read by the sample-card adder for new beads, applied to every size on disk by `pnpm beads:miyuki:round_rocailles:apply-attribute-decisions`; a number the directory lists never takes one | 2026-10-23 | n/a (reviewed) |
| `official/conversion-chart-2007/round-to-delica_08_02.html`, `delica-to-round_08_01.html` | Miyuki's English site "Conversion chart 11/0 Round to Delica" and its reverse, as archived 2007-07-03 (`https://web.archive.org/web/20070703105325/http://www.miyuki-beads.co.jp:80/english/seed/08_02.html`, `.../20070703105219/.../08_01.html`): 830 pairs on each page, each "11/0 RR" with its Delica twin, so each colour existed at 11/0. 811 round colours read as one bead (`417F` and `417FR` are printed twice); 17 printed numbers are left out: the 9 `/L` forms are Miyuki's `RL` finish (`color_change.tsv` writes `155/L(155RL)`, `417L/L(417L-RL)`), not the `L` shade, and the 8 others name two finishes at once (`0141D/FR`). Read by `pnpm beads:miyuki:round_rocailles:add-conversion-chart`, which adds those missing at 11/0 that have a Miyuki photo at another size (87 on 2026-10-23); the other 315 have an official 11/0 size but no image | 2026-10-23 | `93ef7fefae45e3ea88d6783193cfa8c0b7b835599211510c220dd256b7a1875e` (08_02), `ad534c0372cb1e35fedeb1a86e45206a74401f4f9288d6700670a96fad211b29` (08_01) |
| `retailer/round-rocailles.csv` | the one exception to official-only (below): round rocailles shops sell as Miyuki beads at a size no Miyuki document names, each with its shop count, independent photo count, verified listing and photo URLs, image source and measured colour. Read by `pnpm beads:miyuki:round_rocailles:add-retailer` | 2026-10-23 | n/a (reviewed) |
| `retailer/survey-2026-10-23.md` | the market survey behind it: every shop, code and photo checked for 2039-2060, which shops share one distributor photo, and why 2052-2060 are not round rocailles | 2026-10-23 | n/a (notes) |
| `sample-cards/mud-cover-transcription.csv` | every cell of Miyuki's current 15/0 card (Mud Cover, `mud-cover.pdf`, SHA-256 `d37fbc569bc6b403bd06c1044ccdfe4442d2bcc63773d98f87b4235f56e3a88b`): page, heading and number as printed, read by eye and checked cell by cell by OCR | 2026-10-22 | n/a (transcribed) |

Where a round rocaille's glass and finish come from, strongest first: Miyuki's directory (the bead
itself, the same number at another size, for a square-hole colour the round-hole bead of the same
number); a reviewed decision in `round-rocaille-attributes.csv`; the Delica list's phrase for the
number as a seed twin, which counts unless a directory twin read the same way disagrees (so also when
no directory twin is read that way; the trust follows the reading, not the wording, and a phrase with a
term the reader does not know is counted and left out); the same number at another size from another
official source; the card heading through `sample-cards/sample-card-sections.csv`. One colour number
names one glass and finish at every size: `pnpm beads:miyuki:audit` fails when two sizes disagree and a
source other than the directory is involved, and only warns when the directory disagrees with itself.

Refreshing a snapshot: download the file again, update the row (date and
hash), and commit the file together with whatever the pipeline changed because
of it. Never edit a snapshot by hand.

Not a source for whether a bead exists, or at which size: retailers, community
sites, colour names, anything derived from a colour value. Official sources
count whatever their age: an archived catalogue, card or notice is as good as a
current one, and a bead Miyuki has discontinued is still added (marked
`status: Discontinued`), because beaders draw with what they own.

Only when an official source proves a bead exists and no official source has an
image or attributes for it may those come from elsewhere: several independent
retailer photos that agree on colour, size and shape, or attributes several
retailers agree on. The registry row then names every source it used, and such
an image gets `colorAccuracy: approximate`. See the issue for the full rule.

One written exception, decided by the owner on 2026-10-23 for the 2039-2060 gap: a colour that shops
sell as a Miyuki round rocaille at a size where no Miyuki document names it may be added when the owner
asks for it, at least three shops name brand, shape, size and number, and at least three independent
photos agree. It carries `confirmation: Retailer` (the app shows "Not confirmed by Miyuki") and an
`approximate` colour; its image is Miyuki's photo of the colour at another size or a rendered bead in the
colour measured from those photos, never a shop's photo. The first and only such beads: 11/0 2041-2051,
Miyuki's "Frost Dyed" series sold abroad as "Special Dyed" (`retailer/round-rocailles.csv`).
