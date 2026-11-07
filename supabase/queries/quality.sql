-- Silia's quality, week by week and by prompt version (run in the SQL Editor). Signals: table feedback_signals.

-- 1. The main rates per week and prompt version.
with s as (
  select date_trunc('week', created_at) as week, prompt_version, kind, data
  from public.feedback_signals
  where created_at > now() - interval '12 weeks'
)
select
  week,
  prompt_version,
  count(*) filter (where kind = 'photo') as photos,
  round(100.0 * count(*) filter (where kind = 'photo' and (data->>'same_page')::boolean and (data->>'since_prev_s')::int < 120)
        / nullif(count(*) filter (where kind = 'photo'), 0), 1) as retake_pct,
  round(100.0 * count(*) filter (where kind = 'misread')
        / nullif(count(*) filter (where kind in ('misread', 'read_confirmed')), 0), 1) as misread_pct,
  round(100.0 * count(*) filter (where kind = 'verdict_disputed')
        / nullif(count(*) filter (where kind = 'wrong_said'), 0), 1) as disputed_pct,
  round(100.0 * count(*) filter (where kind = 'unsure_asked')
        / nullif(count(*) filter (where kind = 'verdict'), 0), 1) as asks_unsure_pct,
  count(*) filter (where kind = 'timeout') as timeouts
from s
group by 1, 2
order by 1 desc, 2;

-- 2. Explanations that did not help: the same exercise explained 2 times or more in a session.
select session_id, exercise, count(*) as explains
from public.feedback_signals
where kind = 'action' and data->>'action' in ('explain', 'solve') and created_at > now() - interval '4 weeks'
group by 1, 2
having count(*) >= 2
order by explains desc;

-- 3. Solution asked early: no check of that exercise before, or only one.
select a.session_id, a.exercise, a.created_at,
  (select count(*) from public.feedback_signals v
    where v.session_id = a.session_id and v.exercise = a.exercise and v.kind = 'verdict' and v.created_at < a.created_at) as checks_before
from public.feedback_signals a
where a.kind = 'action' and a.data->>'action' = 'solution' and a.created_at > now() - interval '4 weeks'
order by a.created_at desc;

-- 4. The cases to review (and to add to the test set): misreads and disputed verdicts, with the photo.
select f.created_at, f.kind, f.exercise, f.data, s.storage_path
from public.feedback_signals f
left join public.snapshots s on s.id = f.snapshot_id
where f.kind in ('misread', 'verdict_disputed') and f.created_at > now() - interval '4 weeks'
order by f.created_at desc;

-- 5. Speed (turn_logs): median and slowest 10 % per function, last 2 weeks.
select fn, count(*) as turns,
  percentile_cont(0.5) within group (order by ms)::int as p50_ms,
  percentile_cont(0.9) within group (order by ms)::int as p90_ms
from public.turn_logs
where created_at > now() - interval '2 weeks'
group by fn
order by p90_ms desc;
