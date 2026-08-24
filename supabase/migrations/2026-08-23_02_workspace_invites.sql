-- 2026-08-23_02_workspace_invites.sql
--
-- Convite por e-mail (Fase 2b): admin do workspace pré-cadastra um e-mail +
-- role; quando essa pessoa loga pela primeira vez com esse e-mail, entra
-- direto ativa (ver claim_invite(), 2026-08-23_03). Sem coluna de status —
-- a linha existe enquanto o convite está pendente, some ao ser aceita ou
-- cancelada.

create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  email text not null,
  role_id uuid not null references roles(id),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

alter table workspace_invites enable row level security;

-- Gerenciado direto pelo client (sem RPC pra criar/listar/cancelar) — só
-- admin do workspace mexe nos convites do próprio workspace. Mesmo padrão
-- de roles_write/equipes_isolation (2026-07-30_04_rls_policies.sql).
create policy workspace_invites_admin_all on workspace_invites for all
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
