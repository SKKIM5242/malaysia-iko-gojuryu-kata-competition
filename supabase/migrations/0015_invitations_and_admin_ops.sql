-- Invitation codes (unlimited/free sign-in for referees & staff), and admin
-- operations for approving accounts and assigning referees to videos.

create table if not exists invitation_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  role text not null check (role in ('referee','staff','any')),
  note text,
  max_uses int,
  use_count int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table invitation_codes enable row level security;
drop policy if exists "invitation_codes_admin_all" on invitation_codes;
create policy "invitation_codes_admin_all" on invitation_codes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Validate + redeem the invitation code at signup time so approval is
-- instant (no manual admin step) for anyone with a valid code.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'participant');
  v_code text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  v_approved boolean := false;
  v_code_row invitation_codes%rowtype;
begin
  if v_role not in ('participant','referee','staff') then
    v_role := 'participant';
  end if;
  if v_code is not null and v_role in ('referee','staff') then
    select * into v_code_row from invitation_codes
      where code = v_code and active
        and (max_uses is null or use_count < max_uses)
        and (role = v_role or role = 'any')
      limit 1;
    if v_code_row.id is not null then
      v_approved := true;
      update invitation_codes set use_count = use_count + 1 where id = v_code_row.id;
    end if;
  end if;
  insert into profiles (user_id, role, full_name, country, email, approved)
  values (
    new.id, v_role,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    v_approved
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Admin: assign / unassign a referee to score a specific video.
create or replace function public.assign_referee(p_video uuid, p_referee uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  insert into referee_assignments (video_id, referee_user_id)
  values (p_video, p_referee)
  on conflict (video_id, referee_user_id) do nothing;
  return true;
end;
$$;

create or replace function public.unassign_referee(p_video uuid, p_referee uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  delete from referee_assignments where video_id = p_video and referee_user_id = p_referee;
  return true;
end;
$$;

grant execute on function public.assign_referee(uuid, uuid) to authenticated;
grant execute on function public.unassign_referee(uuid, uuid) to authenticated;

-- Starter invitation codes so the organiser can test immediately.
insert into invitation_codes (code, role, note, max_uses) values
  ('IKO-STAFF-2026', 'staff', 'Admin / Organizer / Customer Support — unlimited sign-in, no payment', null),
  ('IKO-JUDGE-2026', 'referee', 'Referee / Judge — free entry (waives the USD 100 deposit)', null)
on conflict (code) do nothing;
