-- Porter.AI owns only travel_* resources. Participants and flexible aspects are JSONB by design.
create table public.travel_trips (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null, description text, lifecycle text not null default 'draft' check (lifecycle in ('draft','upcoming','active','archived')),
  participants jsonb not null default '[]'::jsonb, presentation jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.travel_events (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.travel_trips(id) on delete cascade,
  parent_event_id uuid references public.travel_events(id) on delete cascade, title text not null, description text,
  participants jsonb not null default '[]'::jsonb, temporal jsonb not null default '{}'::jsonb, spatial jsonb not null default '{}'::jsonb,
  booking jsonb not null default '{}'::jsonb, artifacts jsonb not null default '[]'::jsonb, provenance jsonb not null default '[]'::jsonb,
  commitment text not null default 'planned' check (commitment in ('optional','planned','confirmed','completed','cancelled')),
  visual jsonb not null default '{}'::jsonb, movement boolean not null default false, accommodation boolean not null default false, hire boolean not null default false,
  revision integer not null default 1 check (revision > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (parent_event_id is null or parent_event_id <> id)
);
create table public.travel_knowledge (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.travel_trips(id) on delete cascade,
  title text not null, content text not null, related_event_ids jsonb not null default '[]'::jsonb, participant_ids jsonb not null default '[]'::jsonb,
  validity_windows jsonb not null default '[]'::jsonb, locations jsonb not null default '[]'::jsonb, sources jsonb not null default '[]'::jsonb, tags jsonb not null default '[]'::jsonb,
  revision integer not null default 1 check (revision > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index travel_events_trip_parent_idx on public.travel_events(trip_id,parent_event_id);
create index travel_knowledge_trip_idx on public.travel_knowledge(trip_id);
create or replace function public.travel_events_validate_parent_trip() returns trigger language plpgsql as $$
begin
  if new.parent_event_id is not null and not exists (select 1 from public.travel_events parent where parent.id = new.parent_event_id and parent.trip_id = new.trip_id) then
    raise exception 'travel Event parent must belong to the same Trip';
  end if;
  return new;
end;
$$;
create trigger travel_events_parent_trip before insert or update of parent_event_id, trip_id on public.travel_events for each row execute function public.travel_events_validate_parent_trip();
alter table public.travel_trips enable row level security; alter table public.travel_events enable row level security; alter table public.travel_knowledge enable row level security;
create policy travel_trips_owner on public.travel_trips using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy travel_events_owner on public.travel_events using (exists (select 1 from public.travel_trips t where t.id=trip_id and t.owner_id=auth.uid())) with check (exists (select 1 from public.travel_trips t where t.id=trip_id and t.owner_id=auth.uid()));
create policy travel_knowledge_owner on public.travel_knowledge using (exists (select 1 from public.travel_trips t where t.id=trip_id and t.owner_id=auth.uid())) with check (exists (select 1 from public.travel_trips t where t.id=trip_id and t.owner_id=auth.uid()));
