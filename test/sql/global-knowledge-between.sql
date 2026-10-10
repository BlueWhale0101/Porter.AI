-- Simulate an old server writing after backfill and before ownership contract.
update public.travel_knowledge set content='Updated before contract',revision=3,
 participant_ids='["skye"]',validity_windows='[{"end":"2027-01-01T00:00:00Z"}]',
 related_event_ids='["30000000-0000-4000-8000-000000000009"]'
 where id='30000000-0000-4000-8000-000000000008';
