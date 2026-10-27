# M0 · Handwriting test

Go/no-go test before building anything: can a vision model read what a 6-year-old wrote on real homework photos?

## Files

| File | What |
| --- | --- |
| `photos/` | Real homework photos (5 for now, git-ignored). |
| `labels.json` | Ground truth: what the child actually wrote, and the right answer, for each item. |
| `run-test.mjs` | Sends each photo + its item list to each model, scores the answers. No dependencies. |
| `results/<timestamp>/` | `summary.md` + raw model outputs per run. |

## Steps

1. **Check `labels.json`.** For every item, compare `child_answer` with the real page. Fix anything wrong, then set `"verified": true` on that photo. Look carefully at `p2-30` (3rd copy may be a 20) and the crosses/dots counts on photo 4.
2. **Add keys.** `cp .env.example .env` and fill in at least one key.
3. **Run.** `node --env-file=.env run-test.mjs` (Node 20.6+), or one provider: `node --env-file=.env run-test.mjs gemini`.
4. **Read** `results/<timestamp>/summary.md`.

## The 5 photos

| Photo | Tests |
| --- | --- |
| 01 Nombres en lettres | Following crossing pencil lines (hardest) |
| 02 Dizaines | Reading many small, messy copies |
| 03 Soustractions/additions | Small digits on dotted lines; page cut on the right (must answer null) |
| 04 Le nombre 8 | Number line + counting tiny crosses/dots (stretch) |
| 05 Écriture des chiffres | Telling the teacher's red marks apart from the child's writing |

## Gate

- Core reading accuracy **≥ 90%** for the best model.
- **0 harmful false corrections**: the child was right, but the model confidently says wrong.

## Scoring

- **Reading accuracy:** the model read exactly what the child wrote.
- **False correction:** the child was right, the model reads it as wrong. **Harmful** = the same, with confidence ≥ 0.75, so the tutor would actually say it.
- **Missed error:** the child was wrong, the model reads it as right.
- **Stretch** items (counting crosses/dots) are scored separately and do not count for the gate.

## Notes

- These photos are WhatsApp-compressed (900×1600). Real app photos will be sharper, so this is a harder-than-real test.
- In the real app, the exercise list comes from the first photo. Here it is given to the model, to test reading only.
