# M0 handwriting test results

Scored: 2026-11-04T15:41:25.846Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (low) · 2048px | 90% (48) | 98% | 4 | 0 | 3 | 1 | 0 | 0 | 8058 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 11 | 1 | 0 | 0 |
| copy | 10 | 7 | 2 | 0 | 1 |
| fill_in | 21 | 20 | 1 | 0 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 4 | 1 | 0 | 0 |
| teacher_marks | 5 | 4 | 0 | 0 | 1 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-86 | quatre-vingt-six | null | null / null | 0.39 | abstain |
| p2-20 | 20,20,20 | null | 20, 22, 20 / 20, 20, 20 | 0 | abstain, runs disagree |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 / 30, 30, 20 | 0.73 | misread, false correction |
| p2-60 | 60,60,60 | null | 66, 60, 60 / 60, 60, 60 | 0 | abstain, runs disagree |
| p3-a9 | 7 | null | null / null | 0.99 | abstain |
| p4-cross8 | 8 | null | 7 / 8 | 0 | abstain, runs disagree, stretch |
| p5-row2 | 1,2,3,4 | 1,2,3 | 1,2,3 / 1,2,3 | 0.78 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The page is readable, but the bottom-right word is cut off and several pencil lines cross.
- photo-02-dizaines.jpg: The page is fully visible, though some pencil digits are faint and irregular.
- photo-03-soustractions-additions.jpg: The writing is mostly legible, but the right column is cut off.
- photo-04-nombre-8.jpg: The photo is slightly blurry, making some of the small drawn marks difficult to count.
- photo-05-ecriture-chiffres.jpg: The photo is slightly blurry and angled, but the red crossing marks are mostly visible.
