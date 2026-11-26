-- Run the relay's score check every 20 seconds. The function throttles
-- itself (15 s on show days, ~2 min otherwise), so off-season runs are a
-- cheap no-op. The relay URL is public; /check is idempotent and needs no key.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'cadence-relay-check',
  '20 seconds',
  $$ select net.http_post(
       url := 'https://qwjmrdkcoaiesaweaggp.supabase.co/functions/v1/relay/check',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 25000
     ) $$
);

-- keep pg_net's response log from growing without bound
select cron.schedule('cadence-net-cleanup', '17 3 * * *',
  $$ delete from net._http_response where created < now() - interval '1 day' $$);
