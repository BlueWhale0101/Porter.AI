-- Expand first; existing application calls remain valid. No ownership switch yet.
begin;
alter table public.travel_trips add column end_date date,
 add column knowledge_preload_tag text check(knowledge_preload_tag is null or (length(btrim(knowledge_preload_tag)) between 1 and 200));
alter table public.travel_trips add constraint travel_trips_end_date_range check(end_date is null or end_date between date '0001-01-01' and date '9999-12-31');
alter table public.travel_knowledge add column owner_id uuid references auth.users(id) on delete cascade,
 add column planning jsonb not null default '{}'::jsonb;
create table public.travel_trip_knowledge (
 trip_id uuid not null references public.travel_trips(id) on delete cascade,
 knowledge_id uuid not null references public.travel_knowledge(id) on delete cascade,
 participant_ids jsonb not null default '[]', validity_windows jsonb not null default '[]',
 primary key(trip_id,knowledge_id)
);
create table public.travel_event_knowledge (
 event_id uuid not null references public.travel_events(id) on delete cascade,
 knowledge_id uuid not null references public.travel_knowledge(id) on delete cascade,
 primary key(event_id,knowledge_id)
);
create index travel_trip_knowledge_reverse on public.travel_trip_knowledge(knowledge_id,trip_id);
create index travel_event_knowledge_reverse on public.travel_event_knowledge(knowledge_id,event_id);
create index travel_knowledge_owner_idx on public.travel_knowledge(owner_id,id);
alter table public.travel_trip_knowledge enable row level security;
alter table public.travel_event_knowledge enable row level security;
create policy travel_trip_knowledge_owner on public.travel_trip_knowledge to authenticated
 using(exists(select 1 from public.travel_trips t join public.travel_knowledge k on k.id=knowledge_id where t.id=trip_id and t.owner_id=auth.uid() and coalesce(k.owner_id,t.owner_id)=t.owner_id))
 with check(exists(select 1 from public.travel_trips t join public.travel_knowledge k on k.id=knowledge_id where t.id=trip_id and t.owner_id=auth.uid() and coalesce(k.owner_id,t.owner_id)=t.owner_id));
create policy travel_event_knowledge_owner on public.travel_event_knowledge for select to authenticated
 using(exists(select 1 from public.travel_events e join public.travel_trips t on t.id=e.trip_id join public.travel_knowledge k on k.id=knowledge_id where e.id=event_id and t.owner_id=auth.uid() and k.owner_id=t.owner_id));
grant select,insert,update,delete on public.travel_trip_knowledge to authenticated,service_role;
grant select on public.travel_event_knowledge to authenticated,service_role;
-- Fill ownership for legacy writers between expand and backfill. Validate immutable ownership.
create function public.porter_knowledge_owner() returns trigger language plpgsql security invoker set search_path='' as $$
declare trip_owner uuid;
begin
 if tg_op='UPDATE' and old.owner_id is not null and new.owner_id is distinct from old.owner_id then raise exception 'Knowledge owner is immutable';end if;
 if new.trip_id is not null then
  select owner_id into trip_owner from public.travel_trips where id=new.trip_id;
  if trip_owner is null then raise exception 'Knowledge Trip unavailable';end if;
  new.owner_id:=coalesce(new.owner_id,trip_owner);
  if new.owner_id<>trip_owner then raise exception 'Knowledge context must have the same owner';end if;
 end if;
 if new.owner_id is null then raise exception 'Knowledge owner is required';end if;
 return new;
end;$$;
create trigger porter_knowledge_owner before insert or update on public.travel_knowledge for each row execute function public.porter_knowledge_owner();
commit;
