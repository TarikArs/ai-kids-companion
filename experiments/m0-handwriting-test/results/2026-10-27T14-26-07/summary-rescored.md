# M0 handwriting test results

Scored: 2026-10-27T14:40:52.339Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-4o | 85% (48) | 92% | 3 | 0 | 0 | 9 | 7 | 0 | 3881 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 8 | 0 | 0 | 4 |
| copy | 10 | 10 | 0 | 0 | 0 |
| fill_in | 21 | 18 | 3 | 0 | 0 |
| mixed | 5 | 5 | 0 | 0 | 0 |
| mixed (stretch) | 5 | 0 | 0 | 0 | 5 |
| teacher_marks | 5 | 0 | 0 | 0 | 5 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-24 | vingt-quatre | quarante-deux | quarante-deux | 0.8 | misread, HARMFUL |
| p1-42 | quarante-deux | trente-et-un | trente-et-un | 0.9 | misread, HARMFUL |
| p1-86 | quatre-vingt-six | quatre-vingt-dix | quatre-vingt-dix | 0 | misread, false correction |
| p1-31 | trente-et-un | null | null | 0 | misread, false correction |
| p3-a3 | 6 | null | null | 0 | abstain |
| p3-a6 | 1 | null | null | 0 | abstain |
| p3-a9 | 7 | null | null | 0 | abstain |
| p4-cross6 | 6 | 4 | 4 | 1 | misread, HARMFUL, stretch |
| p4-cross7 | 7 | 6 | 6 | 1 | misread, HARMFUL, stretch |
| p4-cross8 | 8 | 5 | 5 | 1 | misread, HARMFUL, stretch |
| p4-dots6 | 6 | 8 | 8 | 1 | misread, HARMFUL, stretch |
| p4-dots7 | 7 | 9 | 9 | 1 | misread, HARMFUL, stretch |
| p5-row1 | none | 1,2 | 1,2 | 1 | misread, teacher marks |
| p5-row2 | 1,2,3,4 | 1,3,4 | 1,3,4 | 1 | misread, teacher marks |
| p5-row3 | none | 1,2 | 1,2 | 1 | misread, teacher marks |
| p5-row4 | 1,2,3,4 | 1,2 | 1,2 | 1 | misread, teacher marks |
| p5-row5 | 2,3,4 | 2 | 2 | 1 | misread, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: The photo is clear but the last few lines are partly cut off.
- photo-02-dizaines.jpg: The photo is clear and the writing is legible.
- photo-03-soustractions-additions.jpg: Page has good lighting but is slightly cut off on the right side.
- photo-04-nombre-8.jpg: Slight blur but text mostly readable.
- photo-05-ecriture-chiffres.jpg: Photo is slightly blurry but readable.
