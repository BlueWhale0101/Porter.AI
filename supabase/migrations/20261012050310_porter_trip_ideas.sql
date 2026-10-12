-- Additive only. Apply after verified Phase 1/history reconciliation and approval.
begin;
create table public.travel_trip_ideas (
 trip_id uuid not null references public.travel_trips(id) on delete cascade,
 knowledge_id uuid not null references public.travel_knowledge(id) on delete cascade,
 active boolean not null, revision integer not null check(revision>0),
 primary key(trip_id,knowledge_id)
);
create index travel_trip_ideas_reverse on public.travel_trip_ideas(knowledge_id,trip_id);
create index travel_trip_ideas_active on public.travel_trip_ideas(trip_id,knowledge_id) where active;
alter table public.travel_trip_ideas enable row level security;
create policy travel_trip_ideas_owner on public.travel_trip_ideas for select to authenticated
 using(exists(select 1 from public.travel_trips t join public.travel_knowledge k on k.id=travel_trip_ideas.knowledge_id where t.id=travel_trip_ideas.trip_id and t.owner_id=(select auth.uid()) and k.owner_id=t.owner_id));
revoke all on public.travel_trip_ideas from public,anon,authenticated,service_role;
grant select on public.travel_trip_ideas to authenticated,service_role;
-- Receipts are not client-readable or directly writable. Retained until Trip deletion.
create table porter_private.idea_receipts (
 trip_id uuid not null references public.travel_trips(id) on delete cascade,
 mutation_id uuid not null, knowledge_id uuid not null,
 expected integer not null, active boolean not null, result jsonb not null,
 primary key(trip_id,mutation_id)
);
alter table porter_private.idea_receipts enable row level security;
revoke all on porter_private.idea_receipts from public,anon,authenticated,service_role;

create function porter_private.set_trip_idea(p_trip uuid,p_knowledge uuid,p_active boolean,p_expected integer,p_mutation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid; version integer; receipt porter_private.idea_receipts%rowtype; result jsonb;
begin
 if p_active is null or p_expected is null or p_expected<0 or p_expected>=2147483647 or p_mutation is null then raise exception 'Invalid association mutation' using errcode='22023';end if;
 -- Same lock ordering as existing Event/deletion transactions. Serializes a Trip's writes.
 select owner_id into owner from public.travel_trips where id=p_trip for update;
 if owner is null or (current_setting('role')<>'service_role' and owner is distinct from auth.uid()) then raise exception 'Trip unavailable' using errcode='P0404';end if;
 perform id from public.travel_knowledge where id=p_knowledge and owner_id=owner for key share;
 if not found then raise exception 'Knowledge unavailable' using errcode='P0404';end if;
 select * into receipt from porter_private.idea_receipts where trip_id=p_trip and mutation_id=p_mutation;
 if found then
  if receipt.knowledge_id<>p_knowledge or receipt.expected<>p_expected or receipt.active<>p_active then raise exception 'Mutation ID reused with different payload' using errcode='22023';end if;
  return receipt.result;
 end if;
 select revision into version from public.travel_trip_ideas where trip_id=p_trip and knowledge_id=p_knowledge;
 version:=coalesce(version,0);
 if version<>p_expected then raise exception 'Association revision changed' using errcode='P0409';end if;
 insert into public.travel_trip_ideas(trip_id,knowledge_id,active,revision) values(p_trip,p_knowledge,p_active,version+1)
 on conflict(trip_id,knowledge_id) do update set active=excluded.active,revision=excluded.revision;
 result:=jsonb_build_object('tripId',p_trip,'knowledgeId',p_knowledge,'active',p_active,'revision',version+1);
 insert into porter_private.idea_receipts values(p_trip,p_mutation,p_knowledge,p_expected,p_active,result);
 return result;
end;$$;
revoke all on function porter_private.set_trip_idea(uuid,uuid,boolean,integer,uuid) from public,anon;
grant execute on function porter_private.set_trip_idea(uuid,uuid,boolean,integer,uuid) to authenticated,service_role;
create function public.porter_set_trip_idea(p_trip uuid,p_knowledge uuid,p_active boolean,p_expected integer,p_mutation uuid)
returns jsonb language sql security invoker set search_path='' as $$ select porter_private.set_trip_idea(p_trip,p_knowledge,p_active,p_expected,p_mutation) $$;
revoke all on function public.porter_set_trip_idea(uuid,uuid,boolean,integer,uuid) from public,anon;
grant execute on function public.porter_set_trip_idea(uuid,uuid,boolean,integer,uuid) to authenticated,service_role;

create function public.porter_trip_idea_state(p_trip uuid,p_knowledge uuid,p_owner uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_owner is null or (current_setting('role')<>'service_role' and p_owner is distinct from auth.uid()) or not exists(select 1 from public.travel_trips t join public.travel_knowledge k on k.id=p_knowledge where t.id=p_trip and t.owner_id=p_owner and k.owner_id=p_owner) then raise exception 'Association unavailable' using errcode='P0404';end if;
 select jsonb_build_object('tripId',p_trip,'knowledgeId',p_knowledge,'active',active,'revision',revision) into result from public.travel_trip_ideas where trip_id=p_trip and knowledge_id=p_knowledge;
 return coalesce(result,jsonb_build_object('tripId',p_trip,'knowledgeId',p_knowledge,'active',false,'revision',0));
end;$$;
revoke all on function public.porter_trip_idea_state(uuid,uuid,uuid) from public,anon;
grant execute on function public.porter_trip_idea_state(uuid,uuid,uuid) to authenticated,service_role;

create function public.porter_trip_ideas(p_trip uuid,p_owner uuid,p_cursor uuid default null,p_limit integer default 50,p_query text default '',p_tag text default '')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 or p_query is null or length(p_query)>500 or p_tag is null or length(p_tag)>200 then raise exception 'Invalid Ideas query' using errcode='22023';end if;
 if p_owner is null or (current_setting('role')<>'service_role' and p_owner is distinct from auth.uid()) or not exists(select 1 from public.travel_trips where id=p_trip and owner_id=p_owner) then raise exception 'Trip unavailable' using errcode='P0404';end if;
 -- Candidate IDs come only from indexed Trip relationships, never the global collection.
 with candidates as (
  select knowledge_id from public.travel_trip_ideas where trip_id=p_trip and active
  union select knowledge_id from public.travel_trip_knowledge where trip_id=p_trip
  union select l.knowledge_id from public.travel_events e join public.travel_event_knowledge l on l.event_id=e.id where e.trip_id=p_trip
 ), matches as (
  select k.* from candidates c join public.travel_knowledge k on k.id=c.knowledge_id
  where k.owner_id=p_owner and (p_cursor is null or k.id>p_cursor)
   and (p_tag='' or public.porter_knowledge_has_tag(k.tags,p_tag))
   and (p_query='' or strpos(lower(normalize(k.title,NFKC)),lower(normalize(p_query,NFKC)))>0 or strpos(lower(normalize(k.content,NFKC)),lower(normalize(p_query,NFKC)))>0
    or exists(select 1 from jsonb_array_elements_text(k.tags) tag where strpos(lower(normalize(tag,NFKC)),lower(normalize(p_query,NFKC)))>0))
  order by k.id limit p_limit+1
 ), page as (select * from matches order by id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(k)||jsonb_build_object(
  'ideaAssociation',coalesce((select jsonb_build_object('tripId',p_trip,'knowledgeId',k.id,'active',i.active,'revision',i.revision) from public.travel_trip_ideas i where i.trip_id=p_trip and i.knowledge_id=k.id),jsonb_build_object('tripId',p_trip,'knowledgeId',k.id,'active',false,'revision',0)),
  'operationalContext',exists(select 1 from public.travel_trip_knowledge o where o.trip_id=p_trip and o.knowledge_id=k.id),
  'associatedTripIds',coalesce((select jsonb_agg(a.trip_id order by a.trip_id) from (select o.trip_id from public.travel_trip_knowledge o where o.knowledge_id=k.id union select i.trip_id from public.travel_trip_ideas i where i.knowledge_id=k.id and i.active) a),'[]'::jsonb),
  'tripEventIds',coalesce((select jsonb_agg(e.id order by e.id) from public.travel_events e join public.travel_event_knowledge l on l.event_id=e.id where e.trip_id=p_trip and l.knowledge_id=k.id),'[]'::jsonb)
 ) order by k.id) from page k),'[]'::jsonb),
 'nextCursor',case when (select count(*) from matches)>p_limit then (select id from page order by id desc limit 1) else null end) into result;
 return result;
end;$$;
revoke all on function public.porter_trip_ideas(uuid,uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.porter_trip_ideas(uuid,uuid,uuid,integer,text,text) to authenticated,service_role;
commit;
