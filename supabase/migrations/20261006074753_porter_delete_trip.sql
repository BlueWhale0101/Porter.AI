-- App management only. No MCP tool; invoker RLS and auth.uid() are mandatory.
-- Close the parent-move loophole as well as validating new child references:
-- a cross-Trip child must never be reachable by an Event cascade.
alter table public.travel_events add constraint travel_events_id_trip_unique unique(id,trip_id);
alter table public.travel_events drop constraint travel_events_parent_event_id_fkey;
alter table public.travel_events add constraint travel_events_parent_same_trip
  foreign key(parent_event_id,trip_id) references public.travel_events(id,trip_id) on delete cascade;
create function public.porter_app_delete_trip(p_trip_id uuid, p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  t public.travel_trips%rowtype;
  actual jsonb;
  refs jsonb;
begin
  select * into t from public.travel_trips
    where id=p_trip_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Trip unavailable' using errcode='P0404'; end if;
  -- The parent FOR UPDATE lock also excludes FK inserts until commit. Lock
  -- existing children against concurrent edits before comparing their revisions.
  perform id from public.travel_events where trip_id=p_trip_id order by id for update;
  perform id from public.travel_knowledge where trip_id=p_trip_id order by id for update;
  select jsonb_build_object('trip',t.revision,
    'events',coalesce((select jsonb_object_agg(id::text,revision) from public.travel_events where trip_id=p_trip_id),'{}'::jsonb),
    'knowledge',coalesce((select jsonb_object_agg(id::text,revision) from public.travel_knowledge where trip_id=p_trip_id),'{}'::jsonb)) into actual;
  if p_expected is null or actual is distinct from p_expected then
    raise exception 'Trip changed; review before deleting' using errcode='P0409';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('eventId',e.id,'artifact',a.value)),'[]'::jsonb)
    into refs from public.travel_events e cross join lateral jsonb_array_elements(e.artifacts) a
    where e.trip_id=p_trip_id;
  -- Existing cascades remove all Events (including children) and Knowledge.
  -- Participants, relationship IDs, booking and artifact metadata are embedded.
  delete from public.travel_trips where id=p_trip_id and owner_id=auth.uid();
  return jsonb_build_object('artifacts',refs);
end;
$$;
revoke all on function public.porter_app_delete_trip(uuid,jsonb) from public, anon, service_role;
grant execute on function public.porter_app_delete_trip(uuid,jsonb) to authenticated;
