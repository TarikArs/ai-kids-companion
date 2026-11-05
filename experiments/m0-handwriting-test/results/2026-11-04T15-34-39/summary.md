# M0 handwriting test results

Scored: 2026-11-04T15:35:15.262Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (low) · 1280px | 94% (48) | 96% | 1 | 0 | 0 | 2 | 2 | 0 | 7029 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 12 | 0 | 0 | 0 |
| copy | 10 | 8 | 0 | 0 | 2 |
| fill_in | 21 | 20 | 1 | 0 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 5 | 0 | 0 | 0 |
| teacher_marks | 5 | 2 | 0 | 0 | 3 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p2-10 | 10,10,10 | 10, 40, 10 | 10, 40, 10 | 0.78 | misread, HARMFUL |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 | 0.78 | misread, HARMFUL |
| p3-a9 | 7 | null | null | 0.99 | abstain |
| p5-row2 | 1,2,3,4 | 1,2 | 1,2 | 0.94 | misread, teacher marks |
| p5-row4 | 1,2,3,4 | 1,2,3 | 1,2,3 | 0.87 | misread, teacher marks |
| p5-row5 | 2,3,4 | 2 | 2 | 0.94 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The photo is readable, though several pencil lines cross and the bottom-right word is partly cut off.
- photo-02-dizaines.jpg: The pencil writing is mostly readable, though a few digits are faint or irregular.
- photo-03-soustractions-additions.jpg: The photo is fairly clear, but several answers in the right column are cut off.
- photo-04-nombre-8.jpg: The photo is slightly blurry and tilted, but most marks are visible.
- photo-05-ecriture-chiffres.jpg: The page is visible, though the red marks are faint in places.
