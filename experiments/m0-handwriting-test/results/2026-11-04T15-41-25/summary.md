# M0 handwriting test results

Scored: 2026-11-04T15:42:48.704Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (low) · 1536px | 90% (48) | 98% | 4 | 0 | 4 | 1 | 1 | 0 | 8243 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 11 | 1 | 0 | 0 |
| copy | 10 | 7 | 2 | 0 | 1 |
| fill_in | 21 | 20 | 1 | 0 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 4 | 1 | 0 | 0 |
| teacher_marks | 5 | 3 | 1 | 0 | 1 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-86 | quatre-vingt-six | null | null / null | 0.93 | abstain |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 / 30, 30, 20 | 0.81 | misread, HARMFUL |
| p2-60 | 60,60,60 | null | 66, 60, 60 / 60, 60, 60 | 0 | abstain, runs disagree |
| p2-100 | 100,100,100 | null | 100, 100, 160 / 100, 100, 100 | 0 | abstain, runs disagree |
| p3-a9 | 7 | null | null / null | 0.99 | abstain |
| p4-cross8 | 8 | null | null / 8 | 0 | abstain, runs disagree, stretch |
| p5-row2 | 1,2,3,4 | null | 1,2,3 / 1,2 | 0 | abstain, runs disagree, teacher marks |
| p5-row5 | 2,3,4 | 2 | 2 / 2 | 0.94 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The pencil lines are faint and cross, and the bottom-right word is cut off.
- photo-02-dizaines.jpg: The writing is visible overall, though some pencil digits are faint and ambiguous.
- photo-03-soustractions-additions.jpg: The page is fairly clear, but the rightmost column is cut off.
- photo-04-nombre-8.jpg: The photo is slightly blurry, and some marks in the upper ovals are faint.
- photo-05-ecriture-chiffres.jpg: The photo is slightly blurry, but the red crossing marks are mostly distinguishable.
