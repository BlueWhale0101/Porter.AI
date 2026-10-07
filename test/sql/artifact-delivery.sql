\set ON_ERROR_STOP on
grant usage on schema storage to authenticated;
grant select on storage.objects to authenticated;
insert into public.travel_events(id,trip_id,title,artifacts) values ('12345678-1234-4234-8234-123456789abc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','MCP upload','[{"id":"ticket","storageRef":{"provider":"supabase-storage","bucket":"porter-artifacts","key":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12345678-1234-4234-8234-123456789abc/ticket/original"}}]');
insert into storage.objects(bucket_id,owner_id,name) values
 ('porter-artifacts',null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12345678-1234-4234-8234-123456789abc/ticket/original'),
 ('porter-artifacts',null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12345678-1234-4234-8234-123456789abc/unattached/original'),
 ('porter-artifacts',null,'other/shared'),
 ('wrong-bucket',null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/12345678-1234-4234-8234-123456789abc/ticket/original');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$begin if (select count(*) from storage.objects)<>0 then raise exception 'Non-owner can read MCP artifacts';end if;end$$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$begin if (select count(*) from storage.objects)<>1 then raise exception 'Exact owner reference read failed or leaked another object';end if;end$$;
reset role;
