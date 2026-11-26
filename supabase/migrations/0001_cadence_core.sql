-- Cadence core schema: accounts, saved settings, Cadence+ entitlement, and
-- the score-alert relay. Every table has row-level security. Fans can read
-- and write only their own rows; anything billing- or relay-related is
-- written by Edge Functions with the service role, never by the browser.

-- ---------------------------------------------------------------- accounts
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  created_at   timestamptz not null default now()
);

-- one JSON document of app settings (theme, text size, colors, circuit,
-- alert scope...) so new settings never need a migration
create table public.preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb
             check (pg_column_size(settings) < 16384),
  updated_at timestamptz not null default now()
);

create table public.favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  circuit    text not null default 'dci' check (circuit in ('dci', 'wgi')),
  name       text not null check (char_length(name) between 1 and 120),
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, circuit, name)
);

-- ------------------------------------------------------------- Cadence+
-- written only by the stripe-webhook function (service role)
create table public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text not null default 'none',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

create or replace function public.is_plus(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')
  );
$$;
revoke all on function public.is_plus(uuid) from public;
grant execute on function public.is_plus(uuid) to authenticated;

-- new account -> profile + empty preferences
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name',
                                new.raw_user_meta_data->>'name', ''), 60))
  on conflict do nothing;
  insert into public.preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------- alert relay
-- Browser push registrations. Anonymous by design (alerts work without an
-- account); linked to a user when they are signed in.
create table public.push_subs (
  endpoint   text primary key check (char_length(endpoint) < 1000),
  sub        jsonb not null,
  user_id    uuid references auth.users(id) on delete set null,
  favs       jsonb not null default '[]'::jsonb,
  favs_only  boolean not null default false,
  classes    jsonb,                 -- null = every class
  circuits   jsonb not null default '["dci","wgi"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- relay key/value: VAPID keys (generated once, never rotated), last-seen
-- score snapshots, run status
create table public.relay_kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- one row per show already alerted: the anti-spam ledger
create table public.relay_notified (
  key        text primary key,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- RLS
alter table public.profiles       enable row level security;
alter table public.preferences    enable row level security;
alter table public.favorites      enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.push_subs      enable row level security;
alter table public.relay_kv       enable row level security;
alter table public.relay_notified enable row level security;

create policy "own profile: read"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own prefs: read"   on public.preferences for select to authenticated using (user_id = (select auth.uid()));
create policy "own prefs: insert" on public.preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own prefs: update" on public.preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own favs: read"   on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy "own favs: insert" on public.favorites for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own favs: update" on public.favorites for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own favs: delete" on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

-- fans can SEE their own subscription; only the webhook writes it
create policy "own subscription: read" on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- push_subs, relay_kv, relay_notified: no policies = service role only
comment on table public.push_subs is 'Service-role only: written by the relay Edge Function.';
comment on table public.relay_kv is 'Service-role only: VAPID keys and relay state. Never rotate the vapid row.';
comment on table public.relay_notified is 'Service-role only: shows already alerted.';
