# M0 handwriting test results

Scored: 2026-11-04T15:39:35.179Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (none) · 2048px | 79% (48) | 98% | 9 | 0 | 6 | 1 | 1 | 0 | 3854 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 7 | 5 | 0 | 0 |
| copy | 10 | 8 | 1 | 0 | 1 |
| fill_in | 21 | 18 | 3 | 0 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 5 | 0 | 0 | 0 |
| teacher_marks | 5 | 2 | 0 | 0 | 3 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-79 | soixante-dix-neuf | null | quatre-vingt-onze / soixante-dix-neuf | 0 | abstain, runs disagree |
| p1-91 | quatre-vingt-onze | null | soixante-dix-neuf / quatre-vingt-onze | 0 | abstain, runs disagree |
| p1-44 | quarante-quatre | null | soixante-dix-neuf / quarante-quatre | 0 | abstain, runs disagree |
| p1-18 | dix-huit | null | trente-et-un / dix-huit | 0 | abstain, runs disagree |
| p1-31 | trente-et-un | null | dix-huit / trente-et-un | 0 | abstain, runs disagree |
| p2-30 | 30,30,30 | null | 30, 30, 30 / 30, 30, 20 | 0 | abstain, runs disagree |
| p2-60 | 60,60,60 | 66, 60, 60 | 66, 60, 60 / 66, 60, 60 | 0.87 | misread, HARMFUL |
| p3-a3 | 6 | null | null / null | 0.99 | abstain |
| p3-a6 | 1 | null | null / null | 0.99 | abstain |
| p3-a9 | 7 | null | null / null | 0.99 | abstain |
| p5-row2 | 1,2,3,4 | 1,2,3 | 1,2,3 / 1,2,3 | 0.93 | misread, teacher marks |
| p5-row4 | 1,2,3,4 | 1,2,3 | 1,2,3 / 1,2,3 | 0.91 | misread, teacher marks |
| p5-row5 | 2,3,4 | 2,3 | 2,3 / 2,3 | 0.92 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The photo is readable, though several pencil lines cross and overlap near the center.
- photo-02-dizaines.jpg: The page is fully visible and reasonably clear, though the pencil writing is faint in places.
- photo-03-soustractions-additions.jpg: The photo is fairly clear, but the right edge cuts off the answers in the right column.
- photo-04-nombre-8.jpg: The photo is somewhat blurry, but the requested marks are mostly visible.
- photo-05-ecriture-chiffres.jpg: The page is slightly blurry, but the red crossing marks are mostly clear.
