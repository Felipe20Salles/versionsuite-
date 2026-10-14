-- 2026-10-14_01_projetos.sql
-- Backlog de Projetos: tabelas, colunas novas em oss, RLS e fluxo padrão por workspace.
-- Idempotente (padrão do projeto): pode ser reaplicada inteira no SQL Editor.
-- Rodar como postgres (dono das tabelas). Spec: docs/superpowers/specs/2026-10-14-backlog-projetos-design.md

create table if not exists projeto_papeis (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  nome text not null,
  externo boolean not null default false,
  ordem int not null default 0
);

create table if not exists projeto_etapas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  papel_id uuid references projeto_papeis(id) on delete set null,
  tipos_atividade text[] not null default '{}',
  ativo boolean not null default true
);

create table if not exists projetos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  titulo text not null,
  descricao text,
  status text not null default 'ideia'
    check (status in ('ideia','avaliacao','aprovada','recusada','execucao','pausada','concluida','cancelada')),
  etapa_id uuid references projeto_etapas(id) on delete set null,
  nota_impacto smallint check (nota_impacto between 1 and 5),
  nota_urgencia smallint check (nota_urgencia between 1 and 5),
  nota_alinhamento smallint check (nota_alinhamento between 1 and 5),
  legal boolean not null default false,
  esforco_total_h numeric check (esforco_total_h >= 0),
  esforco_tamanho text check (esforco_tamanho in ('P','M','G','GG')),
  prioridade numeric,
  data_alvo date,
  pai_redmine text,
  sugerido_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists projetos_ws_idx on projetos(workspace_id);

create table if not exists projeto_etapa_config (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  projeto_id uuid not null references projetos(id) on delete cascade,
  etapa_id uuid not null references projeto_etapas(id) on delete cascade,
  horas_estimadas numeric not null default 0 check (horas_estimadas >= 0),
  pulada boolean not null default false,
  responsavel_user_id uuid references auth.users(id) on delete set null,
  responsavel_nome text,
  primary key (projeto_id, etapa_id)
);

create table if not exists projeto_eventos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  projeto_id uuid not null references projetos(id) on delete cascade,
  tipo text not null check (tipo in ('status','etapa','retorno','comentario','vinculo_os')),
  de text,
  para text,
  papel_id uuid references projeto_papeis(id) on delete set null,
  comentario text,
  autor_id uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists projeto_eventos_proj_idx on projeto_eventos(projeto_id, criado_em);

alter table oss add column if not exists projeto_id uuid references projetos(id) on delete set null;
alter table oss add column if not exists projeto_desvinculado boolean not null default false;
create index if not exists oss_projeto_idx on oss(projeto_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table projeto_papeis enable row level security;
alter table projeto_etapas enable row level security;
alter table projetos enable row level security;
alter table projeto_etapa_config enable row level security;
alter table projeto_eventos enable row level security;

-- Fluxo (papéis e etapas): todos leem, só admin escreve
drop policy if exists projeto_papeis_select on projeto_papeis;
create policy projeto_papeis_select on projeto_papeis for select using (is_workspace_member(workspace_id));
drop policy if exists projeto_papeis_write on projeto_papeis;
create policy projeto_papeis_write on projeto_papeis for all
  using (is_workspace_admin(workspace_id)) with check (is_workspace_admin(workspace_id));

drop policy if exists projeto_etapas_select on projeto_etapas;
create policy projeto_etapas_select on projeto_etapas for select using (is_workspace_member(workspace_id));
drop policy if exists projeto_etapas_write on projeto_etapas;
create policy projeto_etapas_write on projeto_etapas for all
  using (is_workspace_admin(workspace_id)) with check (is_workspace_admin(workspace_id));

-- Permissão "Gerir projetos" checada no banco (o client também checa com can(), mas
-- sem isto qualquer membro aprovaria/moveria projetos chamando a API direto).
create or replace function pode_gerir_projetos(ws_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from workspace_members wm join roles r on r.id = wm.role_id
    where wm.workspace_id = ws_id and wm.user_id = auth.uid() and wm.status = 'active'
      and r.workspace_id = ws_id
      and (r.nome = 'admin' or (r.permissoes->'acoes'->>'gerir_projetos') = 'true')
  )
$$;
revoke execute on function pode_gerir_projetos(uuid) from public, anon;
grant execute on function pode_gerir_projetos(uuid) to authenticated;

-- Projetos: membros leem e criam ideias (como autores); ninguém apaga.
-- Update: a policy isola por workspace e o trigger abaixo restringe O QUE cada um pode mudar.
drop policy if exists projetos_select on projetos;
create policy projetos_select on projetos for select using (is_workspace_member(workspace_id));
drop policy if exists projetos_insert on projetos;
create policy projetos_insert on projetos for insert
  with check (is_workspace_member(workspace_id) and sugerido_por = auth.uid() and status = 'ideia');
drop policy if exists projetos_update on projetos;
create policy projetos_update on projetos for update
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

-- Sem "Gerir projetos", um membro só pode:
--  (a) editar a própria ideia enquanto ela está em "Ideia";
--  (b) disparar as transições automáticas (Aprovada → Em execução com OS em andamento;
--      Concluída → Em execução com OS vinculada), sem mexer em mais nada.
-- auth.uid() nulo = SQL Editor/postgres: liberado.
create or replace function projetos_guarda_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or pode_gerir_projetos(old.workspace_id) then return new; end if;
  if new.workspace_id <> old.workspace_id or new.sugerido_por is distinct from old.sugerido_por
     or new.criado_em <> old.criado_em then
    raise exception 'Sem permissão para alterar este projeto.';
  end if;
  if old.status = 'ideia' and new.status = 'ideia' and old.sugerido_por = auth.uid()
     and new.etapa_id is not distinct from old.etapa_id then
    return new;
  end if;
  if new.status = 'execucao' and old.status in ('aprovada', 'concluida')
     and (new.titulo, new.descricao, new.nota_impacto, new.nota_urgencia, new.nota_alinhamento, new.legal,
          new.esforco_total_h, new.esforco_tamanho, new.data_alvo, new.pai_redmine)
         is not distinct from
         (old.titulo, old.descricao, old.nota_impacto, old.nota_urgencia, old.nota_alinhamento, old.legal,
          old.esforco_total_h, old.esforco_tamanho, old.data_alvo, old.pai_redmine)
     and (old.status = 'aprovada' or new.etapa_id is not distinct from old.etapa_id)
     and exists (select 1 from oss o where o.projeto_id = old.id
                 and (old.status = 'concluida' or o.status = 'andamento')) then
    return new;
  end if;
  raise exception 'Sem permissão para alterar este projeto (requer "Gerir projetos").';
end;
$$;
drop trigger if exists projetos_guarda_update on projetos;
create trigger projetos_guarda_update before update on projetos
  for each row execute function projetos_guarda_update();

-- Configuração por etapa (horas, responsável, pular): todos leem, só quem gere escreve
drop policy if exists projeto_etapa_config_rw on projeto_etapa_config;
drop policy if exists projeto_etapa_config_select on projeto_etapa_config;
create policy projeto_etapa_config_select on projeto_etapa_config for select using (is_workspace_member(workspace_id));
drop policy if exists projeto_etapa_config_write on projeto_etapa_config;
create policy projeto_etapa_config_write on projeto_etapa_config for all
  using (pode_gerir_projetos(workspace_id))
  with check (
    pode_gerir_projetos(workspace_id)
    and exists (select 1 from projetos p where p.id = projeto_id and p.workspace_id = projeto_etapa_config.workspace_id)
  );

-- Eventos: só leitura e inserção (histórico imutável). Comentário e vínculo: qualquer membro.
-- Status/etapa/retorno: quem gere, ou um evento que só registra o estado ATUAL do projeto
-- (o client grava o projeto antes do evento — é o caso das transições automáticas).
drop policy if exists projeto_eventos_select on projeto_eventos;
create policy projeto_eventos_select on projeto_eventos for select using (is_workspace_member(workspace_id));
drop policy if exists projeto_eventos_insert on projeto_eventos;
create policy projeto_eventos_insert on projeto_eventos for insert
  with check (
    is_workspace_member(workspace_id) and autor_id = auth.uid()
    and exists (select 1 from projetos p where p.id = projeto_id and p.workspace_id = projeto_eventos.workspace_id)
    and (
      tipo in ('comentario', 'vinculo_os')
      or pode_gerir_projetos(workspace_id)
      or (tipo = 'status' and para = (select p.status from projetos p where p.id = projeto_id))
      or (tipo in ('etapa', 'retorno') and para = (select p.etapa_id::text from projetos p where p.id = projeto_id))
    )
  );

-- ── Fluxo padrão ─────────────────────────────────────────────────────────────
create or replace function seed_projeto_fluxo(ws_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p_analista uuid; p_cliente uuid; p_dev uuid; p_testador uuid;
begin
  if exists (select 1 from projeto_etapas where workspace_id = ws_id) then return; end if;
  insert into projeto_papeis (workspace_id, nome, externo, ordem) values (ws_id, 'Analista', false, 1) returning id into p_analista;
  insert into projeto_papeis (workspace_id, nome, externo, ordem) values (ws_id, 'Cliente', true, 2) returning id into p_cliente;
  insert into projeto_papeis (workspace_id, nome, externo, ordem) values (ws_id, 'Desenvolvedor', false, 3) returning id into p_dev;
  insert into projeto_papeis (workspace_id, nome, externo, ordem) values (ws_id, 'Testador', false, 4) returning id into p_testador;
  insert into projeto_etapas (workspace_id, nome, ordem, papel_id) values
    (ws_id, 'Especificação', 1, p_analista),
    (ws_id, 'Aprovação da especificação', 2, p_cliente),
    (ws_id, 'Desenvolvimento', 3, p_dev),
    (ws_id, 'Validação', 4, p_testador),
    (ws_id, 'Implantação', 5, p_analista);
end;
$$;
-- No Supabase, `from public` não basta: anon/authenticated recebem execute por default privileges
revoke execute on function seed_projeto_fluxo(uuid) from public, anon, authenticated;

select seed_projeto_fluxo(id) from workspaces;

-- create_workspace (2026-08-20_03) passa a criar o fluxo padrão junto
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

  perform seed_projeto_fluxo(new_ws_id);

  return new_ws_id;
end;
$$;

revoke execute on function create_workspace(text, text) from public;
grant execute on function create_workspace(text, text) to authenticated;
