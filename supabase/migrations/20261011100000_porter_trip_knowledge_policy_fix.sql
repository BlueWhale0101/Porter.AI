-- Correct Trip/Knowledge association authorization for global Knowledge.
-- The association's trip_id, not Knowledge's optional legacy context trip_id,
-- is authoritative. Safe to apply after the production hotfix.
begin;

drop policy if exists travel_trip_knowledge_owner
  on public.travel_trip_knowledge;

create policy travel_trip_knowledge_owner
  on public.travel_trip_knowledge
  to authenticated
  using (
    exists (
      select 1
      from public.travel_trips t
      join public.travel_knowledge k
        on k.id = travel_trip_knowledge.knowledge_id
      where t.id = travel_trip_knowledge.trip_id
        and t.owner_id = auth.uid()
        and k.owner_id = t.owner_id
    )
  )
  with check (
    exists (
      select 1
      from public.travel_trips t
      join public.travel_knowledge k
        on k.id = travel_trip_knowledge.knowledge_id
      where t.id = travel_trip_knowledge.trip_id
        and t.owner_id = auth.uid()
        and k.owner_id = t.owner_id
    )
  );

commit;
