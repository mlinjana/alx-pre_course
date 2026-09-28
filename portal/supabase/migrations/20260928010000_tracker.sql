-- Phase 2 · Debt Ladder Tracker
-- 1. The app creates debts with its own ids (so it can autosave a new debt before
--    the first round trip finishes). Ids are random UUIDs; a clash just fails.
grant insert (id) on public.debts to authenticated;

-- 2. Child rows must belong to the same client as their parent. RLS checks each
--    row's own client_id; these keys stop a row pointing at someone else's parent.
--    They replace the single-column keys (two links between the same tables would
--    make the API's embedded selects ambiguous).
alter table public.budget_items drop constraint budget_items_budget_id_fkey;
alter table public.homework drop constraint homework_note_id_fkey;
alter table public.calls drop constraint calls_debt_id_fkey;
alter table public.month_budget add constraint month_budget_id_client unique (id, client_id);
alter table public.budget_items
  add constraint budget_items_same_client
  foreign key (budget_id, client_id) references public.month_budget (id, client_id) on delete cascade;

alter table public.notes add constraint notes_id_client unique (id, client_id);
alter table public.homework
  add constraint homework_same_client
  foreign key (note_id, client_id) references public.notes (id, client_id) on delete cascade;

alter table public.debts add constraint debts_id_client unique (id, client_id);
alter table public.calls
  add constraint calls_same_client
  foreign key (debt_id, client_id) references public.debts (id, client_id) on delete set null (debt_id);

-- 3. A debt names its lender in exactly one way.
alter table public.debts add constraint debts_one_name check (
  (institution_id is not null)::int + (other_name is not null)::int + (family_who is not null)::int <= 1
);

-- 4. An institution picked for a debt must be one listed for that debt's type.
create or replace function private.debt_institution_matches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.institution_id is not null and not exists (
    select 1 from public.institutions i where i.id = new.institution_id and i.debt_type = new.debt_type
  ) then
    raise exception 'That institution isn''t listed for this type of debt.' using errcode = 'P0001';
  end if;
  -- A changed "Other" name must be confirmed again by the coach.
  if tg_op = 'UPDATE' and new.other_name is distinct from old.other_name then
    new.other_confirmed := false;
    new.other_confirmed_by := null;
  end if;
  return new;
end $$;
create trigger debt_institution_matches before insert or update on public.debts
  for each row execute function private.debt_institution_matches();

-- 5. One budget item list per month is plenty; keep them in a stable order.
create index budget_items_budget on public.budget_items (budget_id, grp, sort);
create index monthly_updates_client_month on public.monthly_updates (client_id, month);
