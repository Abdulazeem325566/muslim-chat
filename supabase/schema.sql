-- ============================================================
-- Ummah Chat — Supabase schema
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1) User profiles (one row per auth user)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz default now()
);

-- 2) Chat rooms
create table if not exists rooms (
  id text primary key,
  name text not null,
  description text,
  icon text default '💬',
  sort_order int default 0,
  created_at timestamptz default now()
);

-- 3) Messages
create table if not exists messages (
  id bigint generated always as identity primary key,
  room_id text not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz default now()
);
create index if not exists messages_room_time on messages(room_id, created_at desc);

-- 4) Admins (moderators can delete any message)
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- 5) Reports (users flag bad messages)
create table if not exists reports (
  id bigint generated always as identity primary key,
  message_id bigint references messages(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz default now()
);

-- 6) Row Level Security
alter table profiles enable row level security;
alter table rooms enable row level security;
alter table messages enable row level security;
alter table admins enable row level security;
alter table reports enable row level security;

drop policy if exists "profiles readable by authenticated" on profiles;
create policy "profiles readable by authenticated" on profiles
  for select to authenticated using (true);

drop policy if exists "users manage own profile" on profiles;
create policy "users manage own profile" on profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "rooms readable by authenticated" on rooms;
create policy "rooms readable by authenticated" on rooms
  for select to authenticated using (true);

drop policy if exists "messages readable by authenticated" on messages;
create policy "messages readable by authenticated" on messages
  for select to authenticated using (true);

drop policy if exists "authenticated can send messages" on messages;
create policy "authenticated can send messages" on messages
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "authors and admins can delete messages" on messages;
create policy "authors and admins can delete messages" on messages
  for delete to authenticated
  using (auth.uid() = user_id
         or exists (select 1 from admins where user_id = auth.uid()));

drop policy if exists "admins readable by authenticated" on admins;
create policy "admins readable by authenticated" on admins
  for select to authenticated using (true);

drop policy if exists "authenticated can report" on reports;
create policy "authenticated can report" on reports
  for insert to authenticated with check (true);

drop policy if exists "authenticated can read reports" on reports;
create policy "authenticated can read reports" on reports
  for select to authenticated using (true);

-- 7) Seed rooms
insert into rooms (id, name, description, icon, sort_order) values
  ('lounge',    'Ummah Lounge',    'General discussion for everyone',   '🕌', 1),
  ('quran',     'Quran & Tafseer',  'Quran study and tafseer circles',   '📖', 2),
  ('duas',      'Duas & Dhikr',     'Share duas, dhikr and reminders',   '🤲', 3),
  ('parents',   'Muslim Parents',   'Parenting and kids tarbiyah',       '👨‍👩‍👧', 4),
  ('business',  'Business & Rizq',  'Halal business and freelancing',    '💼', 5),
  ('newmuslims','New Muslims',      'Support for reverts and learners',  '🌙', 6)
on conflict (id) do nothing;

-- 8) Realtime: broadcast new/deleted messages to subscribers
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
