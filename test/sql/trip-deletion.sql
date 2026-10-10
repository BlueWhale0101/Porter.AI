\set ON_ERROR_STOP on
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.travel_trips,public.travel_events,public.travel_knowledge to authenticated;
insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.travel_trips(id,owner_id,title) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Delete'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','Keep');
insert into public.travel_events(id,trip_id,title,artifacts) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Parent','[]'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Child','[{"id":"ticket","storageRef":{"provider":"external"}}]'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Keep','[]');
update public.travel_events set parent_event_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
insert into public.travel_knowledge(id,trip_id,title,content,related_event_ids) values
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Note','Delete','["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]'),
 ('99999999-9999-4999-8999-999999999999','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Note','Keep','[]');
do $$begin
 if has_function_privilege('anon','public.porter_app_delete_event(uuid,uuid,jsonb)','execute') or has_function_privilege('service_role','public.porter_app_delete_event(uuid,uuid,jsonb)','execute') then raise exception 'Event RPC exposed';end if;
 if has_function_privilege('anon','public.porter_app_delete_trip(uuid,jsonb)','execute') or has_function_privilege('service_role','public.porter_app_delete_trip(uuid,jsonb)','execute') then raise exception 'RPC exposed to non-app roles';end if;
 begin update public.travel_events set trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';raise exception 'cross-Trip parent move allowed';exception when foreign_key_violation then null;end;
end$$;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$begin
 begin perform public.porter_app_delete_trip('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}');raise exception 'non-owner deleted';exception when sqlstate 'P0404' then null;end;
 begin perform public.porter_app_delete_event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','{}');raise exception 'non-owner deleted Event';exception when sqlstate 'P0404' then null;end;
 if exists(select 1 from public.travel_trips) then raise exception 'RLS exposed another owner';end if;
end$$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$declare expected jsonb='{"trip":1,"events":{"cccccccc-cccc-4ccc-8ccc-cccccccccccc":1,"dddddddd-dddd-4ddd-8ddd-dddddddddddd":2},"knowledge":{"ffffffff-ffff-4fff-8fff-ffffffffffff":1}}';result jsonb;begin
 begin perform public.porter_app_delete_event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','{}');raise exception 'stale Event deletion allowed';exception when sqlstate 'P0409' then null;end;
 -- Exercise the real function, then roll back this subtransaction to reuse the
 -- same aggregate for the independent whole-Trip cascade checks below.
 begin
 result=public.porter_app_delete_event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc',expected);
 if jsonb_array_length(result->'eventIds')<>2 or jsonb_array_length(result->'artifacts')<>1 then raise exception 'Event cleanup result incomplete';end if;
 if (select count(*) from public.travel_events)<>1 or (select count(*) from public.travel_trips)<>2 then raise exception 'Event subtree removal incorrect';end if;
 if not exists(select 1 from public.travel_knowledge where id='ffffffff-ffff-4fff-8fff-ffffffffffff' and related_event_ids='[]' and revision=1) then raise exception 'Knowledge not retained and unlinked';end if;
 if not exists(select 1 from public.travel_events where title='Keep' and revision=1) then raise exception 'unrelated Event changed';end if;
 raise exception 'rollback test only' using errcode='P0999';
 exception when sqlstate 'P0999' then null;end;
end$$;
do $$declare expected jsonb='{"trip":1,"events":{"cccccccc-cccc-4ccc-8ccc-cccccccccccc":1,"dddddddd-dddd-4ddd-8ddd-dddddddddddd":2},"knowledge":{"ffffffff-ffff-4fff-8fff-ffffffffffff":1}}';result jsonb;begin
 begin perform public.porter_app_delete_trip('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null);raise exception 'null expectation deleted';exception when sqlstate 'P0409' then null;end;
 update public.travel_events set revision=3 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 begin perform public.porter_app_delete_trip('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expected);raise exception 'stale child deleted';exception when sqlstate 'P0409' then null;end;
 if (select count(*) from public.travel_events)<>3 then raise exception 'failed delete damaged data';end if;
 expected=jsonb_set(expected,'{events,dddddddd-dddd-4ddd-8ddd-dddddddddddd}','3');
 result=public.porter_app_delete_trip('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expected);
 if jsonb_array_length(result->'artifacts')<>1 then raise exception 'missing artifact cleanup metadata';end if;
 if exists(select 1 from public.travel_trips where title='Delete') or exists(select 1 from public.travel_events where title<>'Keep') then raise exception 'aggregate survived';end if;
 if not exists(select 1 from public.travel_knowledge where content='Delete' and trip_id is null and related_event_ids='[]' and revision=1) then raise exception 'Global Knowledge lost or changed';end if;
 if (select count(*) from public.travel_trips)<>1 or (select count(*) from public.travel_events)<>1 or (select count(*) from public.travel_knowledge)<>2 then raise exception 'unrelated aggregate changed';end if;
end$$;
reset role;
