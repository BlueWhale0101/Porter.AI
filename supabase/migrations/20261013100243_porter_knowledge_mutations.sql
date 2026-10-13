-- Staged only: reconcile Phase 1 history and apply increment 2 first, after approval.
begin;
create table porter_private.knowledge_receipts (
 owner_id uuid not null references auth.users(id) on delete cascade,
 mutation_id uuid not null, request jsonb not null, result jsonb not null,
 primary key(owner_id,mutation_id)
);
alter table porter_private.knowledge_receipts enable row level security;
revoke all on porter_private.knowledge_receipts from public,anon,authenticated,service_role;
create function porter_private.mutate_knowledge(p_owner uuid,p_id uuid,p_mutation uuid,p_create boolean,p_expected integer,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request jsonb; receipt porter_private.knowledge_receipts%rowtype; previous public.travel_knowledge%rowtype; result jsonb; normalized_tags jsonb; legacy_trip uuid;
begin
 if p_owner is null or (current_setting('role')<>'service_role' and p_owner is distinct from auth.uid()) then raise exception 'Owner unavailable' using errcode='P0404';end if;
 if p_id is null or p_mutation is null or p_create is null or p_expected is null or (p_create and p_expected<>0) or (not p_create and p_expected not between 1 and 2147483646) or p_fields is null or jsonb_typeof(p_fields)<>'object' then raise exception 'Invalid Knowledge mutation' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_fields) key where key not in ('title','content','tags','planning')) then raise exception 'Only Knowledge capture/edit fields are allowed' using errcode='22023';end if;
 if (p_create or p_fields ? 'title') and (jsonb_typeof(p_fields->'title') is distinct from 'string' or length(btrim(p_fields->>'title'))=0) then raise exception 'Knowledge title is required' using errcode='22023';end if;
 if p_fields ? 'content' and jsonb_typeof(p_fields->'content') not in ('string','null') then raise exception 'Knowledge content must be text' using errcode='22023';end if;
 if p_fields ? 'tags' then
  if jsonb_typeof(p_fields->'tags')<>'array' then raise exception 'Invalid tags' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(p_fields->'tags') t where jsonb_typeof(t)<>'string' or length(btrim(t#>>'{}')) not between 1 and 200) then raise exception 'Invalid tags' using errcode='22023';end if;
  select coalesce(jsonb_agg(tag order by ordinal),'[]'::jsonb) into normalized_tags from (
   select distinct on(lower(normalize(btrim(tag),NFKC))) btrim(tag) tag,ordinal from jsonb_array_elements_text(p_fields->'tags') with ordinality t(tag,ordinal) order by lower(normalize(btrim(tag),NFKC)),ordinal
  ) unique_tags;
 end if;
 request:=jsonb_build_object('knowledgeId',p_id,'create',p_create,'expected',p_expected,'fields',p_fields);
 -- Serialize exact receipt identities without touching shared Auth rows.
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_mutation::text,0));
 select * into receipt from porter_private.knowledge_receipts where owner_id=p_owner and mutation_id=p_mutation;
 if found then
  if receipt.request<>request then raise exception 'Mutation ID reused with different payload' using errcode='22023';end if;
  -- A receipt never resurrects a deleted source.
  if not exists(select 1 from public.travel_knowledge where id=p_id and owner_id=p_owner) then raise exception 'Knowledge unavailable' using errcode='P0404';end if;
  return receipt.result;
 end if;
 if p_create then
  if exists(select 1 from public.travel_knowledge where id=p_id) then raise exception 'Knowledge identity already exists' using errcode='P0409';end if;
  begin
   insert into public.travel_knowledge(id,owner_id,title,content,tags,planning) values(p_id,p_owner,btrim(p_fields->>'title'),coalesce(p_fields->>'content',''),coalesce(normalized_tags,'[]'::jsonb),coalesce(p_fields->'planning','{}'::jsonb)) returning * into previous;
  exception when unique_violation then raise exception 'Knowledge identity already exists' using errcode='P0409';end;
 else
  -- The unchanged legacy trigger upserts operational context. Match Event/deletion
  -- Trip-before-Knowledge ordering before that trigger can acquire a Trip FK lock.
  select trip_id into legacy_trip from public.travel_knowledge where id=p_id and owner_id=p_owner;
  if legacy_trip is not null then perform id from public.travel_trips where id=legacy_trip for update;end if;
  select * into previous from public.travel_knowledge where id=p_id and owner_id=p_owner for update;
  if not found then raise exception 'Knowledge unavailable' using errcode='P0404';end if;
  if previous.revision<>p_expected then raise exception 'Knowledge revision changed' using errcode='P0409';end if;
  update public.travel_knowledge set title=case when p_fields ? 'title' then btrim(p_fields->>'title') else title end,
   content=case when p_fields ? 'content' then coalesce(p_fields->>'content','') else content end,
   tags=coalesce(normalized_tags,tags),planning=case when p_fields ? 'planning' then p_fields->'planning' else planning end,
   revision=revision+1,updated_at=now() where id=p_id returning * into previous;
 end if;
 result:=jsonb_build_object('id',p_id,'ownerId',p_owner,'revision',previous.revision);
 insert into porter_private.knowledge_receipts values(p_owner,p_mutation,request,result);
 return result;
end;$$;
revoke all on function porter_private.mutate_knowledge(uuid,uuid,uuid,boolean,integer,jsonb) from public,anon;
grant execute on function porter_private.mutate_knowledge(uuid,uuid,uuid,boolean,integer,jsonb) to authenticated,service_role;
create function public.porter_mutate_knowledge(p_owner uuid,p_id uuid,p_mutation uuid,p_create boolean,p_expected integer,p_fields jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select porter_private.mutate_knowledge(p_owner,p_id,p_mutation,p_create,p_expected,p_fields) $$;
revoke all on function public.porter_mutate_knowledge(uuid,uuid,uuid,boolean,integer,jsonb) from public,anon;
grant execute on function public.porter_mutate_knowledge(uuid,uuid,uuid,boolean,integer,jsonb) to authenticated,service_role;
commit;
