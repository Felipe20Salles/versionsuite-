-- 2026-08-20_01_workspace_creators.sql
--
-- Allowlist de e-mails autorizados a criar workspace novo (Fase 2a).
-- Sem FK para profiles/auth.users: o e-mail pode ser cadastrado antes da
-- pessoa nunca ter logado. Gestão é manual via SQL Editor do Supabase.

create table workspace_creators (
  email text primary key
);

-- Sem policy de propósito: a tabela só é lida pelas RPCs security definer
-- bootstrap_login() e create_workspace() (2026-08-20_02/_03), nunca por
-- SELECT direto do client — mesmo padrão já usado em `workspaces`
-- (2026-08-08_01_workspace_minimal_access.sql).
alter table workspace_creators enable row level security;
