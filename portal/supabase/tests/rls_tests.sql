-- Access-rule tests for PORTAL_SPEC.md §11.1 (plus §6 capacity and §8 settlement order).
-- Run with tests/run-local.sh. Any failed check stops the run with an error.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\o /dev/null

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.check(ok boolean, name text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'ok   %', name;
end $$;

-- Act as a user. aal2 = signed in with two-step login.
create function tests.act(uid uuid, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', uid, 'aal', aal, 'role', 'authenticated')::text, false);
$$;

-- Expect a statement to be refused. Passes if it raises any error.
create function tests.refused(stmt text, name text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok   % (refused: %)', name, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (was allowed)', name;
end $$;
grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------- fixtures
-- Fixed ids so the tests read clearly.
--   O  owner        A  coach, certified, capacity 1     B  coach, certified
--   T  coach in training          C1, C2, C3  clients     X  applicant
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a','owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a1','coach.a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1','coach.b@example.test'),
  ('00000000-0000-0000-0000-0000000000c1','client1@example.test'),
  ('00000000-0000-0000-0000-0000000000c2','client2@example.test'),
  ('00000000-0000-0000-0000-0000000000c3','client3@example.test'),
  ('00000000-0000-0000-0000-0000000000d1','trainee@example.test'),
  ('00000000-0000-0000-0000-0000000000e1','applicant@example.test');

insert into public.profiles (id, email, full_name, is_owner) values
  ('00000000-0000-0000-0000-00000000000a','owner@example.test','Test Owner', true),
  ('00000000-0000-0000-0000-0000000000a1','coach.a@example.test','Coach A', false),
  ('00000000-0000-0000-0000-0000000000b1','coach.b@example.test','Coach B', false),
  ('00000000-0000-0000-0000-0000000000c1','client1@example.test','Client One', false),
  ('00000000-0000-0000-0000-0000000000c2','client2@example.test','Client Two', false),
  ('00000000-0000-0000-0000-0000000000c3','client3@example.test','Client Three', false),
  ('00000000-0000-0000-0000-0000000000d1','trainee@example.test','Trainee T', false),
  ('00000000-0000-0000-0000-0000000000e1','applicant@example.test','Applicant X', false);

insert into public.coaches (id, status, capacity) values
  ('00000000-0000-0000-0000-0000000000a1','certified',1),
  ('00000000-0000-0000-0000-0000000000b1','certified',5),
  ('00000000-0000-0000-0000-0000000000d1','training',5);

insert into public.clients (id, need, heard_from, auth_method, stage_start, consent) values
  ('00000000-0000-0000-0000-0000000000c1','Getting out of debt','MFG website','email',1,true),
  ('00000000-0000-0000-0000-0000000000c2','Staying out of debt','LinkedIn','google',2,true),
  ('00000000-0000-0000-0000-0000000000c3','Building wealth','TikTok','email',3,false);

insert into public.debts (id, client_id, debt_type, other_name, balance, rate, minimum, status) values
  ('00000000-0000-0000-0000-00000000d0c1','00000000-0000-0000-0000-0000000000c1','Other','Ubuntu Lending Co',7500,21,450,'current'),
  ('00000000-0000-0000-0000-00000000d0c2','00000000-0000-0000-0000-0000000000c2','Credit card',null,14800,21,974,'current');

-- ------------------------------------------------------------------- tests
set role authenticated;

-- Anonymous visitors
reset role; set role anon; select set_config('request.jwt.claims','',false);
select tests.refused('select * from public.debts', 'anon cannot read debts');
select tests.refused('select * from public.profiles', 'anon cannot read profiles');
reset role; set role authenticated;

-- Owner assigns (needs two-step login)
select tests.act('00000000-0000-0000-0000-00000000000a','aal1');
select tests.refused($$select public.assign_client('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1')$$,
  'owner without two-step login cannot assign');
select tests.check((select count(*) from public.debts) = 0, 'owner without two-step login sees no debts');

select tests.act('00000000-0000-0000-0000-00000000000a','aal2');
select public.assign_client('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1');
select public.assign_client('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b1');
select tests.check((select count(*) from public.debts where client_id in ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2')) = 2, 'owner with two-step login sees every debt');
select tests.refused($$select public.assign_client('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a1')$$,
  'assignment to a full coach is blocked ("Coach A is full…")');
select tests.refused($$select public.assign_client('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000d1')$$,
  'a coach in training cannot be assigned clients');
select tests.check((select status from public.clients where id='00000000-0000-0000-0000-0000000000c1') = 'active',
  'assigned client leaves the waiting room');

-- Clients: only their own rows
select tests.act('00000000-0000-0000-0000-0000000000c1');
select tests.check((select count(*) from public.debts) = 1, 'client sees only their own debts');
select tests.check((select count(*) from public.profiles) = 2, 'client sees own profile and their coach only');
select tests.check((select count(*) from public.clients) = 1, 'client sees only their own client row');
select tests.refused($$insert into public.debts (client_id, debt_type, balance) values ('00000000-0000-0000-0000-0000000000c2','Credit card',100)$$,
  'client cannot add a debt to someone else');
update public.debts set balance = 1 where client_id = '00000000-0000-0000-0000-0000000000c2';
select tests.refused($$update public.debts set other_confirmed = true$$, 'client cannot confirm their own "Other" name');
select tests.refused($$update public.profiles set is_owner = true$$, 'client cannot make themselves owner');
update public.coaches set status = 'certified';   -- RLS lets no row through
select tests.refused($$select public.assign_client('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1')$$,
  'client cannot assign');
select tests.check((select count(*) from public.audit_log) = 0, 'client cannot read the audit log');

-- Coaches: assigned + consent on + certified + two-step login
select tests.act('00000000-0000-0000-0000-0000000000a1','aal1');
select tests.check((select count(*) from public.debts) = 0, 'coach without two-step login sees no debts');
select tests.act('00000000-0000-0000-0000-0000000000a1','aal2');
select tests.check((select count(*) from public.debts) = 1, 'coach A sees their assigned client''s debts');
select tests.check((select count(*) from public.debts where client_id='00000000-0000-0000-0000-0000000000c2') = 0,
  'coach A cannot see coach B''s client');
update public.debts set balance = 1;
select tests.refused($$select public.assign_client('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a1')$$,
  'coach cannot assign or add clients');
insert into public.notes (client_id, call_date, covered, message)
  values ('00000000-0000-0000-0000-0000000000c1', current_date, 'Rung 1: listed every creditor', 'Good start.');
select tests.refused($$insert into public.notes (client_id, call_date, covered) values ('00000000-0000-0000-0000-0000000000c2', current_date, 'x')$$,
  'coach cannot write notes for another coach''s client');
select public.confirm_other_name('00000000-0000-0000-0000-00000000d0c1');
select tests.check((select count(*) from public.coach_applications) = 0, 'coach cannot read coach applications');

select tests.act('00000000-0000-0000-0000-0000000000b1','aal2');
select tests.refused($$select public.confirm_other_name('00000000-0000-0000-0000-00000000d0c1')$$,
  'coach B cannot confirm names for coach A''s client');

-- Nobody but the client changed balances
reset role;
select tests.check((select balance from public.debts where id='00000000-0000-0000-0000-00000000d0c1') = 7500,
  'coach update of a client debt changed nothing');
select tests.check((select balance from public.debts where id='00000000-0000-0000-0000-00000000d0c2') = 14800,
  'client update of another client''s debt changed nothing');
select tests.check((select status from public.coaches where id='00000000-0000-0000-0000-0000000000d1') = 'training',
  'client cannot change coach status');
select tests.check((select other_confirmed from public.debts where id='00000000-0000-0000-0000-00000000d0c1'),
  'coach A confirmed the "Other" name');
set role authenticated;

-- Consent off: coach access stops immediately
select tests.act('00000000-0000-0000-0000-0000000000c1');
update public.clients set consent = false where id = '00000000-0000-0000-0000-0000000000c1';
select tests.act('00000000-0000-0000-0000-0000000000a1','aal2');
select tests.check((select count(*) from public.debts) = 0, 'consent off: coach sees no debts');
select tests.check((select count(*) from public.notes) = 0, 'consent off: coach no longer sees past notes');
select tests.check((select count(*) from public.clients) = 1, 'consent off: coach still sees the client row (to show "hasn''t shared yet")');
select tests.act('00000000-0000-0000-0000-00000000000a','aal2');
select tests.check((select count(*) from public.notes where client_id='00000000-0000-0000-0000-0000000000c1') = 1, 'consent off: owner still sees historic notes');
select tests.check((select count(*) from public.consent_events where client_id='00000000-0000-0000-0000-0000000000c1') = 2,
  'consent changes are recorded with a timestamp');
select tests.act('00000000-0000-0000-0000-0000000000c1');
update public.clients set consent = true where id = '00000000-0000-0000-0000-0000000000c1';

-- Coach paused (inactive) loses access
reset role; update public.coaches set status='inactive' where id='00000000-0000-0000-0000-0000000000a1'; set role authenticated;
select tests.act('00000000-0000-0000-0000-0000000000a1','aal2');
select tests.check((select count(*) from public.debts) = 0, 'a paused coach sees nothing');
reset role; update public.coaches set status='certified' where id='00000000-0000-0000-0000-0000000000a1'; set role authenticated;

-- Coach applications: anyone signed in applies; only the owner reads
select tests.act('00000000-0000-0000-0000-0000000000e1');
insert into public.coach_applications (full_name, email, whatsapp, province, experience, read_book, capacity, why, agreed_protocol)
values ('Applicant X','applicant@example.test','0720000000','Gauteng','Professional coach or mentor','Part of it',5,
        'I want to help people in my community get out of debt.', true);
select tests.check((select count(*) from public.coach_applications) = 0, 'applicant cannot read applications back');
select tests.check(public.my_application_status() = 'pending', 'applicant can see their own application status');
select tests.act('00000000-0000-0000-0000-0000000000c2');
select tests.check(public.my_application_status() is null, 'others see no application status');
select tests.act('00000000-0000-0000-0000-0000000000e1');
select tests.refused($$insert into public.coach_applications (full_name, email, whatsapp, province, experience, read_book, capacity, why, agreed_protocol)
  values ('Y','y@example.test','0720000000','Gauteng','Professional coach or mentor','Part of it',5,'too short', true)$$,
  '"why" under 20 characters is rejected');
select tests.act('00000000-0000-0000-0000-00000000000a','aal2');
select tests.check((select count(*) from public.coach_applications where applicant_id='00000000-0000-0000-0000-0000000000e1') = 1, 'owner reads applications');

-- Settlement order (§8), enforced in the database
select tests.act('00000000-0000-0000-0000-0000000000c1');
select tests.refused($$insert into public.settlements (client_id, debt_id, amount) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000d0c1',7500)$$,
  'settlement amount must be lower than the balance');
insert into public.settlements (client_id, debt_id, amount)
  values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000d0c1',5200);
select tests.refused($$update public.settlements set paid_at = now() where debt_id='00000000-0000-0000-0000-00000000d0c1'$$,
  'cannot mark paid before "I have the agreement in writing"');
update public.settlements set in_writing_at = now() where debt_id='00000000-0000-0000-0000-00000000d0c1';
select tests.refused($$update public.settlements set letter_path = 'x/letter.pdf' where debt_id='00000000-0000-0000-0000-00000000d0c1'$$,
  'cannot upload the paid-up letter before "I''ve paid"');
update public.settlements set paid_at = now() where debt_id='00000000-0000-0000-0000-00000000d0c1';
update public.settlements set letter_path = '00000000-0000-0000-0000-0000000000c1/letter.pdf' where debt_id='00000000-0000-0000-0000-00000000d0c1';
select tests.check((select closed_at is not null from public.debts where id='00000000-0000-0000-0000-00000000d0c1'),
  'the paid-up letter closes the account');

-- "I'm struggling": client asks, coach sees and marks handled
insert into public.help_requests (client_id) values ('00000000-0000-0000-0000-0000000000c1');
select tests.act('00000000-0000-0000-0000-0000000000b1','aal2');
select tests.check((select count(*) from public.help_requests) = 0, 'another coach does not see the help request');
select tests.act('00000000-0000-0000-0000-0000000000a1','aal2');
select tests.check((select count(*) from public.help_requests where handled_at is null) = 1, 'assigned coach sees the help request');
update public.help_requests set handled_at = now(), handled_by = '00000000-0000-0000-0000-0000000000a1';
select tests.check((select count(*) from public.help_requests where handled_at is null) = 0, 'coach marks it handled');

-- Settings: the helpline row is readable by clients; the rest is owner-only
select tests.act('00000000-0000-0000-0000-0000000000c2');
select tests.check((select count(*) from public.settings) = 1, 'client reads only public settings (helplines)');
update public.settings set value = '{}' where key = 'crisis_helplines';
select tests.act('00000000-0000-0000-0000-00000000000a','aal2');
select tests.check((select value ? 'verified' from public.settings where key = 'crisis_helplines'),
  'client cannot change settings');
select tests.act('00000000-0000-0000-0000-0000000000c2');

-- Audit log records changes and views
select public.log_view('00000000-0000-0000-0000-0000000000c2', 'dashboard');
select tests.act('00000000-0000-0000-0000-00000000000a','aal2');
select tests.check((select count(*) from public.audit_log where action = 'view' and client_id='00000000-0000-0000-0000-0000000000c2') = 1, 'views are logged');
select tests.check((select count(*) from public.audit_log where table_name = 'debts' and client_id='00000000-0000-0000-0000-0000000000c1') >= 1, 'changes are logged');

reset role;
\echo 'All access-rule tests passed.'
