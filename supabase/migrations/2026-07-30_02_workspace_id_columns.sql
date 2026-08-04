-- 2026-07-30_02_workspace_id_columns.sql
do $$
declare default_ws_id uuid;
begin
  select id into default_ws_id from workspaces where slug = 'default';
  if default_ws_id is null then
    raise exception 'Workspace com slug ''default'' não encontrado — rode 2026-07-30_01 primeiro';
  end if;

  alter table roles add column workspace_id uuid references workspaces(id);
  alter table equipes add column workspace_id uuid references workspaces(id);
  alter table produtos add column workspace_id uuid references workspaces(id);
  alter table versoes add column workspace_id uuid references workspaces(id);
  alter table oss add column workspace_id uuid references workspaces(id);
  alter table pontos add column workspace_id uuid references workspaces(id);
  alter table publicacoes add column workspace_id uuid references workspaces(id);

  update roles set workspace_id = default_ws_id where workspace_id is null;
  update equipes set workspace_id = default_ws_id where workspace_id is null;
  update produtos set workspace_id = default_ws_id where workspace_id is null;
  update versoes set workspace_id = default_ws_id where workspace_id is null;
  update oss set workspace_id = default_ws_id where workspace_id is null;
  update pontos set workspace_id = default_ws_id where workspace_id is null;
  update publicacoes set workspace_id = default_ws_id where workspace_id is null;

  alter table roles alter column workspace_id set not null;
  alter table equipes alter column workspace_id set not null;
  alter table produtos alter column workspace_id set not null;
  alter table versoes alter column workspace_id set not null;
  alter table oss alter column workspace_id set not null;
  alter table pontos alter column workspace_id set not null;
  alter table publicacoes alter column workspace_id set not null;
end $$;
