-- 2026-08-08_04_ensure_membership_search_path.sql
--
-- ensure_workspace_membership (2026-07-30_03, já aplicada em produção) é
-- `security definer` com `set search_path = public` — sem `pg_temp` explícito.
-- Nesse caso o pg_temp do chamador entra implicitamente na frente do search_path e
-- uma tabela temporária criada pelo chamador (ex.: `create temp table roles(...)`)
-- pode sombrear as relações usadas no corpo da função. Pinar `public, pg_temp`
-- empurra o schema temporário para o fim.
--
-- `alter function ... set search_path` não recria o corpo — é seguro e idempotente.

alter function ensure_workspace_membership(uuid) set search_path = public, pg_temp;

-- Verificação:
-- select p.proname, p.proconfig, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'ensure_workspace_membership';
-- proconfig esperado: {"search_path=public, pg_temp"}
