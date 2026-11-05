# M0 handwriting test results

Scored: 2026-11-04T15:33:56.616Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (low) · 2048px | 92% (48) | 96% | 2 | 0 | 0 | 3 | 0 | 0 | 7866 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 11 | 1 | 0 | 0 |
| copy | 10 | 8 | 0 | 0 | 2 |
| fill_in | 21 | 20 | 1 | 0 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 4 | 0 | 0 | 1 |
| teacher_marks | 5 | 4 | 0 | 0 | 1 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-86 | quatre-vingt-six | null | null | 0.42 | abstain |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 | 0.63 | misread, false correction |
| p2-60 | 60,60,60 | 66, 60, 60 | 66, 60, 60 | 0.57 | misread, false correction |
| p3-a9 | 7 | null | null | 0.99 | abstain |
| p4-cross8 | 8 | 7 | 7 | 0.38 | misread, false correction, stretch |
| p5-row2 | 1,2,3,4 | 1,2,3 | 1,2,3 | 0.78 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The photo is clear overall, but the lowest word is cut off at the right edge.
- photo-02-dizaines.jpg: The full page is visible, though some pencil digits are faint and loosely formed.
- photo-03-soustractions-additions.jpg: The writing is mostly legible, but several answers in the right column are cut off by the photo edge.
- photo-04-nombre-8.jpg: The photo is slightly blurry, especially around the drawn marks.
- photo-05-ecriture-chiffres.jpg: The page is slightly blurry and the rightmost copies are close to the image edge.
