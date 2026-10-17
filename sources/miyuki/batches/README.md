# Phase 5 batches (issue #203): beads that need Miyuki's answer or a human eye

Each batch is a CSV reviewed before any sync adds a bead. A row is a (colour, size) with where it was
seen, what the source states, and a `status` column that says what is still missing.

| Batch | File | What is in it | What unblocks it |
|---|---|---|---|
| a | — (see `../hold-out.csv`) | the round-rocaille numbers known only from the Delica list's `Seed#` column; the audit keeps the current list in `hold-out.csv` (292 plain numbers and 11 `-1` numbers) | Miyuki stating the sizes (data request, question 6) |
| b | `b-sample-cards.csv` | the 162 + 13 card-only numbers of the research note matched to the cells read on the nine cards, the 18 square-hole colours card 76/4R states at 2/0, and what a human confirmed by eye; 3291 is excluded (a Triangle Bead on that card) | approved 2026-10-17: at the sizes the cards print, 867/R at all four it states, the black cover at the card list's 11/0; images as `photo` from the card, metadata from the section with evidence (`sample-cards/sample-card-sections.csv`) |
| c | `c-older-square-hole.csv` | the 147 square-hole numbers of Miyuki's colour-change list, 133 without a shipped bead when mined; 72 added 2026-10-17 (`pnpm beads:miyuki:round_rocailles:add-square-hole`), 61 held | mined 2026-10-17: none of the 85 older cards and books (107 pages, rendered and OCRed, the token pages read by eye) prints a square-hole colour number; they are TILA, bugles, Delica, drops, triangles and the round-rocaille cards already read. Each row now carries the plan's fallback as a proposal: an `approximate` colour from the round-hole bead of the same number at the size the colour-change list states, where Beadloo has it; otherwise hold |
| d | — | whatever Miyuki's own data file adds | Miyuki's reply |

Whatever still has no stated size stays in `../hold-out.csv`.
