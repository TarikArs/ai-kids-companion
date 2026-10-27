# M0 handwriting test results

Scored: 2026-10-27T14:47:34.186Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (high) | 90% (48) | 94% | 2 | 1 | 0 | 2 | 0 | 0 | 25288 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 11 | 1 | 0 | 0 |
| copy | 10 | 8 | 0 | 0 | 2 |
| fill_in | 21 | 19 | 1 | 1 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 5 | 0 | 0 | 0 |
| teacher_marks | 5 | 2 | 0 | 0 | 3 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-86 | quatre-vingt-six | null | null / null | 0.98 | abstain |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 / 30, 30, 20 | 0.62 | misread, false correction |
| p2-60 | 60,60,60 | 66, 60, 60 | 66, 60, 60 / 66, 60, 60 | 0.62 | misread, false correction |
| p3-s6 | null | 3 | 3 / 3 | 0.62 | invented |
| p3-a9 | 7 | null | null / null | 0.9 | abstain |
| p5-row2 | 1,2,3,4 | 1,2,3 | 1,2,3 / 1,2,3 | 0.72 | misread, teacher marks |
| p5-row4 | 1,2,3,4 | 1,2,3 | 1,2,3 / 1,2,3 | 0.84 | misread, teacher marks |
| p5-row5 | 2,3,4 | 2,3 | 2,3 / 2,3 | 0.92 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The pencil lines are faint and overlap; the word at the bottom right is cut off.
- photo-02-dizaines.jpg: The page is visible, though some pencil writing is faint and a little blurry.
- photo-03-soustractions-additions.jpg: The writing is mostly readable, but several answers in the right column are cut off by the photo edge.
- photo-04-nombre-8.jpg: The photo is slightly blurry, especially around the drawn crosses and dots.
- photo-05-ecriture-chiffres.jpg: The photo is slightly blurry, but most red crossing marks are visible.
