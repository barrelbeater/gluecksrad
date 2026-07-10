-- StimmRad Level 3
-- Dieses Skript im Supabase Dashboard unter SQL Editor ausführen.

create extension if not exists pgcrypto;

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (code ~ '^[A-Z2-9]{6}$'),
  question text not null
    check (char_length(question) between 1 and 120),
  status text not null default 'open'
    check (status in ('open', 'closed')),
  host_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  winner_option_id uuid,
  spin_version integer not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Ergänzt die Spalte auch bei Projekten, die bereits mit einer älteren
-- Version dieses wiederholbar ausführbaren Skripts eingerichtet wurden.
alter table public.polls
  add column if not exists spin_version integer not null default 0;

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null
    references public.polls(id) on delete cascade,
  label text not null
    check (char_length(label) between 1 and 70),
  color text not null
    check (color ~ '^#[0-9a-fA-F]{6}$'),
  position smallint not null
    check (position between 0 and 7),
  unique (id, poll_id),
  unique (poll_id, position)
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null
    references public.polls(id) on delete cascade,
  option_id uuid not null,
  voter_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (poll_id, voter_id),
  foreign key (option_id, poll_id)
    references public.poll_options(id, poll_id) on delete cascade
);

create index if not exists poll_options_poll_id_idx
  on public.poll_options (poll_id);

create index if not exists votes_poll_id_idx
  on public.votes (poll_id);

create index if not exists polls_host_id_idx
  on public.polls (host_id);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.votes enable row level security;

-- Nur angemeldete (hier: anonyme) Nutzer:innen erhalten Tabellenrechte.
revoke all on public.polls from anon;
revoke all on public.poll_options from anon;
revoke all on public.votes from anon;

grant select, insert, update, delete on public.polls to authenticated;
grant select, insert, update, delete on public.poll_options to authenticated;
grant select, insert on public.votes to authenticated;

drop policy if exists "Authenticated users can find polls" on public.polls;
create policy "Authenticated users can find polls"
  on public.polls for select
  to authenticated
  using (true);

drop policy if exists "Users can create their own polls" on public.polls;
create policy "Users can create their own polls"
  on public.polls for insert
  to authenticated
  with check ((select auth.uid()) is not null and host_id = (select auth.uid()));

drop policy if exists "Hosts can update their polls" on public.polls;
create policy "Hosts can update their polls"
  on public.polls for update
  to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));

drop policy if exists "Hosts can delete their polls" on public.polls;
create policy "Hosts can delete their polls"
  on public.polls for delete
  to authenticated
  using (host_id = (select auth.uid()));

drop policy if exists "Authenticated users can read options" on public.poll_options;
create policy "Authenticated users can read options"
  on public.poll_options for select
  to authenticated
  using (true);

drop policy if exists "Hosts can create options" on public.poll_options;
create policy "Hosts can create options"
  on public.poll_options for insert
  to authenticated
  with check (
    exists (
      select 1 from public.polls
      where polls.id = poll_options.poll_id
        and polls.host_id = (select auth.uid())
        and polls.status = 'open'
    )
  );

drop policy if exists "Hosts can update options" on public.poll_options;
create policy "Hosts can update options"
  on public.poll_options for update
  to authenticated
  using (
    exists (
      select 1 from public.polls
      where polls.id = poll_options.poll_id
        and polls.host_id = (select auth.uid())
        and polls.status = 'open'
    )
  )
  with check (
    exists (
      select 1 from public.polls
      where polls.id = poll_options.poll_id
        and polls.host_id = (select auth.uid())
        and polls.status = 'open'
    )
  );

drop policy if exists "Hosts can delete options" on public.poll_options;
create policy "Hosts can delete options"
  on public.poll_options for delete
  to authenticated
  using (
    exists (
      select 1 from public.polls
      where polls.id = poll_options.poll_id
        and polls.host_id = (select auth.uid())
    )
  );

drop policy if exists "Permitted users can read votes" on public.votes;
create policy "Permitted users can read votes"
  on public.votes for select
  to authenticated
  using (
    voter_id = (select auth.uid())
    or exists (
      select 1 from public.polls
      where polls.id = votes.poll_id
        and (
          polls.host_id = (select auth.uid())
          or polls.status = 'closed'
        )
    )
  );

drop policy if exists "Users can cast one valid vote" on public.votes;
create policy "Users can cast one valid vote"
  on public.votes for insert
  to authenticated
  with check (
    voter_id = (select auth.uid())
    and exists (
      select 1 from public.polls
      where polls.id = votes.poll_id
        and polls.status = 'open'
    )
    and exists (
      select 1 from public.poll_options
      where poll_options.id = votes.option_id
        and poll_options.poll_id = votes.poll_id
    )
  );

-- Verhindert, dass eine Moderation eine fremde Option als Gewinner speichert.
create or replace function public.validate_poll_winner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.winner_option_id is not null and not exists (
    select 1
    from public.poll_options
    where poll_options.id = new.winner_option_id
      and poll_options.poll_id = new.id
  ) then
    raise exception 'winner option does not belong to poll';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_poll_winner_trigger on public.polls;
create trigger validate_poll_winner_trigger
  before insert or update of winner_option_id on public.polls
  for each row execute function public.validate_poll_winner();

-- Realtime für neue Stimmen und Status-/Gewinneränderungen aktivieren.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'polls'
  ) then
    alter publication supabase_realtime add table public.polls;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'votes'
  ) then
    alter publication supabase_realtime add table public.votes;
  end if;
end
$$;
