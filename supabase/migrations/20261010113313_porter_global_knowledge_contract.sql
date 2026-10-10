-- Contract ownership, NOT legacy columns. Compatibility fields remain until old clients/queues retire.
begin;
lock table public.travel_trips,public.travel_events,public.travel_knowledge in share row exclusive mode;
-- Repeat the bounded backfill: legacy writers may have run between migration stages.
update public.travel_knowledge k set owner_id=t.owner_id from public.travel_trips t where t.id=k.trip_id and k.owner_id is null;
do $$ begin
 if exists(select 1 from public.travel_knowledge k cross join lateral jsonb_array_elements_text(k.related_event_ids) r(id)
 left join public.travel_events e on e.id::text=r.id where e.id is null or e.trip_id<>k.trip_id) then raise exception 'Repair invalid legacy Knowledge references before contract';end if;
end $$;
insert into public.travel_trip_knowledge(trip_id,knowledge_id,participant_ids,validity_windows)
 select trip_id,id,participant_ids,validity_windows from public.travel_knowledge where trip_id is not null on conflict(trip_id,knowledge_id) do update set participant_ids=excluded.participant_ids,validity_windows=excluded.validity_windows;
-- Reconcile removals too: old writers may have changed reference arrays after backfill.
delete from public.travel_event_knowledge l using public.travel_knowledge k,public.travel_events e
 where l.knowledge_id=k.id and l.event_id=e.id and e.trip_id=k.trip_id and not(k.related_event_ids ? e.id::text);
insert into public.travel_event_knowledge(event_id,knowledge_id)
 select distinct r.id::uuid,k.id from public.travel_knowledge k cross join lateral jsonb_array_elements_text(k.related_event_ids) r(id) on conflict do nothing;
alter table public.travel_knowledge alter column owner_id set not null;
alter table public.travel_knowledge alter column trip_id drop not null;
alter table public.travel_knowledge drop constraint travel_knowledge_trip_id_fkey;
alter table public.travel_knowledge add constraint travel_knowledge_context_trip_fkey foreign key(trip_id) references public.travel_trips(id) on delete set null;
alter table public.travel_knowledge alter column content set default '';
alter table public.travel_knowledge add constraint travel_knowledge_title check(length(btrim(title))>0) not valid;
alter table public.travel_knowledge validate constraint travel_knowledge_title;
drop policy travel_knowledge_owner on public.travel_knowledge;
create policy travel_knowledge_owner on public.travel_knowledge to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
grant select,insert,update,delete on public.travel_knowledge to authenticated,service_role;
-- Shared case-insensitive matching contract; tags retain their original display spelling.
create function public.porter_knowledge_has_tag(p_tags jsonb,p_tag text) returns boolean
language sql immutable strict security invoker set search_path='' as $$
 select exists(select 1 from jsonb_array_elements_text(p_tags) tag where lower(normalize(btrim(tag),NFKC))=lower(normalize(btrim(p_tag),NFKC)))
$$;
revoke all on function public.porter_knowledge_has_tag(jsonb,text) from public,anon;
grant execute on function public.porter_knowledge_has_tag(jsonb,text) to authenticated,service_role;
-- All join writes go through guarded functions/triggers; direct Data API writes cannot bypass Event CAS.
revoke insert,update,delete on public.travel_event_knowledge from public,anon,authenticated,service_role;
create schema if not exists porter_private;
revoke all on schema porter_private from public,anon;
grant usage on schema porter_private to authenticated,service_role;

create function public.porter_validate_knowledge_planning() returns trigger language plpgsql security invoker set search_path='' as $$
declare key text; amount numeric;
begin
 if jsonb_typeof(new.planning)<>'object' then raise exception 'Knowledge planning must be an object';end if;
 for key in select jsonb_object_keys(new.planning) loop
  if key not in ('cost','bookingRequired','timedAvailability','primaryUrl') then raise exception 'Unknown Knowledge planning field';end if;
 end loop;
 foreach key in array array['bookingRequired','timedAvailability'] loop
  if new.planning ? key and new.planning->key<>'null'::jsonb and (jsonb_typeof(new.planning->key)<>'string' or new.planning->>key not in ('yes','no','unknown')) then raise exception 'Invalid Knowledge tri-state';end if;
 end loop;
 if new.planning ? 'cost' and new.planning->'cost'<>'null'::jsonb then
  if jsonb_typeof(new.planning->'cost')<>'object' or jsonb_typeof(new.planning->'cost'->'amount') is distinct from 'number'
   or jsonb_typeof(new.planning->'cost'->'currency') is distinct from 'string'
   or new.planning->'cost'->>'currency' !~ '^[A-Z]{3}$'
   or exists(select 1 from jsonb_object_keys(new.planning->'cost') k where k not in ('amount','currency')) then raise exception 'Invalid Knowledge cost';end if;
  amount:=(new.planning->'cost'->>'amount')::numeric;if amount<0 then raise exception 'Cost must be non-negative';end if;
 end if;
 if new.planning ? 'primaryUrl' and new.planning->'primaryUrl'<>'null'::jsonb and
  (jsonb_typeof(new.planning->'primaryUrl')<>'string' or length(new.planning->>'primaryUrl')>8192 or new.planning->>'primaryUrl' !~ '^https?://[^/@[:space:]]+([/?#]|$)') then raise exception 'Invalid Knowledge URL';end if;
 if jsonb_typeof(new.tags)<>'array' or exists(select 1 from jsonb_array_elements(new.tags) t where jsonb_typeof(t)<>'string' or length(btrim(t#>>'{}')) not between 1 and 200) then raise exception 'Invalid Knowledge tags';end if;
 return new;
end;$$;
create trigger porter_validate_knowledge_planning before insert or update on public.travel_knowledge for each row execute function public.porter_validate_knowledge_planning();

-- No subclass/tag kind. Same-owner context integrity also applies to privileged MCP writes.
create function public.porter_context_owner_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.travel_trips t join public.travel_knowledge k on k.id=new.knowledge_id where t.id=new.trip_id and t.owner_id=k.owner_id) then raise exception 'Knowledge context owner mismatch';end if;
 if jsonb_typeof(new.participant_ids)<>'array' or jsonb_typeof(new.validity_windows)<>'array' then raise exception 'Invalid Knowledge context';end if;
 return new;
end;$$;
create trigger porter_context_owner_guard before insert or update on public.travel_trip_knowledge for each row execute function public.porter_context_owner_guard();

-- Private SECURITY DEFINER functions are narrowly necessary to write the join while
-- withholding direct join DML. Empty search paths, explicit authorization, fixed tables,
-- no dynamic SQL; no public/anon EXECUTE. Browser still uses its normal user JWT.
create function porter_private.write_event(p_event jsonb,p_knowledge_ids jsonb,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.travel_events%rowtype; previous public.travel_events%rowtype; owner uuid; k uuid;
begin
 target:=jsonb_populate_record(null::public.travel_events,p_event-'knowledge_ids');
 select owner_id into owner from public.travel_trips where id=target.trip_id for update;
 if owner is null or (current_setting('role')<>'service_role' and owner is distinct from auth.uid()) then raise exception 'Event unavailable' using errcode='P0404';end if;
 if jsonb_typeof(p_knowledge_ids)<>'array' then raise exception 'Knowledge references must be an array';end if;
 -- Lock Knowledge in stable order; deletion cannot race with ownership validation/link insertion.
 for k in select distinct value::uuid from jsonb_array_elements_text(p_knowledge_ids) order by 1 loop
  perform id from public.travel_knowledge where id=k and owner_id=owner for key share;
  if not found then raise exception 'Knowledge unavailable' using errcode='P0404';end if;
 end loop;
 if p_expected is null then
  if target.revision<>1 then raise exception 'New Event revision must be one';end if;
  insert into public.travel_events select target.*;
 else
  select * into previous from public.travel_events where id=target.id and trip_id=target.trip_id for update;
  if not found then raise exception 'Event unavailable' using errcode='P0404';end if;
  if previous.revision<>p_expected or target.revision<>p_expected+1 then raise exception 'Event revision changed' using errcode='P0409';end if;
  if target.created_at is distinct from previous.created_at then raise exception 'Event creation time is immutable';end if;
  update public.travel_events set parent_event_id=target.parent_event_id,title=target.title,description=target.description,
   participants=target.participants,temporal=target.temporal,spatial=target.spatial,booking=target.booking,artifacts=target.artifacts,
   provenance=target.provenance,commitment=target.commitment,visual=target.visual,movement=target.movement,accommodation=target.accommodation,hire=target.hire,
   revision=target.revision,updated_at=target.updated_at where id=target.id;
 end if;
 delete from public.travel_event_knowledge where event_id=target.id and not (p_knowledge_ids ? knowledge_id::text);
 insert into public.travel_event_knowledge(event_id,knowledge_id) select target.id,value::uuid from jsonb_array_elements_text(p_knowledge_ids) on conflict do nothing;
 return to_jsonb(target);
end;$$;
revoke all on function porter_private.write_event(jsonb,jsonb,integer) from public,anon;
grant execute on function porter_private.write_event(jsonb,jsonb,integer) to authenticated,service_role;
create function public.porter_write_event(p_event jsonb,p_knowledge_ids jsonb,p_expected integer default null)
returns jsonb language sql security invoker set search_path='' as $$select porter_private.write_event(p_event,p_knowledge_ids,p_expected)$$;
revoke all on function public.porter_write_event(jsonb,jsonb,integer) from public,anon;
grant execute on function public.porter_write_event(jsonb,jsonb,integer) to authenticated,service_role;

-- Reverse legacy field is a derived mirror, never a second reference authority.
create function porter_private.mirror_knowledge_links() returns trigger language plpgsql security definer set search_path='' as $$
declare affected_id uuid;
begin
 affected_id:=case when tg_op='DELETE' then old.knowledge_id else new.knowledge_id end;
 update public.travel_knowledge set related_event_ids=coalesce((select jsonb_agg(event_id::text order by event_id) from public.travel_event_knowledge where knowledge_id=affected_id),'[]') where travel_knowledge.id=affected_id;
 return null;
end;$$;
revoke all on function porter_private.mirror_knowledge_links() from public,anon,authenticated,service_role;
create trigger porter_mirror_knowledge_links after insert or delete on public.travel_event_knowledge for each row execute function porter_private.mirror_knowledge_links();

-- Adapter for deployed create/update_knowledge calls and old durable queues.
-- Legacy writes may affect only Events in the original context Trip, and bump
-- their Event revisions. All changes roll back with the Knowledge CAS update.
create function porter_private.legacy_knowledge_context() returns trigger language plpgsql security definer set search_path='' as $$
declare changed_event record; desired jsonb;
begin
 if pg_trigger_depth()>1 then return null;end if;
 if new.trip_id is not null then
  insert into public.travel_trip_knowledge(trip_id,knowledge_id,participant_ids,validity_windows)
   values(new.trip_id,new.id,new.participant_ids,new.validity_windows)
   on conflict(trip_id,knowledge_id) do update set participant_ids=excluded.participant_ids,validity_windows=excluded.validity_windows;
 end if;
 if tg_op='UPDATE' and new.related_event_ids is not distinct from old.related_event_ids then return null;end if;
 desired:=new.related_event_ids;
 if jsonb_typeof(desired)<>'array' then raise exception 'Invalid legacy Event references';end if;
 if exists(select 1 from jsonb_array_elements_text(desired) r(id) left join public.travel_events e on e.id::text=r.id join public.travel_trips t on t.id=e.trip_id where t.owner_id<>new.owner_id)
  or exists(select 1 from jsonb_array_elements_text(desired) r(id) left join public.travel_events e on e.id::text=r.id where e.id is null) then raise exception 'Knowledge Event unavailable';end if;
 -- Existing links outside the original context are read-only to this compatibility path.
 if exists(select 1 from jsonb_array_elements_text(desired) r(id) join public.travel_events e on e.id::text=r.id where e.trip_id is distinct from new.trip_id and not exists(select 1 from public.travel_event_knowledge l where l.event_id=e.id and l.knowledge_id=new.id)) then raise exception 'Edit global references on Events';end if;
 for changed_event in select ev.id from public.travel_events ev where ev.trip_id=new.trip_id and
  ((desired ? ev.id::text) is distinct from exists(select 1 from public.travel_event_knowledge l where l.event_id=ev.id and l.knowledge_id=new.id)) order by ev.id for update loop
  update public.travel_events set revision=revision+1,updated_at=now() where id=changed_event.id;
  if desired ? changed_event.id::text then insert into public.travel_event_knowledge values(changed_event.id,new.id) on conflict do nothing;
  else delete from public.travel_event_knowledge where event_id=changed_event.id and knowledge_id=new.id;end if;
 end loop;
 -- Normalize the mirror even when references were merely reordered.
 update public.travel_knowledge set related_event_ids=coalesce((select jsonb_agg(event_id::text order by event_id) from public.travel_event_knowledge where knowledge_id=new.id),'[]') where id=new.id;
 return null;
end;$$;
revoke all on function porter_private.legacy_knowledge_context() from public,anon,authenticated,service_role;
create trigger porter_legacy_knowledge_context after insert or update of related_event_ids,participant_ids,validity_windows on public.travel_knowledge for each row execute function porter_private.legacy_knowledge_context();

-- Global deletion does not recreate anything; remaining Event links change revisions.
create function porter_private.knowledge_delete_links() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform e.id from public.travel_events e join public.travel_event_knowledge l on l.event_id=e.id where l.knowledge_id=old.id order by e.id for update of e;
 update public.travel_events set revision=revision+1,updated_at=now() where id in(select event_id from public.travel_event_knowledge where knowledge_id=old.id);
 return old;
end;$$;
revoke all on function porter_private.knowledge_delete_links() from public,anon,authenticated,service_role;
create trigger porter_knowledge_delete_links before delete on public.travel_knowledge for each row execute function porter_private.knowledge_delete_links();
create or replace function public.porter_app_delete_trip(p_trip_id uuid, p_expected jsonb)
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
  perform k.id from public.travel_knowledge k where k.id in(select knowledge_id from public.travel_trip_knowledge where trip_id=p_trip_id union select l.knowledge_id from public.travel_event_knowledge l join public.travel_events e on e.id=l.event_id where e.trip_id=p_trip_id) order by k.id for update;
  select jsonb_build_object('trip',t.revision,
    'events',coalesce((select jsonb_object_agg(id::text,revision) from public.travel_events where trip_id=p_trip_id),'{}'::jsonb),
    'knowledge',coalesce((select jsonb_object_agg(id::text,revision) from public.travel_knowledge where id in(select knowledge_id from public.travel_trip_knowledge where trip_id=p_trip_id union select l.knowledge_id from public.travel_event_knowledge l join public.travel_events e on e.id=l.event_id where e.trip_id=p_trip_id)),'{}'::jsonb)) into actual;
  if p_expected is null or actual is distinct from p_expected then
    raise exception 'Trip changed; review before deleting' using errcode='P0409';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('eventId',e.id,'artifact',a.value)),'[]'::jsonb)
    into refs from public.travel_events e cross join lateral jsonb_array_elements(e.artifacts) a
    where e.trip_id=p_trip_id;
  -- Cascades remove Events/context/links; global Knowledge survives.
  -- Participants, relationship IDs, booking and artifact metadata are embedded.
  delete from public.travel_trips where id=p_trip_id and owner_id=auth.uid();
  return jsonb_build_object('artifacts',refs);
end;
$$;
revoke all on function public.porter_app_delete_trip(uuid,jsonb) from public, anon, service_role;
grant execute on function public.porter_app_delete_trip(uuid,jsonb) to authenticated;

-- Individual Event/subtree deletion uses the same aggregate revision check.
create or replace function public.porter_app_delete_event(p_trip_id uuid,p_event_id uuid,p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t public.travel_trips%rowtype; actual jsonb; refs jsonb; ids text[];
begin
 select * into t from public.travel_trips where id=p_trip_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Event unavailable' using errcode='P0404'; end if;
 perform id from public.travel_events where trip_id=p_trip_id order by id for update;
 perform k.id from public.travel_knowledge k where k.id in(select knowledge_id from public.travel_trip_knowledge where trip_id=p_trip_id union select l.knowledge_id from public.travel_event_knowledge l join public.travel_events e on e.id=l.event_id where e.trip_id=p_trip_id) order by k.id for update;
 if not exists(select 1 from public.travel_events where id=p_event_id and trip_id=p_trip_id) then raise exception 'Event unavailable' using errcode='P0404';end if;
 select jsonb_build_object('trip',t.revision,
 'events',coalesce((select jsonb_object_agg(id::text,revision) from public.travel_events where trip_id=p_trip_id),'{}'::jsonb),
 'knowledge',coalesce((select jsonb_object_agg(id::text,revision) from public.travel_knowledge where id in(select knowledge_id from public.travel_trip_knowledge where trip_id=p_trip_id union select l.knowledge_id from public.travel_event_knowledge l join public.travel_events e on e.id=l.event_id where e.trip_id=p_trip_id)),'{}'::jsonb)) into actual;
 if p_expected is null or actual is distinct from p_expected then raise exception 'Trip changed; review before deleting' using errcode='P0409';end if;
 with recursive subtree as (
 select id from public.travel_events where id=p_event_id and trip_id=p_trip_id
 union all select e.id from public.travel_events e join subtree s on e.parent_event_id=s.id where e.trip_id=p_trip_id
 ) select array_agg(id::text) into ids from subtree;
 select coalesce(jsonb_agg(jsonb_build_object('eventId',e.id,'artifact',a.value)),'[]'::jsonb)
 into refs from public.travel_events e cross join lateral jsonb_array_elements(e.artifacts) a where e.id::text=any(ids) and e.trip_id=p_trip_id;
 -- Event links cascade. Derived reverse mirrors change, not Knowledge source revisions.
 delete from public.travel_events where id=p_event_id and trip_id=p_trip_id;
 return jsonb_build_object('eventIds',to_jsonb(ids),'artifacts',refs);
end;
$$;
revoke all on function public.porter_app_delete_event(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.porter_app_delete_event(uuid,uuid,jsonb) to authenticated;

commit;
