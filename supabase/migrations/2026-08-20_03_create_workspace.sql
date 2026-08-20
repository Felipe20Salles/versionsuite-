-- 2026-08-20_03_create_workspace.sql
--
-- Cria um workspace novo de forma atômica: workspace + role admin + membership
-- do criador, tudo numa function (uma transação), evitando a condição de
-- corrida documentada no bootstrap de ensure_workspace_membership (Fase 1):
-- aqui não há count() separado do insert, o criador é sempre o único membro.

create or replace function create_workspace(nome text, slug text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_ws_id uuid;
  admin_role_id uuid;
begin
  if not exists(select 1 from workspace_creators where email = auth.jwt()->>'email') then
    raise exception 'Você não tem permissão para criar workspaces.';
  end if;

  insert into workspaces (nome, slug, created_by)
  values (nome, slug, auth.uid())
  returning id into new_ws_id;

  insert into roles (nome, label, permissoes, workspace_id)
  values ('admin', 'Admin', '{"acoes":{},"menus":{}}'::jsonb, new_ws_id)
  returning id into admin_role_id;

  insert into workspace_members (workspace_id, user_id, role_id, status)
  values (new_ws_id, auth.uid(), admin_role_id, 'active');

  return new_ws_id;
end;
$$;

revoke execute on function create_workspace(text, text) from public;
grant execute on function create_workspace(text, text) to authenticated;
