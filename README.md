# AI Homework Companion

A cheerful cartoon version of your child helps with real paper homework on the TV, watching the notebook through a phone and speaking naturally.

## Structure

| Folder | What lives there |
| --- | --- |
| `apps/mobile` | Expo (React Native + TypeScript) app. One codebase, three roles: Board (TV/tablet), Camera (phone), Parent (phones). Android TV via `react-native-tvos`. |
| `packages/shared` | Types shared by the app and Edge Functions: Realtime event names and payloads, DB row types. |
| `supabase/migrations` | SQL: tables, Row Level Security, storage policies, pg_cron jobs. |
| `supabase/functions` | Edge Functions (Deno): `pair-device`, `analyze-snapshot`, `child-talk`, `tutor-speak`, `end-session`. `_shared` holds common helpers (AI clients, auth, broadcast). |
| `assets` | Avatar (Rive), pre-recorded phrases per language, fonts. |
| `experiments/m0-handwriting-test` | Milestone M0: real notebook photos and vision-model results. |
| `docs` | Concept and technical plan. |

## Roadmap

- M0 Handwriting test (go/no-go)
- M1 Vertical slice: photo, AI, chalk circle + spoken hint on the Board
- M2 Three roles live
- M3 Voice
- M4 Smart capture and memory
- M5 Polish and languages
