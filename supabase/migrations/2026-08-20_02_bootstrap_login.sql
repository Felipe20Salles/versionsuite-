-- 2026-08-20_02_bootstrap_login.sql
--
-- Substitui resolveCurrentWorkspace() (que resolvia sempre o slug fixo
-- 'default') por uma resolução real de multi-tenant: lista os workspaces
-- do usuário logado e se ele pode criar um novo.

create or replace function bootstrap_login()
returns jsonb language sql security definer set search_path = public, pg_temp stable as $$
  select jsonb_build_object(
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'nome', w.nome, 'slug', w.slug, 'status', wm.status
      ))
      from workspace_members wm
      join workspaces w on w.id = wm.workspace_id
      where wm.user_id = auth.uid() and wm.status in ('active','pending')
    ), '[]'::jsonb),
    'can_create', exists(
      select 1 from workspace_creators where email = auth.jwt()->>'email'
    )
  )
$$;

revoke execute on function bootstrap_login() from public;
grant execute on function bootstrap_login() to authenticated;
