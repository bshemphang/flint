# Flint

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/bshemphang/flint/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/bshemphang/flint/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Flint is a fast drop-in for csv-reader 1.0.0, entered in
[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
on make.fun. It returns exactly the answer csv-reader 1.0.0 returns for every
input: `{columns, rows, errors}` for `{text, header}`, including every broken
row rule (stray CR, unterminated quotes, quote junk, short and long rows,
BOM, CRLF, empty lines, quoted line breaks).

## How it is fast

The reference reads one character at a time and builds each field a
character at a time. Flint never does that on the common path:

- Plain lines (no quote, no stray CR) are split by commas in one `split`.
- Other fields are sliced between `indexOf` delimiters: unquoted fields
  between the next comma / line break, quoted fields between the next
  quotes.
- Only the rare broken shapes fall back to a careful segment loop: doubled
  quotes, line breaks inside quotes, stray CRs, junk after a closing quote,
  and unterminated quotes.

## Layout

- `solve.js` — dependency-free ES module. `run(input)` returns
  csv-reader 1.0.0's answer for the case's input.
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case with `run`, writes `/output/answers.json`.

## Verification

Checked locally against csv-reader 1.0.0 itself: the 6-case practice set
matches the published expected answers 6/6, 55 hand-written edge cases
match byte for byte, and 40,000 fuzzed inputs (random characters and
structured random fields) match byte for byte. On the practice set Flint
runs the 6 cases in about 0.20-0.27 s per pass against about 0.63-1.20 s
for the reference on this machine, roughly 3-4x faster.

## License

MIT. See [LICENSE](LICENSE).
