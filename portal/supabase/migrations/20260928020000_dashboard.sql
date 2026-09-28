-- Phase 3 · Client dashboard (§8)

-- 1. When a monthly figure last changed: drives the payday check-in and "went quiet" later.
alter table public.monthly_updates add column updated_at timestamptz not null default now();

create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger monthly_updates_touch before update on public.monthly_updates
  for each row execute function private.touch_updated_at();

-- 2. Payday reminder emails: remember the payday already reminded, so a repeated
--    daily run never sends twice. Written only by the server (no grant to users).
alter table public.clients add column payday_reminded_for date;

-- 3. Draft wording for the payday email (Chuma to approve). No figures in emails (§11.2).
insert into public.settings (key, value, public_read) values
  ('email_payday_reminder',
   '{"status":"draft - Chuma to approve","subject":"It''s payday: time to update your numbers","text":"Hi {first_name},\n\nIt''s past your payday on the {payday}. Update your numbers so {coach_name} sees where you are:\n{login_url}\n\nIt takes a few minutes. Every month, the number is smaller.\n\nMlinjana Financial Group\nEducation, not financial advice."}',
   false)
on conflict (key) do nothing;
