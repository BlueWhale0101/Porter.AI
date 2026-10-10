-- Backfill under a write lock. IDs, source revisions, timestamps, content and tags stay unchanged.
-- Invalid legacy references abort the migration instead of being silently dropped.
begin;
lock table public.travel_trips,public.travel_events,public.travel_knowledge in share row exclusive mode;
update public.travel_knowledge k set owner_id=t.owner_id from public.travel_trips t where t.id=k.trip_id and k.owner_id is null;
do $$ begin
 if exists(select 1 from public.travel_knowledge k cross join lateral jsonb_array_elements_text(k.related_event_ids) r(id)
 left join public.travel_events e on e.id::text=r.id where e.id is null or e.trip_id<>k.trip_id) then raise exception 'Repair invalid legacy Knowledge references before backfill';end if;
end $$;
insert into public.travel_trip_knowledge(trip_id,knowledge_id,participant_ids,validity_windows)
 select trip_id,id,participant_ids,validity_windows from public.travel_knowledge where trip_id is not null on conflict do nothing;
insert into public.travel_event_knowledge(event_id,knowledge_id)
 select distinct r.id::uuid,k.id from public.travel_knowledge k cross join lateral jsonb_array_elements_text(k.related_event_ids) r(id) on conflict do nothing;
commit;
