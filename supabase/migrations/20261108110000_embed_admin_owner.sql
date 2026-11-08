-- Embed the admin/owner email in the database: edomiyastesfaye321@gmail.com

-- 1. Ensure the email is recorded in public.team_invites as 'owner'
insert into public.team_invites (email, role, accepted_at)
values ('edomiyastesfaye321@gmail.com', 'owner', now())
on conflict (lower(email)) do update
set role = 'owner';

-- 2. If a profile already exists for this email, elevate it to 'owner'
update public.profiles
set role = 'owner'
where lower(email) = 'edomiyastesfaye321@gmail.com';

-- 3. Update handle_new_user() so the owner email always receives the 'owner' role
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare invited public.app_role;
begin
  if lower(new.email) = 'edomiyastesfaye321@gmail.com' then
    invited := 'owner';
  elsif new.email_confirmed_at is not null then
    select role into invited from public.team_invites
    where lower(email) = lower(new.email) and accepted_at is null;
  else
    select role into invited from public.team_invites
    where lower(email) = lower(new.email);
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), coalesce(invited, 'member'))
  on conflict (id) do update
  set role = case
    when lower(new.email) = 'edomiyastesfaye321@gmail.com' then 'owner'
    when excluded.role in ('owner', 'admin') then excluded.role
    else public.profiles.role
  end;
  return new;
end;
$$;

-- 4. Update handle_user_confirmed()
create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare invited public.app_role;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.waitlist_entries set status = 'active' where lower(email) = lower(new.email);
    if lower(new.email) = 'edomiyastesfaye321@gmail.com' then
      invited := 'owner';
    else
      select role into invited from public.team_invites
      where lower(email) = lower(new.email) and accepted_at is null;
    end if;

    if invited is not null then
      update public.profiles set role = invited where id = new.id;
      update public.team_invites set accepted_at = now() where lower(email) = lower(new.email);
    end if;
  end if;
  return new;
end;
$$;

-- 5. Update private.is_admin() to recognize embedded owner email
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and (
      role in ('owner', 'admin') or lower(email) = 'edomiyastesfaye321@gmail.com'
    )
  );
$$;

revoke execute on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;
