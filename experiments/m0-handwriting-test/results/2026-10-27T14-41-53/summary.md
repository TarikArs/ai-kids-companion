# M0 handwriting test results

Scored: 2026-10-27T14:43:21.198Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (low) | 92% (48) | 94% | 1 | 1 | 0 | 2 | 1 | 0 | 8729 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 12 | 0 | 0 | 0 |
| copy | 10 | 8 | 0 | 0 | 2 |
| fill_in | 21 | 19 | 1 | 1 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 5 | 0 | 0 | 0 |
| teacher_marks | 5 | 2 | 0 | 0 | 3 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 / 30, 30, 20 | 0.75 | misread, HARMFUL |
| p2-60 | 60,60,60 | 66, 60, 60 | 66, 60, 60 / 66, 60, 60 | 0.72 | misread, false correction |
| p3-s6 | null | 3 | 3 / 3 | 0.65 | invented |
| p3-a9 | 7 | null | null / null | 0.1 | abstain |
| p5-row2 | 1,2,3,4 | 1,2,3 | 1,2,3 / 1,2,3 | 0.76 | misread, teacher marks |
| p5-row4 | 1,2,3,4 | 1,2,3 | 1,2,3 / 1,2,3 | 0.94 | misread, teacher marks |
| p5-row5 | 2,3,4 | 2,3 | 2,3 / 2,3 | 0.97 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The page is readable, though several pencil lines overlap and are faint.
- photo-02-dizaines.jpg: The page is visible overall, though some pencil digits are faint and uneven.
- photo-03-soustractions-additions.jpg: The writing is mostly readable, but the right column is cut off by the photo.
- photo-04-nombre-8.jpg: The photo is slightly blurry, but most writing and marks are visible.
- photo-05-ecriture-chiffres.jpg: The page is mostly visible, though the photo is slightly blurry.
