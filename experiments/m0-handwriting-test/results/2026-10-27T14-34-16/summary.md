# M0 handwriting test results

Run: 2026-10-27T14:34:53.185Z · confidence threshold 0.75

> Labels not verified yet for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg. Scores may be wrong.

| Provider | Model | Reading accuracy (core) | Stretch | False corrections | Harmful (confident) | Missed errors | Avg time / photo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna | 85% (53 items) | 100% | 6 | 4 | 0 | 7374 ms |

Gate to pass M0: best model >= 90% core reading accuracy and 0 harmful false corrections.

## openai · mistakes

| Item | Expected | Model read | Confidence | Note |
| --- | --- | --- | --- | --- |
| p1-79 | soixante-dix-neuf | quatre-vingt-onze | 0.72 | false correction |
| p1-91 | quatre-vingt-onze | soixante-dix-neuf | 0.72 | false correction |
| p2-60 | 60,60,60 | 66, 60, 60 | 0.82 | HARMFUL |
| p3-s6 | null | 3 | 0.88 |  |
| p3-a9 | 7 | null | 0.99 |  |
| p5-row2 | 1,2,3,4 | 1,2 | 0.76 | HARMFUL |
| p5-row4 | 1,2,3,4 | 1,2,3 | 0.92 | HARMFUL |
| p5-row5 | 2,3,4 | 2,3 | 0.98 | HARMFUL |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The photo is readable overall, though several pencil lines cross and the bottom word is partly cut off.
- photo-02-dizaines.jpg: The page is visible and mostly clear, though some pencil digits are faint or awkwardly formed.
- photo-03-soustractions-additions.jpg: The image is fairly clear, but the page’s right edge cuts off several answers.
- photo-04-nombre-8.jpg: The photo is slightly blurry, especially around the small marks in the upper exercises.
- photo-05-ecriture-chiffres.jpg: The photo is slightly blurry, but the red correction lines are mostly visible.
