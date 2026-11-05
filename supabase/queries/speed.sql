-- Speed per function, last 7 days: median and 90th percentile, and where the time goes.
select fn,
       count(*) as turns,
       percentile_cont(0.5) within group (order by ms) as median_ms,
       percentile_cont(0.9) within group (order by ms) as p90_ms,
       round(avg((timings->>'vision_ms')::int)) as avg_reading_ms,
       round(avg((timings->>'hint_ms')::int)) as avg_hint_ms,
       round(avg((timings->>'tts_ms')::int)) as avg_voice_ms,
       round(avg((extra->>'image_kb')::int)) as avg_image_kb
from public.turn_logs
where created_at > now() - interval '7 days'
group by fn
order by turns desc;

-- Reading model / effort comparison (after changing OPENAI_READ_MODEL or OPENAI_READ_EFFORT).
select model, effort, count(*) as photos,
       percentile_cont(0.5) within group (order by (timings->>'vision_ms')::int) as median_reading_ms,
       round(avg((usage->>'completion_tokens')::int)) as avg_output_tokens
from public.turn_logs
where fn = 'analyze-snapshot' and created_at > now() - interval '7 days'
group by model, effort;
