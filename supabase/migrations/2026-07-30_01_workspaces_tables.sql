-- 2026-07-30_01_workspaces_tables.sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- user_id referencia public.profiles(id), não auth.users(id): profiles.id é sempre
-- igual ao id do auth.users correspondente (garantido pelo trigger + upsertCurrentUserProfile,
-- que roda antes de qualquer insert em workspace_members), e é essa FK que permite ao
-- PostgREST fazer o embedding `workspace_members.select('profiles(...)')` usado na Task 9 —
-- embedding automático só funciona quando existe uma FK declarada entre as duas tabelas.
create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references profiles(id),
  role_id uuid references roles(id),
  status text not null default 'pending' check (status in ('pending','active','rejected')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- Edite 'Minha Empresa' para o nome real da empresa antes de rodar em produção.
insert into workspaces (nome, slug) values ('Minha Empresa', 'default');
