# Miyuki sample cards (issue #203 Phase 5, batch b)

| File | What it is | Source |
|---|---|---|
| `cards.csv` | Miyuki's own list of its sample cards: card id, shapes and sizes, PDF file, description | `https://www.miyuki-beads.co.jp/wp-json/miyuki/v1/samplecards` (2026-10-17) |
| `issue-203-comment-6219566196.md` | the research note naming the 162 + 13 card-only colour numbers, per card | adamaszczos/beadloo#203 |
| `sample-card-sections.csv` | each card section heading mapped to a catalogue heading, with that heading's evidence (the directory beads under it); the metadata source for a card bead without a sibling at another size | hand-mapped 2026-10-17 |
| `located-by-eye.csv` | for the cells no OCR pass could place: the point read off the page by eye (display coordinates of the page view), which the locator turns into the cell under it | read by eye 2026-10-17 |
| `n2-renumbered-cells.csv` | where Miyuki's Delica 11/0 card N-2 photographs each of the 51 `-1` colours of the official Delica list: label and strand cell at 150 dpi, how it was placed (exact OCR, or the row next to a label that read exactly) and the human confirmation; the input of `pnpm beads:miyuki:sample-cards:add-delica` | `pnpm beads:miyuki:sample-cards:locate-delica`, all 51 confirmed by eye 2026-10-17 |

The PDFs themselves are not committed (`downloaded/miyuki/sample-cards/`): `https://www.miyuki-beads.co.jp/common/data/pdf/<PDF>` for the cards in `cards.csv`
(the older cards and books the directory hosts, searched once for batch c, are listed by
`https://directory.miyuki-beads.co.jp/wp-json/wp/v2/media?mime_type=application/pdf`); the server
closes long transfers after about a megabyte, so resume with `curl -C -` until the size equals the
`Content-Length`. Every page is a scan with no text layer.

Reading them, in order: `pnpm beads:miyuki:sample-cards:read` (cells + OCR, see `scripts/beads/miyuki/sample-cards/`),
`pnpm beads:miyuki:sample-cards:sheets` (review sheets, one PNG per page), `pnpm beads:miyuki:sample-cards:batch-b`
(the batch CSV from the comment's numbers and the cells), `pnpm beads:miyuki:sample-cards:locate` (a stronger,
exact-only OCR pass for the cells the first missed, then the by-eye points), and, once the batch is approved,
`pnpm beads:miyuki:sample-cards:add` (crops the bead cell as the original, sidecar from the same number at
another size else from the section mapping, registry row) followed by the round-rocaille `--local-only` sync.
What a card states and what a human read on it is recorded per row in `sources/miyuki/batches/b-sample-cards.csv`;
no bead is added from a card until its row is confirmed by eye with a located cell and the batch has been reviewed.
A one-character OCR tolerance put 30 of 91 located rows on the wrong cell, so the locator only takes exact readings.
The adder crops each bead cell to the strand's own bounding box (dark pixels, the cell's border lines and
the card's frame left out): the thumbnail generator takes the centre square of the original, and a short
strand at the left of a wide cell would otherwise give an empty thumbnail.
