-- MFG Portal · schema + Row Level Security · DRAFT for Phase 0 review
-- Spec: PORTAL_SPEC.md §11. Every table in `public` has RLS enabled.
--
-- Design notes (see docs/PHASE-0-PLAN.md for the reasoning):
--   * `profiles` is generic (shared later with the Academy). Client and coach
--     details live in `clients` and `coaches`, keyed by the same user id.
--   * The owner is whoever has profiles.is_owner = true. The app sets that flag
--     from OWNER_EMAILS with the service role at sign-in; users cannot set it.
--   * Owner and coach access needs a two-step (aal2) session: private.mfa_ok().
--   * Coach financial access = assigned (active) AND consent on AND certified.
--   * Column-level grants stop users writing columns they don't own
--     (is_owner, coach status, other_confirmed, stage history…).

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Core identity
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  whatsapp    text,
  is_owner    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.clients (
  id           uuid primary key references public.profiles (id) on delete cascade,
  need         text not null check (need in (
                 'Getting out of debt','Questions about debt review',
                 'Staying out of debt','Building wealth')),
  heard_from   text not null check (heard_from in (
                 'MFG website','LinkedIn','TikTok','Facebook','The Debt Millionaire book',
                 'The book launch','A friend or family member','Other')),
  auth_method  text not null check (auth_method in ('email','google','apple','facebook','linkedin')),
  stage_start  smallint not null check (stage_start between 1 and 3),
  payday       smallint not null default 25 check (payday between 1 and 31),
  consent      boolean not null default true,
  consent_at   timestamptz not null default now(),
  terms_at     timestamptz not null default now(),
  status       text not null default 'waiting' check (status in ('waiting','active','inactive')),
  created_at   timestamptz not null default now()
);

-- Every consent change, with its time (§4 "Record consent with a timestamp").
create table public.consent_events (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.clients (id) on delete cascade,
  consent    boolean not null,
  at         timestamptz not null default now()
);

create table public.coach_applications (
  id              uuid primary key default gen_random_uuid(),
  applicant_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  full_name       text not null check (length(trim(full_name)) > 0),
  email           text not null,
  whatsapp        text not null,
  province        text not null check (province in (
                    'Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo',
                    'Mpumalanga','Northern Cape','North West','Western Cape',
                    'Outside South Africa')),
  experience      text not null check (experience in (
                    'None yet, but I''ve lived it',
                    'Informal: I help friends and family with budgets',
                    'Professional coach or mentor',
                    'I work in financial services')),
  read_book       text not null check (read_book in ('Yes, all of it','Part of it','Not yet')),
  capacity        int  not null check (capacity > 0),
  why             text not null check (length(trim(why)) >= 20),
  qualifications  text,
  agreed_protocol boolean not null check (agreed_protocol),
  status          text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by      uuid references public.profiles (id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

create table public.coaches (
  id              uuid primary key references public.profiles (id) on delete cascade,
  status          text not null default 'training'
                    check (status in ('applied','training','certified','inactive')),
  capacity        int  not null check (capacity > 0),
  province        text,
  experience      text,
  application_id  uuid references public.coach_applications (id),
  invite_sent_at  timestamptz,
  certified_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  coach_id     uuid not null references public.coaches (id),
  assigned_at  timestamptz not null default now(),
  assigned_by  uuid not null references public.profiles (id),
  ended_at     timestamptz
);
-- One active coach per client.
create unique index assignments_one_active on public.assignments (client_id) where ended_at is null;
create index assignments_coach_active on public.assignments (coach_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- 2. Tracker (§7)
-- ---------------------------------------------------------------------------

create table public.institutions (
  id         uuid primary key default gen_random_uuid(),
  debt_type  text not null,
  name       text not null,
  active     boolean not null default true,
  sort       int not null default 0,
  unique (debt_type, name)
);

create table public.debts (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients (id) on delete cascade,
  debt_type          text not null check (debt_type in (
                       'Credit card','Store account','Personal loan','Micro / short-term loan',
                       'Vehicle finance','Home loan','Overdraft','Pay later','Cellphone contract',
                       'Informal lender (mashonisa)','Money owed to family','Other')),
  institution_id     uuid references public.institutions (id),
  other_name         text,          -- "Other" lender, exactly as on the statement
  family_who         text,          -- "Money owed to family": who
  other_confirmed    boolean not null default false,
  other_confirmed_by uuid references public.profiles (id),
  balance            numeric(14,2) check (balance >= 0),   -- null = UNKNOWN
  rate               numeric(7,3)  check (rate >= 0),      -- % a year, null = UNKNOWN
  minimum            numeric(14,2) check (minimum >= 0),   -- R a month, null = UNKNOWN
  status             text not null default 'current'
                       check (status in ('current','arrears','attorneys','review')),
  sort               int not null default 0,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz
);
create index debts_client on public.debts (client_id);

create table public.month_budget (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  take_home   numeric(14,2) check (take_home >= 0),
  gross       numeric(14,2) check (gross >= 0),
  unique (client_id, month)
);

create table public.budget_items (
  id         uuid primary key default gen_random_uuid(),
  budget_id  uuid not null references public.month_budget (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  grp        text not null check (grp in ('critical','important','reduce','eliminate')),
  label      text not null,
  amount     numeric(14,2) check (amount >= 0),
  sort       int not null default 0
);

-- Red Lines 2–5 (Red Line 1 is calculated from debt load).
create table public.red_lines (
  client_id     uuid not null references public.clients (id) on delete cascade,
  month         date not null check (extract(day from month) = 1),
  borrowing     boolean,
  missed_three  boolean,
  no_savings    boolean,
  min_only_high boolean,
  primary key (client_id, month)
);

create table public.attack_plan (
  client_id   uuid primary key references public.clients (id) on delete cascade,
  method      text not null default 'avalanche' check (method in ('avalanche','snowball')),
  extra       numeric(14,2) check (extra >= 0),
  updated_at  timestamptz not null default now()
);

-- One row per client per month. Also the Step 5 progress log.
-- stage / rung / climb / gap_after_cuts are calculated by the app (pure,
-- unit-tested functions) and saved with the update.
create table public.monthly_updates (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients (id) on delete cascade,
  month           date not null check (extract(day from month) = 1),
  total           numeric(14,2) not null check (total >= 0),
  open_accounts   int check (open_accounts >= 0),
  minimums        numeric(14,2) check (minimums >= 0),
  gross           numeric(14,2) check (gross >= 0),
  new_credit      boolean,
  borrowing       boolean,
  ef_months       numeric(3,1) check (ef_months in (0, 0.5, 1, 2, 3, 4, 6)), -- 0 = none, 0.5 = less than 1
  asset_income    numeric(14,2) check (asset_income >= 0),
  gap_after_cuts  numeric(14,2),
  stage           smallint check (stage between 1 and 5),
  rung            smallint check (rung between 1 and 5),
  climb           smallint check (climb between 100 and 988),
  created_at      timestamptz not null default now(),
  unique (client_id, month)
);

-- ---------------------------------------------------------------------------
-- 3. Coaching (§8, §9)
-- ---------------------------------------------------------------------------

create table public.programme (
  client_id   uuid primary key references public.clients (id) on delete cascade,
  week        smallint not null default 1 check (week between 1 and 12),
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);

create table public.notes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  coach_id      uuid not null default auth.uid() references public.profiles (id),
  call_date     date not null,
  next_session  date,
  covered       text not null,
  message       text,
  created_at    timestamptz not null default now()
);

create table public.homework (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  text       text not null,
  done       boolean not null default false,
  done_at    timestamptz,
  sort       int not null default 0
);

create table public.referrals (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients (id) on delete cascade,
  coach_id        uuid not null default auth.uid() references public.profiles (id),
  referred_to     text not null check (referred_to in (
                    'NCR-registered debt counsellor','Attorney',
                    'FSCA-licensed financial advisor','Registered tax practitioner',
                    'Professional support (counselling, health)')),
  reason          text not null,
  created_at      timestamptz not null default now(),
  followed_up_at  timestamptz
);

create table public.calls (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  debt_id     uuid references public.debts (id) on delete set null,
  call_date   date not null,
  reference   text,
  offered     text,
  agreed      text,
  in_writing  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.settlements (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  debt_id        uuid not null references public.debts (id) on delete cascade,
  amount         numeric(14,2) not null check (amount > 0),
  in_writing_at  timestamptz,
  paid_at        timestamptz,
  letter_path    text,          -- object path in the private `letters` bucket
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  -- The order is enforced here, not only in the UI (§8).
  constraint paid_needs_writing  check (paid_at is null or in_writing_at is not null),
  constraint letter_needs_paid   check (letter_path is null or paid_at is not null)
);

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  coach_id    uuid references public.profiles (id),
  milestone   smallint not null check (milestone in (4, 8, 12)),
  judged      text not null check (judged in ('No','A little','Yes')),
  understand  text not null check (understand in ('Yes','A little','No')),
  product     text not null check (product in ('No','Yes')),
  comment     text,
  created_at  timestamptz not null default now(),
  unique (client_id, milestone)
);

create table public.help_requests (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid references public.profiles (id)
);

-- ---------------------------------------------------------------------------
-- 4. Owner: settings and audit
-- ---------------------------------------------------------------------------

create table public.settings (
  key          text primary key,
  value        jsonb not null,
  public_read  boolean not null default false,  -- e.g. helplines: every signed-in user can read
  updated_by   uuid references public.profiles (id),
  updated_at   timestamptz not null default now()
);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,         -- 'view' | 'insert' | 'update' | 'delete'
  client_id   uuid,
  table_name  text,
  row_id      text,
  detail      jsonb,
  at          timestamptz not null default now()
);
create index audit_log_client on public.audit_log (client_id, at desc);

-- ---------------------------------------------------------------------------
-- 5. Access helpers (SECURITY DEFINER so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------

create or replace function private.mfa_ok() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.mfa_ok() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_owner)
$$;

create or replace function private.is_certified_coach() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.mfa_ok() and exists (
    select 1 from public.coaches k where k.id = auth.uid() and k.status = 'certified')
$$;

-- Assigned to me and I'm certified. Consent NOT required: this only unlocks the
-- client's name and WhatsApp, so the coach can show "[Name] hasn't shared yet".
create or replace function private.is_my_client(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.mfa_ok() and exists (
    select 1
    from public.assignments a
    join public.coaches k on k.id = a.coach_id
    where a.client_id = cid and a.coach_id = auth.uid()
      and a.ended_at is null and k.status = 'certified')
$$;

-- §11.1: assigned to me AND consent on AND I'm certified.
create or replace function private.coach_can_see(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_my_client(cid) and exists (
    select 1 from public.clients c where c.id = cid and c.consent)
$$;

-- The client's current coach (a client may read that coach's name).
create or replace function private.is_my_coach(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignments a
    where a.client_id = auth.uid() and a.coach_id = pid and a.ended_at is null)
$$;

grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------

-- Supabase's default privileges grant every new table to anon and
-- authenticated. Take that back: anon gets nothing, and authenticated only
-- gets what is granted table by table below (RLS then filters the rows).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','clients','consent_events','coach_applications','coaches','assignments',
    'institutions','debts','month_budget','budget_items','red_lines','attack_plan',
    'monthly_updates','programme','notes','homework','referrals','calls','settlements',
    'feedback','help_requests','settings','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- The owner reads and writes everything.
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using ((select private.is_owner())) with check ((select private.is_owner()))', t);
  end loop;
end $$;

-- profiles --------------------------------------------------------------
grant select, insert on public.profiles to authenticated;
grant update (full_name, whatsapp, updated_at) on public.profiles to authenticated;
create policy profiles_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_self_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()) and not is_owner);
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_coach_reads_client on public.profiles for select to authenticated
  using (private.is_my_client(id));
create policy profiles_client_reads_coach on public.profiles for select to authenticated
  using (private.is_my_coach(id));

-- clients ---------------------------------------------------------------
grant select on public.clients to authenticated;
grant insert (id, need, heard_from, auth_method, stage_start, payday, consent, consent_at, terms_at)
  on public.clients to authenticated;
grant update (payday, consent, consent_at) on public.clients to authenticated;
create policy clients_self on public.clients for select to authenticated
  using (id = (select auth.uid()));
create policy clients_self_insert on public.clients for insert to authenticated
  with check (id = (select auth.uid()));
create policy clients_self_update on public.clients for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy clients_coach on public.clients for select to authenticated
  using (private.is_my_client(id));

-- consent_events --------------------------------------------------------
grant select, insert on public.consent_events to authenticated;
create policy consent_self on public.consent_events for select to authenticated
  using (client_id = (select auth.uid()));
create policy consent_self_insert on public.consent_events for insert to authenticated
  with check (client_id = (select auth.uid()));

-- coach_applications: anyone signed in may apply; only the owner reads -------
grant insert (full_name, email, whatsapp, province, experience, read_book, capacity, why,
              qualifications, agreed_protocol)
  on public.coach_applications to authenticated;
create policy applications_insert on public.coach_applications for insert to authenticated
  with check (applicant_id = (select auth.uid()) and status = 'pending');
-- Owner decides (owner_all policy is the only one that lets these through).
grant select on public.coach_applications to authenticated;
grant update (status, decided_by, decided_at) on public.coach_applications to authenticated;

-- coaches: a coach sees their own row; only the owner changes status/capacity
grant select on public.coaches to authenticated;
-- Only the owner_all policy allows these writes (approve, certify, pause, capacity).
grant insert, update on public.coaches to authenticated;
create policy coaches_self on public.coaches for select to authenticated
  using (id = (select auth.uid()));

-- assignments: written only through public.assign_client() (owner)
grant select on public.assignments to authenticated;
create policy assignments_coach on public.assignments for select to authenticated
  using (coach_id = (select auth.uid()) and (select private.is_certified_coach()));
create policy assignments_client on public.assignments for select to authenticated
  using (client_id = (select auth.uid()));

-- institutions: everyone signed in reads the active list; owner edits --------
grant select, insert, update, delete on public.institutions to authenticated;  -- writes: owner only
create policy institutions_read on public.institutions for select to authenticated
  using (active);

-- settings --------------------------------------------------------------
grant select, insert, update on public.settings to authenticated;  -- writes: owner only
create policy settings_public on public.settings for select to authenticated
  using (public_read);

-- audit_log: owner only (policy above). Rows come from triggers and log_view().
grant select on public.audit_log to authenticated;

-- Client-owned financial tables: the client reads and writes their own rows;
-- a coach may only read, and only with private.coach_can_see().
do $$
declare t text;
begin
  foreach t in array array['month_budget','budget_items','red_lines','attack_plan',
                           'monthly_updates','calls','feedback']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy client_own on public.%I for all to authenticated
         using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()))', t);
    execute format(
      'create policy coach_read on public.%I for select to authenticated
         using (private.coach_can_see(client_id))', t);
  end loop;
end $$;

-- debts: the client can't set other_confirmed (a coach does that via confirm_other_name)
grant select, delete on public.debts to authenticated;
grant insert (client_id, debt_type, institution_id, other_name, family_who, balance, rate,
              minimum, status, sort)
  on public.debts to authenticated;
grant update (debt_type, institution_id, other_name, family_who, balance, rate, minimum,
              status, sort)
  on public.debts to authenticated;
create policy client_own on public.debts for all to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));
create policy coach_read on public.debts for select to authenticated
  using (private.coach_can_see(client_id));

-- settlements: the client can't set closed_at directly (the trigger does)
grant select on public.settlements to authenticated;
grant insert (client_id, debt_id, amount) on public.settlements to authenticated;
grant update (amount, in_writing_at, paid_at, letter_path) on public.settlements to authenticated;
create policy client_own on public.settlements for all to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));
create policy coach_read on public.settlements for select to authenticated
  using (private.coach_can_see(client_id));

-- help_requests: client inserts and reads; coach reads and marks handled ----
grant select, insert on public.help_requests to authenticated;
grant update (handled_at, handled_by) on public.help_requests to authenticated;
create policy client_insert on public.help_requests for insert to authenticated
  with check (client_id = (select auth.uid()) and handled_at is null);
create policy client_read on public.help_requests for select to authenticated
  using (client_id = (select auth.uid()));
create policy coach_read on public.help_requests for select to authenticated
  using (private.coach_can_see(client_id));
create policy coach_handle on public.help_requests for update to authenticated
  using (private.coach_can_see(client_id))
  with check (private.coach_can_see(client_id) and handled_by = (select auth.uid()));

-- programme: client reads; coach reads and changes the week -----------------
grant select, insert on public.programme to authenticated;
grant update (week, updated_by, updated_at) on public.programme to authenticated;
create policy client_read on public.programme for select to authenticated
  using (client_id = (select auth.uid()));
create policy coach_read on public.programme for select to authenticated
  using (private.coach_can_see(client_id));
create policy coach_insert on public.programme for insert to authenticated
  with check (private.coach_can_see(client_id) and updated_by = (select auth.uid()));
create policy coach_update on public.programme for update to authenticated
  using (private.coach_can_see(client_id))
  with check (private.coach_can_see(client_id) and updated_by = (select auth.uid()));

-- notes: coach writes their own; client reads theirs --------------------------
grant select, insert on public.notes to authenticated;
grant update (call_date, next_session, covered, message) on public.notes to authenticated;
create policy client_read on public.notes for select to authenticated
  using (client_id = (select auth.uid()));
create policy coach_read on public.notes for select to authenticated
  using (private.coach_can_see(client_id));
create policy coach_insert on public.notes for insert to authenticated
  with check (private.coach_can_see(client_id) and coach_id = (select auth.uid()));
create policy coach_update on public.notes for update to authenticated
  using (private.coach_can_see(client_id) and coach_id = (select auth.uid()))
  with check (private.coach_can_see(client_id) and coach_id = (select auth.uid()));

-- homework: coach creates; client ticks done ------------------------------
grant select, insert on public.homework to authenticated;
grant update (done, done_at) on public.homework to authenticated;
create policy client_read on public.homework for select to authenticated
  using (client_id = (select auth.uid()));
create policy client_tick on public.homework for update to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));
create policy coach_read on public.homework for select to authenticated
  using (private.coach_can_see(client_id));
create policy coach_insert on public.homework for insert to authenticated
  with check (private.coach_can_see(client_id));

-- referrals: coach only (clients don't see them — question for Chuma) --------
grant select, insert on public.referrals to authenticated;
grant update (followed_up_at) on public.referrals to authenticated;
create policy coach_read on public.referrals for select to authenticated
  using (private.coach_can_see(client_id));
create policy coach_insert on public.referrals for insert to authenticated
  with check (private.coach_can_see(client_id) and coach_id = (select auth.uid()));
create policy coach_update on public.referrals for update to authenticated
  using (private.coach_can_see(client_id)) with check (private.coach_can_see(client_id));

-- ---------------------------------------------------------------------------
-- 7. Rules the database enforces
-- ---------------------------------------------------------------------------

-- Assignment (§6): owner only, certified coach only, never over capacity.
create or replace function public.assign_client(p_client uuid, p_coach uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_status text; v_cap int; v_load int; v_name text; v_id uuid;
begin
  if not private.is_owner() then
    raise exception 'Only the owner can assign clients.' using errcode = '42501';
  end if;

  select k.status, k.capacity, coalesce(p.full_name, p.email)
    into v_status, v_cap, v_name
    from public.coaches k join public.profiles p on p.id = k.id
   where k.id = p_coach
     for update of k;   -- serialise concurrent assignments to the same coach

  if v_status is distinct from 'certified' then
    raise exception 'Only certified coaches can be assigned clients.' using errcode = 'P0001';
  end if;

  select count(*) into v_load from public.assignments
   where coach_id = p_coach and ended_at is null and client_id <> p_client;
  if v_load >= v_cap then
    raise exception '% is full. Pick another coach or raise their capacity.', v_name
      using errcode = 'P0001';
  end if;

  update public.assignments set ended_at = now()
   where client_id = p_client and ended_at is null;

  insert into public.assignments (client_id, coach_id, assigned_by)
  values (p_client, p_coach, auth.uid()) returning id into v_id;

  update public.clients set status = 'active' where id = p_client;
  insert into public.programme (client_id, updated_by) values (p_client, auth.uid())
    on conflict (client_id) do nothing;
  return v_id;
end $$;

-- Coach ticks an "Other" lender name as confirmed against the statement.
create or replace function public.confirm_other_name(p_debt uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_client uuid;
begin
  select client_id into v_client from public.debts where id = p_debt and other_name is not null;
  if v_client is null or not (private.coach_can_see(v_client) or private.is_owner()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.debts set other_confirmed = true, other_confirmed_by = auth.uid()
   where id = p_debt;
end $$;

-- Record that someone viewed a client's data (e.g. opened the brief).
create or replace function public.log_view(p_client uuid, p_what text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (p_client = auth.uid() or private.coach_can_see(p_client) or private.is_owner()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, action, client_id, detail)
  values (auth.uid(), 'view', p_client, jsonb_build_object('what', p_what));
end $$;

-- An applicant may see the status of their own application, nothing else
-- (the table itself stays owner-read-only).
create or replace function public.my_application_status()
returns text language sql stable security definer set search_path = '' as $$
  select status from public.coach_applications
   where applicant_id = auth.uid() order by created_at desc limit 1
$$;

revoke execute on function public.my_application_status() from public, anon;
grant execute on function public.my_application_status() to authenticated;
revoke execute on function public.assign_client(uuid, uuid) from public, anon;
revoke execute on function public.confirm_other_name(uuid) from public, anon;
revoke execute on function public.log_view(uuid, text) from public, anon;
grant execute on function public.assign_client(uuid, uuid) to authenticated;
grant execute on function public.confirm_other_name(uuid) to authenticated;
grant execute on function public.log_view(uuid, text) to authenticated;

-- Settlement (§8): amount below the balance; step 3 closes the account.
create or replace function private.settlement_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_balance numeric; v_client uuid;
begin
  select balance, client_id into v_balance, v_client from public.debts where id = new.debt_id;
  if v_client is distinct from new.client_id then
    raise exception 'That debt is not on this account.' using errcode = 'P0001';
  end if;
  if v_balance is not null and new.amount >= v_balance then
    raise exception 'A settlement must be lower than the balance.' using errcode = 'P0001';
  end if;
  if new.letter_path is not null and new.closed_at is null then
    new.closed_at := now();
    update public.debts set closed_at = now() where id = new.debt_id and closed_at is null;
  end if;
  return new;
end $$;
create trigger settlement_rules before insert or update on public.settlements
  for each row execute function private.settlement_rules();

-- Consent (§4, §11.1): every change is recorded with its time.
create or replace function private.consent_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.consent is distinct from old.consent then
    new.consent_at := now();
  end if;
  return new;
end $$;
create trigger consent_stamp before insert or update of consent on public.clients
  for each row execute function private.consent_stamp();

create or replace function private.consent_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.consent is distinct from old.consent then
    insert into public.consent_events (client_id, consent) values (new.id, new.consent);
  end if;
  return null;
end $$;
create trigger consent_log after insert or update of consent on public.clients
  for each row execute function private.consent_log();

-- Audit (§11.2): every change to client data, with who and when.
create or replace function private.audit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb;
begin
  j := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  insert into public.audit_log (actor_id, action, client_id, table_name, row_id)
  values (auth.uid(), lower(tg_op),
          coalesce(j ->> 'client_id', case when tg_table_name = 'clients' then j ->> 'id' end)::uuid,
          tg_table_name, j ->> 'id');
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clients','debts','month_budget','budget_items','red_lines',
    'attack_plan','monthly_updates','programme','notes','homework','referrals','calls',
    'settlements','feedback','help_requests']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function private.audit_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Default settings (values Chuma must fill are marked)
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, public_read) values
  ('momentum_weights', '{"reduced":40,"closed":20,"updates":25,"no_new_credit":15,"reduced_full_at_pct":50}', false),
  ('crisis_helplines', '{"verified":false,"lines":[],"note":"[VERIFIED SOUTH AFRICAN HELPLINE NUMBERS TO BE PROVIDED BY CHUMA — not a launch blocker, decision 28 Sep 2026]"}', true),
  ('email_client_assigned', '{"status": "draft - Chuma to approve", "subject": "Your MFG coach is {coach_name}", "text": "Hi {first_name},\n\nGood news: you''ve been matched with your MFG coach, {coach_name}. They will contact you on WhatsApp to book your first call.\n\nBefore that call, fill in your Debt Ladder Tracker, so your first session starts from your numbers:\n{login_url}\n\nYour debt is not your character. It is your circumstance.\n\nMlinjana Financial Group\nEducation, not financial advice."}', false),
  ('email_coach_approved', '{"status": "draft - Chuma to approve", "subject": "You''re approved for MFG coach training", "text": "Hi {first_name},\n\nThank you for applying to coach with MFG. You''ve been approved for training.\n\nLog in to see what happens next. The first time, you''ll set up two-step login with an authenticator app on your phone:\n{login_url}\n\nMFG will contact you on WhatsApp about your training.\n\nMlinjana Financial Group"}', false),
  ('email_declined_coach', '{"status": "draft - Chuma to approve", "subject": "Your application to coach with MFG", "text": "Hi {first_name},\n\nThank you for applying to coach with MFG, and for wanting to help people climb out of debt.\n\nWe''re not taking your application further right now. This isn''t a judgement of you or of what you''ve lived through. It''s about where MFG is today.\n\nWe wish you well on your own climb.\n\nMlinjana Financial Group"}', false),
  ('store_signup_answers', 'false', false);
