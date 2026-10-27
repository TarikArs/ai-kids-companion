# M0 handwriting test results

Scored: 2026-10-27T14:40:52.316Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna | 88% (48) | 90% | 1 | 1 | 0 | 4 | 2 | 0 | 7374 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 10 | 0 | 0 | 2 |
| copy | 10 | 8 | 0 | 0 | 2 |
| fill_in | 21 | 19 | 1 | 1 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 5 | 0 | 0 | 0 |
| teacher_marks | 5 | 2 | 0 | 0 | 3 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-79 | soixante-dix-neuf | quatre-vingt-onze | quatre-vingt-onze | 0.72 | misread, false correction |
| p1-91 | quatre-vingt-onze | soixante-dix-neuf | soixante-dix-neuf | 0.72 | misread, false correction |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 | 0.75 | misread, HARMFUL |
| p2-60 | 60,60,60 | 66, 60, 60 | 66, 60, 60 | 0.82 | misread, HARMFUL |
| p3-s6 | null | 3 | 3 | 0.88 | invented |
| p3-a9 | 7 | null | null | 0.99 | abstain |
| p5-row2 | 1,2,3,4 | 1,2 | 1,2 | 0.76 | misread, teacher marks |
| p5-row4 | 1,2,3,4 | 1,2,3 | 1,2,3 | 0.92 | misread, teacher marks |
| p5-row5 | 2,3,4 | 2,3 | 2,3 | 0.98 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The photo is readable overall, though several pencil lines cross and the bottom word is partly cut off.
- photo-02-dizaines.jpg: The page is visible and mostly clear, though some pencil digits are faint or awkwardly formed.
- photo-03-soustractions-additions.jpg: The image is fairly clear, but the page’s right edge cuts off several answers.
- photo-04-nombre-8.jpg: The photo is slightly blurry, especially around the small marks in the upper exercises.
- photo-05-ecriture-chiffres.jpg: The photo is slightly blurry, but the red correction lines are mostly visible.
