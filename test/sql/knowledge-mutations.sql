begin;
insert into auth.users values('77777777-7777-4777-8777-777777777777'),('88888888-8888-4888-8888-888888888888');
insert into public.travel_trips(id,owner_id,title) values('70000000-0000-4000-8000-000000000001','77777777-7777-4777-8777-777777777777','Legacy');
insert into public.travel_events(id,trip_id,title) values('70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001','Visit');
insert into public.travel_knowledge(id,owner_id,trip_id,title,content,sources,participant_ids,related_event_ids) values('70000000-0000-4000-8000-000000000003','77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000001','Parking','Bay 3','[{"url":"https://original"}]','["wes"]','["70000000-0000-4000-8000-000000000002"]');
set role authenticated;
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',false);
do $$declare first jsonb; second jsonb; result jsonb;begin
 first:=public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000010',true,0,'{"title":"Museum","content":"","tags":["ＡＲＴ","art"],"planning":{"cost":{"amount":0,"currency":"USD"},"primaryUrl":"https://example.com","bookingRequired":"unknown"}}');
 result:=public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000010',true,0,'{"title":"Museum","content":"","tags":["ＡＲＴ","art"],"planning":{"cost":{"amount":0,"currency":"USD"},"primaryUrl":"https://example.com","bookingRequired":"unknown"}}');
 if result<>first or (select count(*) from public.travel_knowledge where id='70000000-0000-4000-8000-000000000004')<>1 or exists(select 1 from public.travel_trip_knowledge where knowledge_id='70000000-0000-4000-8000-000000000004') then raise exception 'Create retry duplicated or associated';end if;
 if (select tags from public.travel_knowledge where id='70000000-0000-4000-8000-000000000004')<>'["ＡＲＴ"]' then raise exception 'Tags not normalized';end if;
 second:=public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000011',false,1,'{"content":"First edit"}');
 perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000012',false,2,'{"content":"Newer edit"}');
 result:=public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000011',false,1,'{"content":"First edit"}');
 if result<>second or (select content from public.travel_knowledge where id='70000000-0000-4000-8000-000000000004')<>'Newer edit' or (select revision from public.travel_knowledge where id='70000000-0000-4000-8000-000000000004')<>3 then raise exception 'Edit retry overwrote/incremented';end if;
 begin perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000011',false,1,'{"content":"Changed payload"}');raise exception 'Payload reuse accepted';exception when sqlstate '22023' then null;end;
 begin perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000013',false,1,'{"content":"Stale edit"}');raise exception 'Stale CAS accepted';exception when sqlstate 'P0409' then null;end;
 begin perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000013',false,3,'{"sources":[]}');raise exception 'Provenance write accepted';exception when sqlstate '22023' then null;end;
 begin perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000013',false,3,'{"related_event_ids":[]}');raise exception 'References write accepted';exception when sqlstate '22023' then null;end;
 begin perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000013',false,3,'{"planning":{"bookingRequired":true}}');raise exception 'Invalid planning accepted' using errcode='P0999';exception when sqlstate 'P0001' then null;end;
 perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000014',false,1,'{"content":"Bay 4"}');
 if not exists(select 1 from public.travel_trip_knowledge where knowledge_id='70000000-0000-4000-8000-000000000003' and participant_ids='["wes"]') or not exists(select 1 from public.travel_event_knowledge where knowledge_id='70000000-0000-4000-8000-000000000003') or (select sources from public.travel_knowledge where id='70000000-0000-4000-8000-000000000003')<>'[{"url":"https://original"}]' then raise exception 'Legacy data clobbered';end if;
 if (select revision from public.travel_events where id='70000000-0000-4000-8000-000000000002')<>2 then raise exception 'Content edit changed Event revision';end if;
 -- No receipt after rejected CAS/validation; a corrected request may use its never-committed ID.
 perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000013',false,3,'{"content":"Corrected"}');
 delete from public.travel_knowledge where id='70000000-0000-4000-8000-000000000004';
 begin perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000011',false,1,'{"content":"First edit"}');raise exception 'Deleted source resurrected';exception when sqlstate 'P0404' then null;end;
end$$;
select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',false);
do $$begin
 begin perform public.porter_mutate_knowledge('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000020',false,2,'{"content":"Foreign"}');raise exception 'Forged owner allowed';exception when sqlstate 'P0404' then null;end;
 begin perform public.porter_mutate_knowledge('88888888-8888-4888-8888-888888888888','70000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000020',false,2,'{"content":"Foreign"}');raise exception 'Cross-owner source allowed';exception when sqlstate 'P0404' then null;end;
 if has_function_privilege('anon','public.porter_mutate_knowledge(uuid,uuid,uuid,boolean,integer,jsonb)','execute') or has_table_privilege('authenticated','porter_private.knowledge_receipts','select') then raise exception 'Receipts/functions exposed';end if;
end$$;
reset role;
rollback;
