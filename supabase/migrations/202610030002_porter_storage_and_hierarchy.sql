-- Porter-owned Storage bucket. Original artifacts remain private and inherit authenticated ownership.
insert into storage.buckets (id, name, public) values ('porter-artifacts', 'porter-artifacts', false) on conflict (id) do nothing;
create policy porter_artifacts_select on storage.objects for select to authenticated using (bucket_id = 'porter-artifacts' and owner_id = (select auth.uid()));
create policy porter_artifacts_insert on storage.objects for insert to authenticated with check (bucket_id = 'porter-artifacts' and owner_id = (select auth.uid()));
create policy porter_artifacts_update on storage.objects for update to authenticated using (bucket_id = 'porter-artifacts' and owner_id = (select auth.uid())) with check (bucket_id = 'porter-artifacts' and owner_id = (select auth.uid()));
create policy porter_artifacts_delete on storage.objects for delete to authenticated using (bucket_id = 'porter-artifacts' and owner_id = (select auth.uid()));

-- Database defence in depth for parent cycles; the semantic service also returns a useful hierarchy error.
create or replace function public.travel_events_reject_parent_cycle() returns trigger language plpgsql as $$
begin
  if new.parent_event_id is null then return new; end if;
  if exists (
    with recursive ancestors as (
      select id, parent_event_id from public.travel_events where id = new.parent_event_id
      union all
      select e.id, e.parent_event_id from public.travel_events e join ancestors a on e.id = a.parent_event_id
    ) select 1 from ancestors where id = new.id
  ) then raise exception 'travel Event parent cycle'; end if;
  return new;
end;
$$;
create trigger travel_events_parent_cycle before insert or update of parent_event_id on public.travel_events for each row execute function public.travel_events_reject_parent_cycle();
