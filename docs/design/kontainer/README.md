# Kontainer mockups (series E)

> **Status:** Reference for the proposed visual language. Not implemented, and not a rule, until an
> ADR adopts it. The design system spec ([`design-system.md`](../../architecture/design-system.md))
> remains what the application follows today.

These are the six screens of series E, exported from the design canvas so the reference lives with
the code: Dermaga, Manifest, Yard, Process Studio, Cari, and Tutup hari. [`tokens.json`](./tokens.json)
is the machine-readable list of what they use.

## What is here

- `mockups/*.dc.html.txt` are the source of each screen in the canvas format, with a `.txt` extension so code analysis does not treat their `support.js` script as an unresolved import. Remove the `.txt` to use one. They are not plain HTML:
  `{{ }}` holes and `<x-dc>` need the canvas runtime (`support.js`), so they do not open in a
  browser by themselves. Read them for markup and values, or open the canvas.
- `tokens.json` records colors, fonts, sizes, and radii observed in those files, the dark values the
  Kontainer deck defines, and the contrast ratios computed for the pairs.

## Known problems, found while extracting the tokens

- The mockups have no dark theme. The deck defines only the canvas, text, secondary text, surface,
  and accent colors for dark. The rest is marked `derived` in `tokens.json` and must be derived and
  recorded in the ADR that adopts the palette.
- The focus color the mockups use (`#E06A4E`) is 2.94:1 on the light canvas, under the 3:1 minimum
  for a focus indicator. The light accent (`#B5402B`, 4.99:1) works on light but only 2.70:1 on the
  dark canvas, where `#E06A4E` (4.59:1) is needed.
- All names, codes, and amounts are sample data.

## The application after ADR-0127

`app/my-work-light.png` and `app/my-work-dark.png` are screenshots of the built application's My
work page with the Kontainer palette, taken by a throwaway Playwright script against the built app,
with sample approval data. They are evidence of what the palette change produced, not a baseline:
nothing compares against them.

`app/approvals-light.png` and `app/approvals-dark.png` show the Approvals queue with the type tags (PRC,
FIN) and the ink frame, taken the same way with two sample requests. `app/manifest-light.png` and `app/manifest-dark.png`
show the document flow of an invoice (sales and finance nodes, the current one framed).

`app/shell-light.png`, `app/shell-dark.png`, `app/shell-palette-dark.png`, and `app/shell-phone.png` show
the ink bar shell with the Ctrl+K palette and the phone layout, taken the same way.

## The adopted tokens are guarded

`tokens.json` has an `adopted` section holding the semantic colors the application ships, as
`[light, dark]`. `tests/frontend/design-tokens.test.ts` fails when `apps/web/panda.config.ts` and that
section differ, and also computes the contrast of text, secondary text, links, the focus ring, input
borders, commands, and status text on every surface in both themes. Change a value in both places
together, with an ADR; never regenerate the section to make the test pass.
