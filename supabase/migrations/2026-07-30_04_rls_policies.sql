-- 2026-07-30_04_rls_policies.sql  (NÃO RODAR AINDA — só na Task 14, depois do client novo validado em produção)

create or replace function is_workspace_member(ws_id uuid, only_active boolean default true)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
    and (not only_active or status = 'active')
  )
$$;

create or replace function shares_workspace_with(other_user_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from workspace_members wm1
    join workspace_members wm2 on wm1.workspace_id = wm2.workspace_id
    where wm1.user_id = auth.uid() and wm2.user_id = other_user_id and wm1.status = 'active'
  )
$$;

create or replace function is_workspace_admin(ws_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from workspace_members wm join roles r on r.id = wm.role_id
    where wm.workspace_id = ws_id and wm.user_id = auth.uid()
    and wm.status = 'active' and r.workspace_id = ws_id and r.nome = 'admin'
  )
$$;

alter table oss enable row level security;
alter table versoes enable row level security;
alter table produtos enable row level security;
alter table pontos enable row level security;
alter table publicacoes enable row level security;
alter table equipes enable row level security;
alter table roles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table profiles enable row level security;

create policy oss_isolation on oss for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy versoes_isolation on versoes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy produtos_isolation on produtos for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy pontos_isolation on pontos for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy publicacoes_isolation on publicacoes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy equipes_isolation on equipes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy roles_select on roles for select using (is_workspace_member(workspace_id));
create policy roles_write on roles for all using (
  is_workspace_admin(workspace_id)
) with check (
  is_workspace_admin(workspace_id)
);

create policy workspaces_select on workspaces for select using (
  exists (select 1 from workspace_members where workspace_id = workspaces.id and user_id = auth.uid())
);

create policy workspace_members_select on workspace_members for select using (
  user_id = auth.uid() or is_workspace_member(workspace_id)
);
create policy workspace_members_admin_update on workspace_members for update using (
  is_workspace_admin(workspace_id)
) with check (
  is_workspace_admin(workspace_id)
);

create policy profiles_select on profiles for select using (
  id = auth.uid() or shares_workspace_with(id)
);
create policy profiles_insert_own on profiles for insert with check (id = auth.uid());
create policy profiles_update_own on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on profiles for update using (
  exists (select 1 from workspace_members wm where wm.user_id = profiles.id and is_workspace_admin(wm.workspace_id))
) with check (
  exists (select 1 from workspace_members wm where wm.user_id = profiles.id and is_workspace_admin(wm.workspace_id))
);

create or replace function prevent_self_privilege_escalation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id = auth.uid() and (
    (new.gestor_geral is true and old.gestor_geral is not true)
    or (new.role is not null and new.role is distinct from old.role)
  ) then
    raise exception 'Você não pode alterar seu próprio gestor_geral/role — peça a outro admin.';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_self_escalation
before update on profiles
for each row execute function prevent_self_privilege_escalation();
