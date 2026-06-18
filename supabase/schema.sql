-- FwdFam Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- Extends Supabase Auth. One row per paying/trialing parent.
-- ============================================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  timezone text not null default 'America/Los_Angeles',
  inbound_email_handle text unique not null, -- e.g. "patrick-a3f2" -> patrick-a3f2@mail.fwdfam.app
  calendar_provider text not null default 'google', -- 'google' | 'apple'
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text not null default 'trialing', -- trialing | active | canceled | past_due
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: users can only read/write their own row
alter table public.users enable row level security;

create policy "Users can view own record"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own record"
  on public.users for update
  using (auth.uid() = id);

-- ============================================================
-- OAUTH TOKENS TABLE
-- Stores Google OAuth refresh tokens AND Apple CalDAV credentials.
-- HIGH SECURITY TABLE -- zero client access, service role only.
--
-- For Google (provider = 'google'):
--   refresh_token = Google OAuth2 refresh token
--   access_token  = short-lived access token (refreshed on each use)
--
-- For Apple (provider = 'apple'):
--   refresh_token = Apple app-specific password (mis-named for schema reuse)
--   access_token  = iCloud email address (used as CalDAV Basic Auth username)
--   token_expiry  = null (app-specific passwords don't expire unless revoked)
-- ============================================================
create table public.oauth_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,                   -- 'google' | 'apple'
  access_token text,                        -- Google: short-lived token | Apple: iCloud email
  refresh_token text not null,              -- Google: refresh token | Apple: app-specific password
  token_expiry timestamptz,                 -- Google: expiry time | Apple: null
  scopes text[],                            -- Google only: e.g. ['https://www.googleapis.com/auth/calendar']
  caldav_home_url text,                     -- Apple only: discovered CalDAV home URL, cached after first PROPFIND
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

-- RLS: ZERO client access. Only service role (server-side) can read/write.
alter table public.oauth_tokens enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE policies = no client can access this table.
-- Server-side code uses the SERVICE_ROLE key (never exposed to client).

-- ============================================================
-- EMAIL REQUESTS TABLE
-- Audit log of every processed email. Rate limiting + debugging.
-- ============================================================
create table public.email_requests (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  source_email_from text,                   -- who sent the original email
  source_email_subject text,
  attachment_count int not null default 0,  -- number of image/PDF attachments processed
  events_extracted int not null default 0,  -- how many events were found
  calendar_provider text,                   -- 'google' | 'apple' -- which path was used
  status text not null default 'success',   -- success | zero_events | llm_error | calendar_error
  error_message text,                       -- null on success
  processing_ms int                         -- latency tracking
);

-- RLS: users can view their own request history (for future /account page)
alter table public.email_requests enable row level security;

create policy "Users can view own requests"
  on public.email_requests for select
  using (auth.uid() = user_id);

-- ============================================================
-- RATE LIMIT VIEW
-- Prevents API abuse. Check this before processing each email.
-- Limit: 50 emails per user per day.
-- ============================================================
create or replace view public.user_daily_request_count as
select
  user_id,
  count(*) as request_count,
  date_trunc('day', now()) as period
from public.email_requests
where received_at > date_trunc('day', now())
group by user_id;

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_email_requests_user_id on public.email_requests(user_id);
create index idx_email_requests_received_at on public.email_requests(received_at desc);
create index idx_users_inbound_handle on public.users(inbound_email_handle);
create index idx_oauth_tokens_user_id on public.oauth_tokens(user_id);

-- ============================================================
-- UPDATED_AT TRIGGER (reusable)
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at
  before update on public.users
  for each row execute procedure public.handle_updated_at();

create trigger oauth_tokens_updated_at
  before update on public.oauth_tokens
  for each row execute procedure public.handle_updated_at();
