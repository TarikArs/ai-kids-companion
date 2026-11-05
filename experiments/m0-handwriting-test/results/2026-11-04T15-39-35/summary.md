# M0 handwriting test results

Scored: 2026-11-04T15:40:04.747Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (none) · 1536px | 90% (48) | 96% | 3 | 0 | 1 | 2 | 2 | 0 | 2914 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 12 | 0 | 0 | 0 |
| copy | 10 | 8 | 0 | 0 | 2 |
| fill_in | 21 | 18 | 3 | 0 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 4 | 1 | 0 | 0 |
| teacher_marks | 5 | 3 | 0 | 0 | 2 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 / 30, 30, 20 | 0.86 | misread, HARMFUL |
| p2-60 | 60,60,60 | 66, 60, 60 | 66, 60, 60 / 66, 60, 60 | 0.9 | misread, HARMFUL |
| p3-a3 | 6 | null | null / null | 0.99 | abstain |
| p3-a6 | 1 | null | null / null | 0.99 | abstain |
| p3-a9 | 7 | null | null / null | 0.99 | abstain |
| p4-cross8 | 8 | null | 6 / 5 | 0 | abstain, runs disagree, stretch |
| p5-row2 | 1,2,3,4 | 1,2 | 1,2 / 1,2 | 0.92 | misread, teacher marks |
| p5-row5 | 2,3,4 | 2 | 2 / 2 | 0.92 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The pencil lines are faint and cross in the middle, but their endpoints are mostly visible.
- photo-02-dizaines.jpg: The page is mostly readable, though some pencil writing is faint and uneven.
- photo-03-soustractions-additions.jpg: The rightmost column is cut off, while the other pencil answers are mostly legible.
- photo-04-nombre-8.jpg: The photo is slightly blurry and tilted, but the requested marks are mostly visible.
- photo-05-ecriture-chiffres.jpg: The photo is slightly blurry, but the red crossing marks are mostly visible.
