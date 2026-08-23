-- 2026-08-23_01_roles_unique_por_workspace.sql
--
-- create_workspace() (2026-08-20_03) insere um role 'admin' pra cada workspace novo,
-- mas roles_nome_key (UNIQUE (nome), pré-existente em produção -- nunca migrada pra
-- por-workspace como 2026-08-08_02 já fez com produtos/pontos) é GLOBAL: como a LG
-- já tem um role 'admin', a segunda tentativa de criar um role 'admin' em qualquer
-- workspace novo colide com ela. O client então mostra "Já existe um workspace com
-- esse identificador" (mapeia qualquer 23505 pra essa mensagem) -- enganoso, a
-- colisão real é em roles.nome, não em workspaces.slug.

do $$
declare
  dups int;
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'roles_nome_key' and conrelid = 'public.roles'::regclass
  ) then
    alter table public.roles drop constraint roles_nome_key;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'roles_workspace_id_nome_key' and conrelid = 'public.roles'::regclass
  ) then
    select count(*) into dups from (
      select workspace_id, nome from public.roles group by workspace_id, nome having count(*) > 1
    ) d;
    if dups > 0 then
      raise exception 'roles: existem % pares (workspace_id, nome) duplicados -- limpe antes de rodar esta migracao', dups;
    end if;
    alter table public.roles add constraint roles_workspace_id_nome_key unique (workspace_id, nome);
  end if;
end $$;
