-- Fremwork AI ledger. Replaces the per-user SQLite files, which were wiped on every
-- Vercel restart. The app calls these tables with the signed-in user's own token, so
-- row level security is what keeps each user's books private.
-- Ids stay text and unique per user: conversation ids are chosen by the client.

create table public.ledger_transactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  memo text not null,
  cat text not null,
  date text not null, -- YYYY-MM-DD
  amt numeric(16, 2) not null,
  status text not null,
  method text not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index ledger_transactions_date_idx on public.ledger_transactions (user_id, date desc);

create table public.ledger_budgets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  k text not null,
  budget numeric(16, 2) not null,
  owner text not null,
  alert text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, k)
);

create table public.ledger_goals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  type text not null,
  name text not null,
  cur numeric(16, 2) not null,
  target numeric(16, 2) not null,
  start numeric(16, 2) not null,
  date text not null,
  down boolean not null default false,
  status text not null,
  ai text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.ledger_projects (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  description text not null,
  chats jsonb not null default '[]',
  docs jsonb not null default '[]',
  reports jsonb not null default '[]',
  updated text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.ledger_tasks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  prompt text not null,
  freq text not null,
  next_run text not null,
  last_run text not null,
  last_failed boolean not null default false,
  is_on boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.ledger_conversations (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  title text not null,
  project_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.ledger_messages (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  conversation_id text not null,
  role text not null,
  kind text,
  mode text,
  status text not null,
  text text,
  file_name text,
  files jsonb not null default '[]',
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, conversation_id) references public.ledger_conversations (user_id, id) on delete cascade
);
create index ledger_messages_conversation_idx on public.ledger_messages (user_id, conversation_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['transactions', 'budgets', 'goals', 'projects', 'tasks', 'conversations', 'messages'] loop
    execute format('alter table public.ledger_%s enable row level security', t);
    execute format('revoke all on public.ledger_%s from anon, public', t);
    execute format('grant select, insert, update, delete on public.ledger_%s to authenticated', t);
    execute format(
      'create policy "own rows" on public.ledger_%s for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

-- AI requests per user per day. No policies and no grants: users can't read or reset
-- it, they can only add to it through bump_ai_usage(). The app enforces the limit.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  requests integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated, public;

create function public.bump_ai_usage()
returns integer language sql security definer set search_path = '' as $$
  insert into public.ai_usage (user_id, day, requests)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set requests = public.ai_usage.requests + 1
  returning requests;
$$;
revoke execute on function public.bump_ai_usage() from public, anon;
grant execute on function public.bump_ai_usage() to authenticated;
