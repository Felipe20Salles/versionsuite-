-- 2026-07-30_05_cleanup_profiles_role.sql
--
-- Task 15 da Fase 1: remove a coluna legada profiles.role, agora que a Task 14
-- (RLS reconciliada com produção, 2026-07-30_04) já substituiu as policies antigas
-- que checavam essa coluna por policies baseadas em workspace_members/roles, e o
-- stopgap syncProfileRole() no client (index.html) foi removido nesta mesma sessão.
--
-- prevent_self_privilege_escalation() (criada em 2026-07-30_04) ainda referencia
-- new.role/old.role — sem este passo, o DROP COLUMN abaixo quebraria todo UPDATE em
-- profiles (não só de role) em runtime, porque NEW/OLD deixariam de ter esse campo.
create or replace function prevent_self_privilege_escalation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id = auth.uid() and new.gestor_geral is true and old.gestor_geral is not true then
    raise exception 'Você não pode alterar seu próprio gestor_geral — peça a outro admin.';
  end if;
  return new;
end;
$$;

alter table profiles drop column if exists role;
