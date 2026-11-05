# M0 handwriting test results

Scored: 2026-11-04T15:34:39.725Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (low) · 1536px | 90% (48) | 94% | 2 | 0 | 0 | 3 | 1 | 0 | 8527 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 11 | 1 | 0 | 0 |
| copy | 10 | 7 | 0 | 0 | 3 |
| fill_in | 21 | 20 | 1 | 0 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 5 | 0 | 0 | 0 |
| teacher_marks | 5 | 3 | 0 | 0 | 2 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-86 | quatre-vingt-six | null | null | 0.98 | abstain |
| p2-30 | 30,30,30 | 30, 30, 20 | 30, 30, 20 | 0.77 | misread, HARMFUL |
| p2-60 | 60,60,60 | 66, 60, 60 | 66, 60, 60 | 0.62 | misread, false correction |
| p2-100 | 100,100,100 | 160, 100, 160 | 160, 100, 160 | 0.58 | misread, false correction |
| p3-a9 | 7 | null | null | 0.99 | abstain |
| p5-row2 | 1,2,3,4 | 1,2,3 | 1,2,3 | 0.72 | misread, teacher marks |
| p5-row5 | 2,3,4 | 2,4 | 2,4 | 0.62 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The pencil lines are faint and cross, and the final word is cut off at the page edge.
- photo-02-dizaines.jpg: The page is mostly clear, though some pencil digits are faint and ambiguous.
- photo-03-soustractions-additions.jpg: The photo is readable overall, but the right column is cut off.
- photo-04-nombre-8.jpg: The photo is slightly blurry, and some of the pale marks are difficult to distinguish.
- photo-05-ecriture-chiffres.jpg: The photo is slightly blurry, making some faint red crossing marks difficult to distinguish.
