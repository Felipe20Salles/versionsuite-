-- 2026-08-08_01_workspace_minimal_access.sql
--
-- Destrava o acesso mínimo a workspaces/workspace_members.
--
-- Contexto: 2026-07-30_01 criou as duas tabelas; durante a aplicação parcial (revertida)
-- de 2026-07-30_04 a RLS ficou HABILITADA nas duas em produção, mas nenhuma policy foi
-- criada. Resultado: todo SELECT/UPDATE do client nessas tabelas volta vazio hoje
-- (confirmado via pg_class.relrowsecurity = true + pg_policies sem nenhuma linha).
--
-- Esta migração é ADITIVA e mínima:
--   * NÃO toca em 2026-07-30_04 (que segue inerte, para a Task 14);
--   * NÃO cria as policies de isolamento das 7 tabelas de domínio nem de profiles;
--   * NÃO mexe nas policies pré-existentes de produção.
--
-- É idempotente: pode ser rodada mais de uma vez sem erro.

-- ── Helpers ───────────────────────────────────────────────────────────────────
-- Todos são `security definer` com search_path pinado em `public, pg_temp`
-- (correção validada na revisão da Task 4: sem pg_temp explícito, uma tabela
-- temporária criada pelo chamador poderia sombrear nomes de relação no corpo).
-- Assumem que o owner das funções é o mesmo owner das tabelas (postgres, quando
-- rodadas pelo SQL editor do Supabase) — é isso que faz o security definer
-- realmente ignorar a RLS de workspaces/workspace_members/roles.

-- Resolve o workspace por slug sem exigir NENHUMA policy de SELECT em workspaces
-- e — de propósito — sem exigir que o chamador já seja membro. É o que permite a
-- um usuário recém-criado descobrir o workspace para então pedir acesso via
-- ensure_workspace_membership(). Ver comentário sobre workspaces_select em
-- 2026-07-30_04_rls_policies.sql.
create or replace function get_workspace_id_by_slug(ws_slug text)
returns uuid language sql security definer set search_path = public, pg_temp stable as $$
  select id from workspaces where slug = ws_slug
$$;

revoke execute on function get_workspace_id_by_slug(text) from public;
grant execute on function get_workspace_id_by_slug(text) to authenticated;

-- Cópias (não movimentação) dos helpers já corrigidos em 2026-07-30_04_rls_policies.sql.
-- Aquele arquivo continua contendo as mesmas definições; `create or replace` torna a
-- duplicação inofensiva quando a Task 14 rodar a migração 4.
create or replace function is_workspace_member(ws_id uuid, only_active boolean default true)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
    and (not only_active or status = 'active')
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

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Já estão habilitadas em produção; repetido aqui para que um replay do zero
-- (DR / staging) chegue no mesmo estado.
alter table workspaces enable row level security;
alter table workspace_members enable row level security;

-- Grants explícitos: em teoria já cobertos pelos default privileges do Supabase
-- para o schema public, mas são baratos e evitam que a RLS "funcione" e o grant não.
grant select, update on table workspace_members to authenticated;

-- workspaces fica SEM policy de propósito: o client resolve o id via
-- get_workspace_id_by_slug() e nunca faz SELECT direto na tabela.

drop policy if exists workspace_members_select on workspace_members;
create policy workspace_members_select on workspace_members for select using (
  user_id = auth.uid() or is_workspace_member(workspace_id)
);

-- Necessária porque approveUser/rejectUser/saveUserRole/saveEditUserModal fazem
-- .update() direto em workspace_members a partir do client. Sem ela essas escritas
-- viram no-op silencioso.
drop policy if exists workspace_members_admin_update on workspace_members;
create policy workspace_members_admin_update on workspace_members for update using (
  is_workspace_admin(workspace_id)
) with check (
  is_workspace_admin(workspace_id)
);

-- Sem policy de INSERT em workspace_members de propósito: a entrada de novos
-- membros passa só pela RPC `ensure_workspace_membership` (security definer, que
-- ignora RLS por design — ver nota da Task 3 no plano).
