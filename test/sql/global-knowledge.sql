\set ON_ERROR_STOP on
begin;
do $$begin
 if not exists(select 1 from public.travel_knowledge where id='30000000-0000-4000-8000-000000000003' and owner_id='33333333-3333-4333-8333-333333333333' and revision=7 and content='814' and tags='["Los Angeles","Stay"]' and sources='[{"url":"https://example.com/original"}]' and created_at='2026-01-01T00:00:00Z' and updated_at='2026-02-01T00:00:00Z') then raise exception 'Migration changed Knowledge source truth';end if;
 if not exists(select 1 from public.travel_trip_knowledge where knowledge_id='30000000-0000-4000-8000-000000000003' and participant_ids='["wes"]' and validity_windows='[{"end":"2026-12-10T00:00:00Z"}]') then raise exception 'Context not backfilled';end if;
 if not exists(select 1 from public.travel_event_knowledge where knowledge_id='30000000-0000-4000-8000-000000000003' and event_id='30000000-0000-4000-8000-000000000002') or (select revision from public.travel_events where id='30000000-0000-4000-8000-000000000002')<>9 then raise exception 'References/revision not preserved';end if;
 if has_function_privilege('anon','public.porter_write_event(jsonb,jsonb,integer)','execute') or has_function_privilege('anon','porter_private.write_event(jsonb,jsonb,integer)','execute') then raise exception 'Reference writer exposed to anon';end if;
 if has_table_privilege('authenticated','public.travel_event_knowledge','INSERT') or has_table_privilege('service_role','public.travel_event_knowledge','DELETE') then raise exception 'Reference CAS bypass available';end if;
end$$;
grant usage on schema public to authenticated,service_role;
grant select,insert,update,delete on public.travel_trips,public.travel_events to authenticated,service_role;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
insert into public.travel_knowledge(id,owner_id,title) values('30000000-0000-4000-8000-000000000004','33333333-3333-4333-8333-333333333333','Global empty notes');
insert into public.travel_trips(id,owner_id,title,end_date,knowledge_preload_tag) values('30000000-0000-4000-8000-000000000005','33333333-3333-4333-8333-333333333333','Other context','2026-12-10','Los Angeles');
do $$declare result jsonb; source jsonb;begin
 if not public.porter_knowledge_has_tag('["Los Angeles","Museum"]','los angeles') then raise exception 'Tag matching is not case-insensitive';end if;
 if not exists(select 1 from public.travel_knowledge where id='30000000-0000-4000-8000-000000000004' and trip_id is null and content='') then raise exception 'Global create failed';end if;
 select to_jsonb(e)||'{"revision":10}' into source from public.travel_events e where id='30000000-0000-4000-8000-000000000002';
 result:=public.porter_write_event(source,'["30000000-0000-4000-8000-000000000004"]',9);
 if result->>'revision'<>'10' or not exists(select 1 from public.travel_event_knowledge where knowledge_id='30000000-0000-4000-8000-000000000004') then raise exception 'Event reference write failed';end if;
 if (select related_event_ids from public.travel_knowledge where id='30000000-0000-4000-8000-000000000003')<>'[]' or (select revision from public.travel_knowledge where id='30000000-0000-4000-8000-000000000003')<>7 then raise exception 'Reverse list is not derived';end if;
 begin perform public.porter_write_event(source,'[]',9);raise exception 'Stale Event bypassed revision';exception when sqlstate 'P0409' then null;end;
 source:=source||'{"revision":11}';
 begin perform public.porter_write_event(source,'["30000000-0000-4000-8000-000000000099"]',10);raise exception 'Dangling link accepted';exception when sqlstate 'P0404' then null;end;
 if (select revision from public.travel_events where id='30000000-0000-4000-8000-000000000002')<>10 then raise exception 'Failed link write partially mutated Event';end if;
 -- Existing durable Knowledge mutations still work; no shadow relationship authority.
 update public.travel_knowledge set related_event_ids='["30000000-0000-4000-8000-000000000002"]',revision=8 where id='30000000-0000-4000-8000-000000000003' and revision=7;
 if (select revision from public.travel_events where id='30000000-0000-4000-8000-000000000002')<>11 then raise exception 'Legacy references do not advance Event revision';end if;
 begin insert into public.travel_event_knowledge values('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000004');raise exception 'Direct join write accepted';exception when insufficient_privilege then null;end;
 update public.travel_knowledge set planning='{"cost":{"amount":0,"currency":"USD"},"bookingRequired":"unknown","timedAvailability":"no","primaryUrl":"https://example.com"}' where id='30000000-0000-4000-8000-000000000004';
 begin update public.travel_knowledge set planning='{"cost":{"amount":-1,"currency":"USD"}}' where id='30000000-0000-4000-8000-000000000004';raise exception 'negative cost allowed' using errcode='P0999';exception when sqlstate 'P0001' then null;end;
 begin update public.travel_knowledge set planning='{"bookingRequired":true}' where id='30000000-0000-4000-8000-000000000004';raise exception 'boolean tri-state allowed' using errcode='P0999';exception when sqlstate 'P0001' then null;end;
 begin update public.travel_knowledge set planning='{"primaryUrl":"https://user:secret@example.com"}' where id='30000000-0000-4000-8000-000000000004';raise exception 'credential URL allowed' using errcode='P0999';exception when sqlstate 'P0001' then null;end;
 begin update public.travel_trips set end_date='2026-02-30' where id='30000000-0000-4000-8000-000000000005';raise exception 'Impossible end date allowed';exception when datetime_field_overflow then null;end;
end$$;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
do $$begin
 if exists(select 1 from public.travel_knowledge) or exists(select 1 from public.travel_trip_knowledge) or exists(select 1 from public.travel_event_knowledge) then raise exception 'Global/context/reference RLS leak';end if;
 begin perform public.porter_write_event('{"id":"30000000-0000-4000-8000-000000000002","trip_id":"30000000-0000-4000-8000-000000000001"}','[]',11);raise exception 'Non-owner reference write';exception when sqlstate 'P0404' then null;end;
end$$;
insert into public.travel_trips(id,owner_id,title) values('40000000-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','Foreign');
-- Privileged MCP still cannot associate objects with different owners.
set role service_role;
do $$begin
 begin insert into public.travel_trip_knowledge(trip_id,knowledge_id) values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003');raise exception 'Cross-owner context allowed' using errcode='P0999';exception when sqlstate 'P0001' then null;end;
 begin perform public.porter_write_event('{"id":"40000000-0000-4000-8000-000000000002","trip_id":"40000000-0000-4000-8000-000000000001"}','["30000000-0000-4000-8000-000000000003"]',null);raise exception 'Cross-owner MCP link';exception when sqlstate 'P0404' then null;end;
end$$;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $$declare expected jsonb;begin
 -- Deleting global content changes links/remaining Event revisions, not unrelated records.
 delete from public.travel_knowledge where id='30000000-0000-4000-8000-000000000004' and revision=1;
 if (select revision from public.travel_events where id='30000000-0000-4000-8000-000000000002')<>12 then raise exception 'Knowledge deletion did not invalidate Event revision';end if;
 expected:=jsonb_build_object('trip',4,'events',jsonb_build_object('30000000-0000-4000-8000-000000000002',12),'knowledge',jsonb_build_object('30000000-0000-4000-8000-000000000003',8));
 perform public.porter_app_delete_trip('30000000-0000-4000-8000-000000000001',expected);
 if not exists(select 1 from public.travel_knowledge where id='30000000-0000-4000-8000-000000000003' and trip_id is null and revision=8 and content='814' and related_event_ids='[]') then raise exception 'Trip deleted global Knowledge';end if;
 if not exists(select 1 from public.travel_trips where id='30000000-0000-4000-8000-000000000005' and end_date='2026-12-10') then raise exception 'Other Trip changed';end if;
end$$;
reset role;
rollback;
-- Remove only these isolated migration fixtures, leaving the old SQL suites clean.
delete from auth.users where id in('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
