-- Admin/Organizer-controlled sign-in quota: how many times someone may
-- sign in, tied to a competition tier and a valid date range, plus a
-- request-a-new-subscription flow for when it runs out. Participants keep
-- unlimited sign-in by default (sign_in_limit stays null for them unless
-- an admin deliberately sets one) -- this is generic infrastructure on
-- profiles, applied by admin choice per registrant, not a blanket cap.
alter table profiles add column if not exists sign_in_limit int;
alter table profiles add column if not exists sign_in_count int not null default 0;
alter table profiles add column if not exists sign_in_competition_id uuid references competitions(id);
alter table profiles add column if not exists sign_in_valid_from date;
alter table profiles add column if not exists sign_in_valid_until date;

-- audiences has never had a real link to its login account, same gap
-- referees had (fixed in 0040) -- needed so the admin Sign-in Control box
-- on /admin/audience can find the right profiles row to edit.
alter table audiences add column if not exists user_id uuid references auth.users(id);
update audiences a
set user_id = p.user_id
from profiles p
where a.user_id is null
  and p.role = 'audience'
  and lower(p.email) = lower(a.email);

-- handle_new_user: also auto-link a new audience signup to its still-
-- unlinked directory row by email, same as referees.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'participant');
  v_code text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  v_approved boolean := false;
  v_terms_accepted boolean := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false);
  v_code_row invitation_codes%rowtype;
  v_school_id uuid;
  v_sensei_id uuid;
begin
  if v_role not in ('participant','referee','staff','organizer','customer_support','audience','school','sensei') then
    v_role := 'participant';
  end if;
  if v_code is not null and v_role in ('referee','staff','audience','school','sensei') then
    select * into v_code_row from invitation_codes
      where code = v_code and active
        and (max_uses is null or use_count < max_uses)
        and (role = v_role or role = 'any')
        and (email is null or lower(email) = lower(new.email))
      limit 1;
    if v_code_row.id is not null then
      v_approved := true;
      update invitation_codes set use_count = use_count + 1 where id = v_code_row.id;
      if v_role = 'school' then v_school_id := v_code_row.for_record_id; end if;
      if v_role = 'sensei' then v_sensei_id := v_code_row.for_record_id; end if;
    end if;
  end if;
  insert into profiles (user_id, role, full_name, country, email, approved, terms_accepted_at, school_id, sensei_id)
  values (
    new.id, v_role,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    v_approved,
    case when v_terms_accepted then now() else null end,
    v_school_id, v_sensei_id
  )
  on conflict (user_id) do nothing;
  if v_role = 'referee' then
    update referees set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  if v_role = 'audience' then
    update audiences set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

-- Increments the counter right after a successful client-side
-- signInWithPassword() (see components/AuthForms.tsx) -- Supabase Auth has
-- no server-side "on sign in" hook, so this has to be called explicitly.
-- Deliberately does NOT block here: by the time this runs the client
-- already holds a valid session, so the real access gate has to live on
-- the protected pages themselves (/account, /kata-arena) via
-- lib/sign-in-quota.ts's isWithinSignInQuota() — otherwise someone whose
-- quota is exhausted could just navigate straight to a protected page and
-- skip the sign-in-time check entirely.
create or replace function public.record_sign_in()
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set sign_in_count = sign_in_count + 1 where user_id = auth.uid();
end;
$$;
grant execute on function public.record_sign_in() to authenticated;

-- A user's own "please renew me" request -- the organiser fulfils it by
-- editing that same person's Sign-in Control fields directly (sign_in_limit
-- / sign_in_competition_id / sign_in_valid_from / sign_in_valid_until) on
-- their respective admin page, then marks this request 'paid'.
create table if not exists subscription_renewals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table subscription_renewals enable row level security;

drop policy if exists "subscription_renewals_select" on subscription_renewals;
create policy "subscription_renewals_select" on subscription_renewals
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "subscription_renewals_insert" on subscription_renewals;
create policy "subscription_renewals_insert" on subscription_renewals
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "subscription_renewals_admin_update" on subscription_renewals;
create policy "subscription_renewals_admin_update" on subscription_renewals
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
