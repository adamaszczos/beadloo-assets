# Miyuki catalogue GB-6, cell by cell

Source: https://www.miyuki-beads.co.jp/english/wp-content/uploads/sites/2/2026/09/GB-6.pdf
(the printed general catalogue, Japanese, 100 PDF pages, 57.6 MB; printed page =
PDF page − 1). The PDF is not committed; the CSVs here are regenerated from it by
`pnpm beads:miyuki:catalogue`, which parses the drawn table borders of each page
rather than word positions, so every bordered cell is accounted for.

```bash
pnpm beads:miyuki:catalogue -- --pdf path/to/GB-6.pdf            # rewrite the two CSVs
pnpm beads:miyuki:catalogue -- --pdf path/to/GB-6.pdf --crops    # + a 300 dpi PNG of every swatch
#   crops land in downloaded/miyuki/catalogue/gb-6/<round-rocailles|delica>/<size>/<number>[-SH].png
#   (size as the directory name `11`, like beads/miyuki/**; a Delica crop is named DB1130.png;
#    a colour listed twice at one size keeps the first crop and gets `-p<page>` on the second)
```

## Pages

| File | PDF pages | What the pages hold |
|---|---|---|
| `round-rocailles.csv` | 14–27 | the size sections 11/0 (14–17), 15/0 (18–20), 8/0 (21–23), 6/0 (24–25), 5/0 (26–27) and 1/0 (foot of 27); rows grouped under finish-family headings (スキ Transparent, 銀引 Silverlined, …) |
| | 84–91 | the Precious, Duracoat, Picasso, Special Coating, Baroque Coating and Mix pages; only the cells under a `Round Rocaille Beads` heading are taken, the page family is their section, and the heading's size (丸小ビーズ 11/0, E ビーズ 5/0, …) is their size |
| `delica.csv` | 66–83 | DB 11/0 (66–73), DBC (74), DBS 15/0 (75–76), DBSC (77), DBM 10/0 (78–80), DBMC (81), DBL 8/0 (82), DBLC (83); no finish headings, so the section is the page family |

## Columns

`colour_no,size,hole,prefix,section_ja,section_en,page,cell_x,cell_y,cell_w,cell_h,code_no`

- `colour_no` as printed, minus the Delica prefix and the `/SH` marker (`1/SH` → `1` with `hole` `SH`; `DB 22L` → `22L` with `prefix` `DB`). Suffix letters (`1F`, `131SF`, `2400SFR`, `133L`, `HB167`) are kept.
- `hole` is `RH` (round) or `SH` (square); `size` like `11/0`; `prefix` is empty for round rocailles.
- `page` is the PDF page (1-based); `cell_*` is the cell's box in PDF points from the top-left corner.
- `code_no` as printed in the コードNo. column: the hank code (`H 5030`, often blank) for round rocailles, the Delica code itself (`DB 1130`) for Delica.
- Rows are sorted by page, then top to bottom, then left to right; the same PDF always gives byte-identical files.

## Counts (2026-10-16)

Round rocailles: 1,168 cells, 0 empty, 0 unparsed. Every main-page cell count equals the number of swatch images on that page.

| Size | Distinct numbers on pages 14–27 | Of which square hole | Cells incl. pages 84–91 |
|---|---|---|---|
| 11/0 | 355 (incl. the 8 `HB` colours) | 12 | 414 |
| 15/0 | 204 | 0 | 214 |
| 8/0 | 218 | 2 | 272 |
| 6/0 | 90 | 0 | 120 |
| 5/0 | 128 | 0 | 140 |
| 1/0 | 8 | 0 | 8 |

Pages 84–91 add 165 cells (Precious 36, Duracoat 32, Picasso 42, Special Coating 14, Baroque 20, Mix 21); 144 of them repeat a number already listed in its size section, and the Mix page lists 21 mixes (3061–3070 at 11/0, 3071–3079 at 8/0, 3082–3083 at 5/0) that appear nowhere else.

Delica: 1,776 cells, 0 empty, 0 unparsed: DB 1,091 · DBC 56 · DBS 207 · DBSC 26 · DBM 250 · DBMC 42 · DBL 72 · DBLC 32.
