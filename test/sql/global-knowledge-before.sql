-- Seed against the OLD schema before expand/backfill. Must survive byte-for-byte as source truth.
insert into auth.users values('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
insert into public.travel_trips(id,owner_id,title,revision) values('30000000-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','Legacy foundation',4);
insert into public.travel_events(id,trip_id,title,revision) values('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','Legacy stay',9);
insert into public.travel_knowledge(id,trip_id,title,content,tags,sources,participant_ids,validity_windows,related_event_ids,revision,created_at,updated_at) values
 ('30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','Original room','814','["Los Angeles","Stay"]','[{"url":"https://example.com/original"}]','["wes"]','[{"end":"2026-12-10T00:00:00Z"}]','["30000000-0000-4000-8000-000000000002"]',7,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z');

insert into public.travel_trips(id,owner_id,title) values('30000000-0000-4000-8000-000000000006','33333333-3333-4333-8333-333333333333','Between-stage writes');
insert into public.travel_events(id,trip_id,title,revision) values
 ('30000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000006','Old reference',5),
 ('30000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000006','New reference',6);
insert into public.travel_knowledge(id,trip_id,title,content,related_event_ids,participant_ids,revision) values
 ('30000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000006','Changed between stages','Original','["30000000-0000-4000-8000-000000000007"]','["wes"]',2);
