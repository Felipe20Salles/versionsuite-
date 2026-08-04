-- 2026-07-30_03_backfill_members_and_rpc.sql
do $$
declare default_ws_id uuid;
begin
  select id into default_ws_id from workspaces where slug = 'default';
  if default_ws_id is null then
    raise exception 'Workspace com slug ''default'' não encontrado — rode 2026-07-30_01 primeiro';
  end if;

  insert into workspace_members (workspace_id, user_id, role_id, status)
  select
    default_ws_id,
    p.id,
    r.id,
    case
      when p.role is not null then 'active'
      when coalesce(p.prefs->>'status','') = 'rejected' then 'rejected'
      else 'pending'
    end
  from profiles p
  left join roles r on r.workspace_id = default_ws_id and r.nome = p.role
  where not exists (
    select 1 from workspace_members wm where wm.workspace_id = default_ws_id and wm.user_id = p.id
  );
end $$;

create or replace function ensure_workspace_membership(ws_id uuid)
returns table(status text, role_id uuid) language plpgsql security definer as $$
declare
  existing record;
  member_count int;
  admin_role_id uuid;
  new_status text;
  new_role_id uuid;
begin
  select wm.status as s, wm.role_id as r into existing from workspace_members wm
    where wm.workspace_id = ws_id and wm.user_id = auth.uid();
  if found then
    return query select existing.s, existing.r;
    return;
  end if;

  select count(*) into member_count from workspace_members where workspace_id = ws_id;
  if member_count = 0 then
    select id into admin_role_id from roles where workspace_id = ws_id and nome = 'admin';
    new_status := 'active';
    new_role_id := admin_role_id;
  else
    new_status := 'pending';
    new_role_id := null;
  end if;

  insert into workspace_members (workspace_id, user_id, role_id, status)
  values (ws_id, auth.uid(), new_role_id, new_status);

  return query select new_status, new_role_id;
end;
$$;

grant execute on function ensure_workspace_membership(uuid) to authenticated;
