# Miyuki sample cards (issue #203 Phase 5, batch b)

| File | What it is | Source |
|---|---|---|
| `cards.csv` | Miyuki's own list of its sample cards: card id, shapes and sizes, PDF file, description | `https://www.miyuki-beads.co.jp/wp-json/miyuki/v1/samplecards` (2026-10-17) |
| `issue-203-comment-6219566196.md` | the research note naming the 162 + 13 card-only colour numbers, per card | adamaszczos/beadloo#203 |
| `sample-card-sections.csv` | each card section heading mapped to a catalogue heading, with that heading's evidence (the directory beads under it); the metadata source for a card bead without a sibling at another size | hand-mapped 2026-10-17 |
| `located-by-eye.csv` | for the cells no OCR pass could place: the point read off the page by eye (display coordinates of the page view), which the locator turns into the cell under it | read by eye 2026-10-17 |
| `sample-card-sections.csv` (since 2026-10-23) | a heading is mapped only when the directory beads printed under it on that card agree on one value (the evidence column counts them); a heading spanning several finishes has blank values, so a bead under it needs a sibling or a reviewed decision (`../round-rocaille-attributes.csv`) and is never guessed | checked against every card 2026-10-23 |
| `te-64-cells.csv` | where the archived card TE-64 (`archived-cards.csv`) photographs each of its 11 lead-free Glass Enamel `-1` round rocailles: label and strand cell at 300 dpi on page 1, and the human confirmation; the input of `pnpm beads:miyuki:sample-cards:add-glass-enamel`, which adds each at the card's four sizes 15/0 11/0 8/0 6/0 | located on the 300 dpi render, all 11 confirmed by eye 2026-10-22 |
| `te-64-metadata.csv` | glass and finish, with the evidence, for the TE-64 colours Miyuki's Delica list does not name as a seed twin (`429-1`, `3551L-1`); every column is required, and a row for a colour the list names is reported and ignored (the list is Miyuki's own word) | hand-mapped with evidence for batch e |
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
The adder reads batch b unless `--batch sources/miyuki/batches/<file>.csv` names another; `--plan <csv>`
writes every bead it would add with its attributes and their source (and every skipped one with the
reason) for review, and is always a dry run. Both paths are read against the repo root.
What a card states and what a human read on it is recorded per row in `sources/miyuki/batches/b-sample-cards.csv`;
no bead is added from a card until its row is confirmed by eye with a located cell and the batch has been reviewed.
A one-character OCR tolerance put 30 of 91 located rows on the wrong cell, so the locator only takes exact readings.
The adder crops each bead cell to the strand's own bounding box (dark pixels, the cell's border lines and
the card's frame left out): the thumbnail generator takes the centre square of the original, and a short
strand at the left of a wide cell would otherwise give an empty thumbnail.

A strand is cut from its cell as the bounding box of the dark pixels with the cell's grid lines left out; a
line must span 95% of the cell, because a long dark strand fills ~90% of its width and at 80% (until
2026-10-23) its middle rows were taken for lines and the beads cropped in half. `--rewrite-images` writes
the originals again for one batch, and only those its registry rows say this card supplied (a colour's
other sizes may be the directory's or the catalogue's).

A strand original's colour is read from its bead rows, not the card or the shadow under the strand
(`estimateStrandColor` in `scripts/beads/common/lib/colorSampler.ts`); until 2026-10-23 card crops were
read like pile photos and dark strands came out grey.
