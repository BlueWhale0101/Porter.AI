-- Service-credential uploads have no end-user Storage owner_id. Let only the
-- authenticated Trip owner read an exact, referenced canonical object. No
-- public access, write privileges, or arbitrary path-prefix grants are added.
create policy porter_artifacts_referenced_read on storage.objects
for select to authenticated using (
 bucket_id='porter-artifacts' and exists (
  select 1 from public.travel_events e join public.travel_trips t on t.id=e.trip_id
  cross join lateral jsonb_array_elements(e.artifacts) a
  where t.owner_id=(select auth.uid())
  and a.value->'storageRef'->>'provider'='supabase-storage'
  and a.value->'storageRef'->>'bucket'=bucket_id
  and a.value->'storageRef'->>'key'=name
  and name=e.trip_id::text||'/'||e.id::text||'/'||(a.value->>'id')||'/original'
 )
);
