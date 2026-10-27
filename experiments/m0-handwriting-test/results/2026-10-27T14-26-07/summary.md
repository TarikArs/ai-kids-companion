# M0 handwriting test results

Run: 2026-10-27T14:26:26.904Z · confidence threshold 0.75

> Labels not verified yet for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg. Scores may be wrong.

| Provider | Model | Reading accuracy (core) | Stretch | False corrections | Harmful (confident) | Missed errors | Avg time / photo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-4o | 75% (53 items) | 0% | 14 | 12 | 1 | 3881 ms |

Gate to pass M0: best model >= 90% core reading accuracy and 0 harmful false corrections.

## openai · mistakes

| Item | Expected | Model read | Confidence | Note |
| --- | --- | --- | --- | --- |
| p1-24 | vingt-quatre | quarante-deux | 0.8 | HARMFUL |
| p1-42 | quarante-deux | trente-et-un | 0.9 | HARMFUL |
| p1-86 | quatre-vingt-six | quatre-vingt-dix | 0 | false correction |
| p1-31 | trente-et-un | null | 0 | false correction |
| p2-30 | 30,30,20 | 30, 30, 30 | 1 |  |
| p3-a3 | 6 | null | 0 |  |
| p3-a6 | 1 | null | 0 |  |
| p3-a9 | 7 | null | 0 |  |
| p4-cross6 | 6 | 4 | 1 | HARMFUL, stretch |
| p4-cross7 | 7 | 6 | 1 | HARMFUL, stretch |
| p4-cross8 | 8 | 5 | 1 | HARMFUL, stretch |
| p4-dots6 | 6 | 8 | 1 | HARMFUL, stretch |
| p4-dots7 | 7 | 9 | 1 | HARMFUL, stretch |
| p5-row1 | none | 1,2 | 1 | HARMFUL |
| p5-row2 | 1,2,3,4 | 1,3,4 | 1 | HARMFUL |
| p5-row3 | none | 1,2 | 1 | HARMFUL |
| p5-row4 | 1,2,3,4 | 1,2 | 1 | HARMFUL |
| p5-row5 | 2,3,4 | 2 | 1 | HARMFUL |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The photo is clear but the last few lines are partly cut off.
- photo-02-dizaines.jpg: The photo is clear and the writing is legible.
- photo-03-soustractions-additions.jpg: Page has good lighting but is slightly cut off on the right side.
- photo-04-nombre-8.jpg: Slight blur but text mostly readable.
- photo-05-ecriture-chiffres.jpg: Photo is slightly blurry but readable.
