# M0 handwriting test results

Scored: 2026-11-04T15:35:20.120Z · confidence threshold 0.75

> Labels not fully verified for: photo-01-nombres-en-lettres.jpg, photo-02-dizaines.jpg, photo-03-soustractions-additions.jpg, photo-04-nombre-8.jpg, photo-05-ecriture-chiffres.jpg.

## Overview

"Core" = items where the child wrote an answer (no teacher marks, no stretch counting).

| Provider | Model | Core correct | Core safe (correct or abstained) | Abstained | Invented | Runs disagreed | False corrections | Harmful | Missed errors | Avg time / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | gpt-6-luna (minimal) · 1536px | 8% (48) | 100% | 44 | 0 | 0 | 0 | 0 | 0 | 359 ms |

Gate to pass M0: core correct >= 90%, 0 harmful, 0 invented.

## openai · by task

| Task | Items | Correct | Abstained | Invented | Misread |
| --- | --- | --- | --- | --- | --- |
| matching | 12 | 0 | 12 | 0 | 0 |
| copy | 10 | 0 | 10 | 0 | 0 |
| fill_in | 21 | 4 | 17 | 0 | 0 |
| mixed | 5 | 0 | 5 | 0 | 0 |
| mixed (stretch) | 5 | 0 | 5 | 0 | 0 |
| teacher_marks | 5 | 0 | 5 | 0 | 0 |

## openai · not correct

| Item | Expected | Tutor sees | Each run | Confidence | Outcome |
| --- | --- | --- | --- | --- | --- |
| p1-15 | quinze | null | null | 0 | abstain |
| p1-24 | vingt-quatre | null | null | 0 | abstain |
| p1-53 | cinquante-trois | null | null | 0 | abstain |
| p1-79 | soixante-dix-neuf | null | null | 0 | abstain |
| p1-91 | quatre-vingt-onze | null | null | 0 | abstain |
| p1-44 | quarante-quatre | null | null | 0 | abstain |
| p1-67 | soixante-sept | null | null | 0 | abstain |
| p1-18 | dix-huit | null | null | 0 | abstain |
| p1-80 | quatre-vingts | null | null | 0 | abstain |
| p1-42 | quarante-deux | null | null | 0 | abstain |
| p1-86 | quatre-vingt-six | null | null | 0 | abstain |
| p1-31 | trente-et-un | null | null | 0 | abstain |
| p2-10 | 10,10,10 | null | null | 0 | abstain |
| p2-20 | 20,20,20 | null | null | 0 | abstain |
| p2-30 | 30,30,30 | null | null | 0 | abstain |
| p2-40 | 40,40,40 | null | null | 0 | abstain |
| p2-50 | 50,50,50 | null | null | 0 | abstain |
| p2-60 | 60,60,60 | null | null | 0 | abstain |
| p2-70 | 70,70,70 | null | null | 0 | abstain |
| p2-80 | 80,80,80 | null | null | 0 | abstain |
| p2-90 | 90,90,90 | null | null | 0 | abstain |
| p2-100 | 100,100,100 | null | null | 0 | abstain |
| p3-s1 | 4 | null | null | 0 | abstain |
| p3-s2 | 6 | null | null | 0 | abstain |
| p3-s4 | 4 | null | null | 0 | abstain |
| p3-s5 | 5 | null | null | 0 | abstain |
| p3-s7 | 2 | null | null | 0 | abstain |
| p3-s8 | 2 | null | null | 0 | abstain |
| p3-a1 | 4 | null | null | 0 | abstain |
| p3-a2 | 3 | null | null | 0 | abstain |
| p3-a3 | 6 | null | null | 0 | abstain |
| p3-a4 | 5 | null | null | 0 | abstain |
| p3-a5 | 2 | null | null | 0 | abstain |
| p3-a6 | 1 | null | null | 0 | abstain |
| p3-a7 | 5 | null | null | 0 | abstain |
| p3-a8 | 4 | null | null | 0 | abstain |
| p3-a9 | 7 | null | null | 0 | abstain |
| p3-a10 | 6 | null | null | 0 | abstain |
| p3-a11 | 3 | null | null | 0 | abstain |
| p4-line3 | 3 | null | null | 0 | abstain |
| p4-line4 | 4 | null | null | 0 | abstain |
| p4-line6 | 6 | null | null | 0 | abstain |
| p4-line7 | 7 | null | null | 0 | abstain |
| p4-teacher4 | yes | null | null | 0 | abstain |
| p4-cross6 | 6 | null | null | 0 | abstain, stretch |
| p4-cross7 | 7 | null | null | 0 | abstain, stretch |
| p4-cross8 | 8 | null | null | 0 | abstain, stretch |
| p4-dots6 | 6 | null | null | 0 | abstain, stretch |
| p4-dots7 | 7 | null | null | 0 | abstain, stretch |
| p5-row1 | none | null | null | 0 | abstain, teacher marks |
| p5-row2 | 1,2,3,4 | null | null | 0 | abstain, teacher marks |
| p5-row3 | none | null | null | 0 | abstain, teacher marks |
| p5-row4 | 1,2,3,4 | null | null | 0 | abstain, teacher marks |
| p5-row5 | 2,3,4 | null | null | 0 | abstain, teacher marks |

Photo notes from the model:

- photo-01-nombres-en-lettres.jpg: ERROR HTTP 400: {
  "error": {
    "message": "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.",
    "type": "invalid_request_error",
    "param": "reasoning_effort",
    "code": "unsupported_value"
  }
}
- photo-02-dizaines.jpg: ERROR HTTP 400: {
  "error": {
    "message": "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.",
    "type": "invalid_request_error",
    "param": "reasoning_effort",
    "code": "unsupported_value"
  }
}
- photo-03-soustractions-additions.jpg: ERROR HTTP 400: {
  "error": {
    "message": "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.",
    "type": "invalid_request_error",
    "param": "reasoning_effort",
    "code": "unsupported_value"
  }
}
- photo-04-nombre-8.jpg: ERROR HTTP 400: {
  "error": {
    "message": "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.",
    "type": "invalid_request_error",
    "param": "reasoning_effort",
    "code": "unsupported_value"
  }
}
- photo-05-ecriture-chiffres.jpg: ERROR HTTP 400: {
  "error": {
    "message": "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.",
    "type": "invalid_request_error",
    "param": "reasoning_effort",
    "code": "unsupported_value"
  }
}
