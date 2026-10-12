-- Disposable database only. Every fixture is rolled back.
begin;
insert into auth.users values('55555555-5555-4555-8555-555555555555'),('66666666-6666-4666-8666-666666666666');
insert into public.travel_trips(id,owner_id,title) values
 ('50000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555','LA'),
 ('50000000-0000-4000-8000-000000000002','55555555-5555-4555-8555-555555555555','England'),
 ('60000000-0000-4000-8000-000000000001','66666666-6666-4666-8666-666666666666','Foreign');
insert into public.travel_knowledge(id,owner_id,title,content,tags) values
 ('50000000-0000-4000-8000-000000000003','55555555-5555-4555-8555-555555555555','Museum','River walk','["ＡＲＴ","parking","current"]'),
 ('50000000-0000-4000-8000-000000000004','55555555-5555-4555-8555-555555555555','Unrelated','Not in this Trip','[]'),
 ('60000000-0000-4000-8000-000000000003','66666666-6666-4666-8666-666666666666','Secret','','[]');
insert into public.travel_knowledge(id,trip_id,owner_id,title,content,tags,participant_ids) values
 ('50000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555','Parking','Bay 3','["parking","current"]','["wes"]');
insert into public.travel_events(id,trip_id,title) values('50000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000001','Visit');
grant select,insert,update,delete on public.travel_trips,public.travel_events to authenticated,service_role;
set role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
do $$declare result jsonb; old_result jsonb; page jsonb; source jsonb;begin
 if (public.porter_trip_idea_state('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','55555555-5555-4555-8555-555555555555')->>'revision')<>'0' then raise exception 'Missing association is not version zero';end if;
 old_result:=public.porter_set_trip_idea('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',true,0,'50000000-0000-4000-8000-000000000010');
 perform public.porter_set_trip_idea('50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',true,0,'50000000-0000-4000-8000-000000000011');
 page:=public.porter_trip_ideas('50000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555',null,1);
 if jsonb_array_length(page->'items')<>1 or page->>'nextCursor'<>'50000000-0000-4000-8000-000000000003' or (page->'items'->0->>'operationalContext')<>'false' then raise exception 'Bounded planning page wrong';end if;
 page:=public.porter_trip_ideas('50000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555',(page->>'nextCursor')::uuid,1);
 if page->'items'->0->>'id'<>'50000000-0000-4000-8000-000000000005' or page->>'nextCursor' is not null then raise exception 'Continuation wrong';end if;
 page:=public.porter_trip_ideas('50000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555',null,50,'river','art');
 if jsonb_array_length(page->'items')<>1 then raise exception 'Search/tag matching wrong';end if;
 select to_jsonb(e)||'{"revision":2}' into source from public.travel_events e where id='50000000-0000-4000-8000-000000000006';
 perform public.porter_write_event(source,'["50000000-0000-4000-8000-000000000003"]',1);
 page:=public.porter_trip_ideas('50000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555');
 if jsonb_array_length(page->'items')<>2 or jsonb_array_length(page->'items'->0->'tripEventIds')<>1 then raise exception 'Union duplicated source or lost links';end if;
 result:=public.porter_set_trip_idea('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',false,1,'50000000-0000-4000-8000-000000000012');
 if result->>'revision'<>'2' then raise exception 'Tombstone version wrong';end if;
 result:=public.porter_set_trip_idea('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',true,0,'50000000-0000-4000-8000-000000000010');
 if result<>old_result or (public.porter_trip_idea_state('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','55555555-5555-4555-8555-555555555555')->>'active')<>'false' then raise exception 'Old retry reapplied';end if;
 begin perform public.porter_set_trip_idea('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',false,0,'50000000-0000-4000-8000-000000000010');raise exception 'Receipt payload mismatch accepted';exception when sqlstate '22023' then null;end;
 begin perform public.porter_set_trip_idea('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',true,1,'50000000-0000-4000-8000-000000000013');raise exception 'Stale write accepted';exception when sqlstate 'P0409' then null;end;
 perform public.porter_set_trip_idea('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',true,2,'50000000-0000-4000-8000-000000000013');
 -- Removing a planning flag cannot remove operational context, source or Event authority.
 perform public.porter_set_trip_idea('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000005',false,0,'50000000-0000-4000-8000-000000000014');
 if not exists(select 1 from public.travel_trip_knowledge where participant_ids='["wes"]') or (select revision from public.travel_knowledge where id='50000000-0000-4000-8000-000000000003')<>1 or not exists(select 1 from public.travel_event_knowledge where knowledge_id='50000000-0000-4000-8000-000000000003') then raise exception 'Operational/source/reference mutated';end if;
 begin insert into public.travel_trip_ideas values('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004',true,1);raise exception 'CAS bypass';exception when insufficient_privilege then null;end;
 begin perform public.porter_trip_ideas('50000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555',null,101);raise exception 'Unbounded read';exception when sqlstate '22023' then null;end;
end$$;
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
do $$begin
 if exists(select 1 from public.travel_trip_ideas) then raise exception 'Association RLS leak';end if;
 begin perform public.porter_trip_ideas('50000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555');raise exception 'Forged owner';exception when sqlstate 'P0404' then null;end;
 begin perform public.porter_set_trip_idea('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',true,3,'50000000-0000-4000-8000-000000000020');raise exception 'Foreign write';exception when sqlstate 'P0404' then null;end;
end$$;
set role service_role;
do $$begin
 begin perform public.porter_set_trip_idea('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',true,0,'50000000-0000-4000-8000-000000000021');raise exception 'Cross-owner privileged write';exception when sqlstate 'P0404' then null;end;
 if has_table_privilege('service_role','public.travel_trip_ideas','INSERT') or has_function_privilege('anon','public.porter_set_trip_idea(uuid,uuid,boolean,integer,uuid)','EXECUTE') then raise exception 'Privileges too broad';end if;
end$$;
reset role;
delete from public.travel_trips where id='50000000-0000-4000-8000-000000000001';
do $$begin
 if not exists(select 1 from public.travel_knowledge where id='50000000-0000-4000-8000-000000000003') or not exists(select 1 from public.travel_trip_ideas where trip_id='50000000-0000-4000-8000-000000000002') or exists(select 1 from porter_private.idea_receipts where trip_id='50000000-0000-4000-8000-000000000001') then raise exception 'Deletion retention/cascade wrong';end if;
end$$;
rollback;
