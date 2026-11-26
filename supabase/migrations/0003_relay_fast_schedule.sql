-- Two speeds. Once a minute, always: keeps the show-day flag and the
-- site safety net current. Every 5 seconds, but only while the relay has
-- flagged a live show day (relay_kv 'mode'.hot) — off days cost nothing.
select cron.unschedule('cadence-relay-check');

select cron.schedule('cadence-relay-check', '* * * * *',
  $$ select net.http_post(
       url := 'https://qwjmrdkcoaiesaweaggp.supabase.co/functions/v1/relay/check',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb, timeout_milliseconds := 25000) $$);

select cron.schedule('cadence-relay-fast', '5 seconds',
  $$ select net.http_post(
       url := 'https://qwjmrdkcoaiesaweaggp.supabase.co/functions/v1/relay/check',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb, timeout_milliseconds := 20000)
     where coalesce((select (value->>'hot')::boolean from public.relay_kv where key = 'mode'), false) $$);
