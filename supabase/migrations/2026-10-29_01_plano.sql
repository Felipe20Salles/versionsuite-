-- 2026-10-29_01_plano.sql
-- Plano por capacidade: demandas (projetos com status novos), critérios, horas por papel,
-- capacidade por versão, linha de base, RLS e triggers.
-- Idempotente (padrão do projeto): pode ser reaplicada inteira no SQL Editor.
-- Rodar como postgres (dono das tabelas). Spec: docs/superpowers/specs/2026-10-28-plano-capacidade-design.md
--
-- Pré-checagem opcional (antes de rodar):
--   select status, count(*) from projetos group by 1 order by 1;
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid in ('projetos'::regclass, 'projeto_eventos'::regclass) and contype = 'c';

-- ── 1. Colunas e tabelas novas ───────────────────────────────────────────────
alter table projetos add column if not exists crit smallint[];
alter table projetos add column if not exists posicao numeric;
alter table projetos add column if not exists produto text;
alter table projetos add column if not exists solicitante text;
alter table projetos add column if not exists horas_papeis jsonb not null default '[]'::jsonb;
alter table projetos add column if not exists horas_origem text not null default 'vs';
alter table projetos add column if not exists horas_redmine jsonb;
alter table projetos add column if not exists decisao_obs text;
alter table projetos add column if not exists decidido_em timestamptz;
alter table projetos add column if not exists decidido_por uuid references auth.users(id) on delete set null;
alter table projetos add column if not exists entregue_em timestamptz;

alter table projetos drop constraint if exists projetos_horas_origem_check;
alter table projetos add constraint projetos_horas_origem_check check (horas_origem in ('vs', 'redmine'));
alter table projetos drop constraint if exists projetos_horas_papeis_check;
alter table projetos add constraint projetos_horas_papeis_check check (jsonb_typeof(horas_papeis) = 'array');

alter table projeto_papeis add column if not exists trackers text[] not null default '{}';
alter table projeto_papeis add column if not exists tipos_atividade text[] not null default '{}';
alter table projeto_papeis add column if not exists ativo boolean not null default true;

alter table versoes add column if not exists planejada boolean not null default false;

-- Nulos = padrão do cliente (configPlano)
create table if not exists plano_config (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  criterios jsonb,
  faixas_prioridade jsonb,
  faixas_esforco jsonb,
  papel_padrao_id uuid references projeto_papeis(id) on delete set null,
  redmine_sync_em timestamptz
);

create table if not exists versao_capacidade (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  versao_id uuid not null references versoes(id) on delete cascade,
  papel_id uuid not null references projeto_papeis(id) on delete cascade,
  horas numeric not null default 0 check (horas >= 0),
  primary key (versao_id, papel_id)
);
create index if not exists versao_capacidade_ws_idx on versao_capacidade(workspace_id);

create table if not exists plano_linha_base (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  versao_id uuid not null references versoes(id) on delete cascade,
  projeto_id uuid not null references projetos(id) on delete cascade,
  horas_previstas numeric not null,
  posicao numeric,
  criado_em timestamptz not null default now(),
  unique (versao_id, projeto_id)
);
create index if not exists plano_linha_base_ws_idx on plano_linha_base(workspace_id);

-- ── 2. Checks de status (projetos) e tipo (projeto_eventos) ──────────────────
-- Remove pelo nome padrão e também qualquer outro check que cite a coluna
-- (o nome real pode variar conforme como a tabela foi criada).
alter table projetos drop constraint if exists projetos_status_check;
alter table projeto_eventos drop constraint if exists projeto_eventos_tipo_check;
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tabela, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and ((c.conrelid = 'projetos'::regclass and pg_get_constraintdef(c.oid) ~ '\mstatus\M')
        or (c.conrelid = 'projeto_eventos'::regclass and pg_get_constraintdef(c.oid) ~ '\mtipo\M'))
  loop
    execute format('alter table %s drop constraint %I', r.tabela, r.conname);
  end loop;
end;
$$;

-- As atualizações de dados abaixo não devem disparar os triggers de projetos
-- (atualizado_em, posição automática). Reativados no fim da seção 4.
alter table projetos disable trigger user;

update projetos set status = case status
    when 'ideia' then 'triagem'
    when 'avaliacao' then 'pauta'
    when 'aprovada' then 'plano'
    when 'execucao' then 'plano'
    when 'pausada' then 'plano'
    when 'concluida' then 'entregue'
    when 'recusada' then 'descartada'
    when 'cancelada' then 'descartada'
  end
where status in ('ideia', 'avaliacao', 'aprovada', 'execucao', 'pausada', 'concluida', 'recusada', 'cancelada');

alter table projetos add constraint projetos_status_check
  check (status in ('triagem', 'pauta', 'plano', 'adiada', 'descartada', 'entregue'));
alter table projetos alter column status set default 'triagem';

alter table projeto_eventos add constraint projeto_eventos_tipo_check
  check (tipo in ('status', 'etapa', 'retorno', 'comentario', 'vinculo_os',
                  'decisao', 'criterios', 'posicao', 'entrega', 'horas'));

-- ── 3. Critérios: 4 pontos de 0 a 3 (cada um pode ser nulo) ──────────────────
alter table projetos drop constraint if exists projetos_crit_check;
alter table projetos add constraint projetos_crit_check
  check (crit is null or (cardinality(crit) = 4
         and 0 <= all(array_remove(crit, null)) and 3 >= all(array_remove(crit, null))));

-- ── 4. Migração de dados (idempotente) ───────────────────────────────────────
-- Tipos de atividade: das etapas ativas para o papel (só papéis internos ainda sem tipos;
-- papel externo não entra no realizado do plano)
update projeto_papeis pp set tipos_atividade = s.tipos
from (
  select e.papel_id, array_agg(distinct t order by t) as tipos
  from projeto_etapas e cross join lateral unnest(e.tipos_atividade) t
  where e.ativo and e.papel_id is not null
  group by e.papel_id
) s
where s.papel_id = pp.id and not pp.externo and pp.tipos_atividade = '{}';

-- Horas por papel: soma das horas estimadas das etapas, agrupada pelo papel (interno) da etapa
with h as (
  select c.projeto_id, e.papel_id, sum(c.horas_estimadas) as horas
  from projeto_etapa_config c
  join projeto_etapas e on e.id = c.etapa_id
  join projeto_papeis pp on pp.id = e.papel_id
  where not pp.externo
  group by c.projeto_id, e.papel_id
  having sum(c.horas_estimadas) > 0
), j as (
  select projeto_id, jsonb_agg(jsonb_build_object('papel_id', papel_id, 'horas', horas) order by papel_id) as arr
  from h group by projeto_id
)
update projetos p set horas_papeis = j.arr
from j
where j.projeto_id = p.id and p.horas_papeis = '[]'::jsonb;

-- Sem horas por etapa mas com esforço total: tudo no papel interno "Desenvolvedor"
-- (ou, sem ele, no papel interno de menor ordem)
update projetos p set horas_papeis = jsonb_build_array(jsonb_build_object(
    'papel_id', (select pp.id from projeto_papeis pp
                 where pp.workspace_id = p.workspace_id and not pp.externo
                 order by (pp.nome = 'Desenvolvedor') desc, pp.ordem, pp.id
                 limit 1),
    'horas', p.esforco_total_h))
where p.horas_papeis = '[]'::jsonb and p.esforco_total_h > 0
  and exists (select 1 from projeto_papeis pp where pp.workspace_id = p.workspace_id and not pp.externo);

-- Posição no plano: por prioridade antiga (maior primeiro), depois mais antiga.
-- Soma ao maior já existente no workspace para não colidir numa reaplicação.
with base as (
  select workspace_id, max(posicao) as maxpos from projetos where status = 'plano' group by workspace_id
), r as (
  select p.id, row_number() over (partition by p.workspace_id order by p.prioridade desc nulls last, p.criado_em, p.id) as rn
  from projetos p
  where p.status = 'plano' and p.posicao is null
)
update projetos p set posicao = coalesce(b.maxpos, 0) + r.rn
from r join base b on true
where r.id = p.id and b.workspace_id = p.workspace_id;

-- Posição só existe no plano
update projetos set posicao = null where status <> 'plano' and posicao is not null;

-- Entregues antigas: data de entrega aproximada pela última alteração
update projetos set entregue_em = coalesce(atualizado_em, criado_em)
where status = 'entregue' and entregue_em is null;

alter table projetos enable trigger user;

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
alter table plano_config enable row level security;
alter table versao_capacidade enable row level security;
alter table plano_linha_base enable row level security;

-- Configuração do plano: todos leem, só admin escreve
drop policy if exists plano_config_select on plano_config;
create policy plano_config_select on plano_config for select using (is_workspace_member(workspace_id));
drop policy if exists plano_config_write on plano_config;
create policy plano_config_write on plano_config for all
  using (is_workspace_admin(workspace_id))
  with check (
    is_workspace_admin(workspace_id)
    and (papel_padrao_id is null or exists (select 1 from projeto_papeis pp
          where pp.id = papel_padrao_id and pp.workspace_id = plano_config.workspace_id))
  );

-- Capacidade por versão e papel: todos leem, quem gere o plano escreve
drop policy if exists versao_capacidade_select on versao_capacidade;
create policy versao_capacidade_select on versao_capacidade for select using (is_workspace_member(workspace_id));
drop policy if exists versao_capacidade_write on versao_capacidade;
create policy versao_capacidade_write on versao_capacidade for all
  using (pode_gerir_projetos(workspace_id))
  with check (
    pode_gerir_projetos(workspace_id)
    and exists (select 1 from versoes v where v.id = versao_id and v.workspace_id = versao_capacidade.workspace_id)
    and exists (select 1 from projeto_papeis pp where pp.id = papel_id and pp.workspace_id = versao_capacidade.workspace_id)
  );

-- Linha de base: só leitura e inserção por quem gere (gravada ao iniciar a versão; não muda depois)
drop policy if exists plano_linha_base_select on plano_linha_base;
create policy plano_linha_base_select on plano_linha_base for select using (is_workspace_member(workspace_id));
drop policy if exists plano_linha_base_insert on plano_linha_base;
create policy plano_linha_base_insert on plano_linha_base for insert
  with check (
    pode_gerir_projetos(workspace_id)
    and exists (select 1 from versoes v
                where v.id = versao_id and v.workspace_id = plano_linha_base.workspace_id and v.ativa)
    and exists (select 1 from projetos p
                where p.id = projeto_id and p.workspace_id = plano_linha_base.workspace_id
                  and p.status in ('plano', 'entregue'))
  );

-- Demandas: membros criam em triagem, como autores, sem campos de decisão
drop policy if exists projetos_insert on projetos;
create policy projetos_insert on projetos for insert
  with check (
    is_workspace_member(workspace_id) and sugerido_por = auth.uid() and status = 'triagem'
    and crit is null and posicao is null and decidido_em is null
  );

-- Eventos: só leitura e inserção (histórico imutável). Quem gere insere qualquer tipo;
-- os demais membros só comentários e vínculos de OS coerentes com o estado real.
drop policy if exists projeto_eventos_insert on projeto_eventos;
create policy projeto_eventos_insert on projeto_eventos for insert
  with check (
    is_workspace_member(workspace_id) and autor_id = auth.uid()
    and exists (select 1 from projetos p where p.id = projeto_id and p.workspace_id = projeto_eventos.workspace_id)
    and (
      pode_gerir_projetos(workspace_id)
      or (tipo = 'comentario' and de is null and para is null)
      -- vínculo: a OS citada tem de estar mesmo vinculada (para) ou fora (de) deste projeto
      or (tipo = 'vinculo_os' and (
            (para is not null and de is null and exists (select 1 from oss o
               where o.projeto_id = projeto_eventos.projeto_id and 'os:' || o.num = projeto_eventos.para)
             and not exists (select 1 from projeto_eventos e
               where e.projeto_id = projeto_eventos.projeto_id and e.tipo = 'vinculo_os'
                 and e.para = projeto_eventos.para and e.criado_em > now() - interval '2 minutes'))
         or (de is not null and para is null and exists (select 1 from oss o
               where o.workspace_id = projeto_eventos.workspace_id and 'os:' || o.num = projeto_eventos.de
                 and o.projeto_id is distinct from projeto_eventos.projeto_id)
             and exists (select 1 from projeto_eventos e
               where e.projeto_id = projeto_eventos.projeto_id and e.tipo = 'vinculo_os'
                 and e.para = projeto_eventos.de))))
    )
  );

-- ── 6. Guarda de update ──────────────────────────────────────────────────────
-- Sem "Gerir o plano", um membro só edita a própria demanda enquanto ela está em triagem,
-- e só os campos da lista abaixo (lista de permitidos: coluna nova fica travada por padrão).
-- horas_origem entra porque o client grava 'vs' junto com as horas; o check limita os valores.
create or replace function projetos_guarda_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Sessão sem usuário da API (SQL Editor/postgres/service_role): liberado
  if (auth.uid() is null and current_user not in ('anon', 'authenticated'))
     or pode_gerir_projetos(old.workspace_id) then return new; end if;
  if old.sugerido_por = auth.uid() and old.status = 'triagem' and new.status = 'triagem'
     and (to_jsonb(new) - array['titulo', 'descricao', 'produto', 'solicitante',
                                'horas_papeis', 'horas_origem', 'atualizado_em'])
         = (to_jsonb(old) - array['titulo', 'descricao', 'produto', 'solicitante',
                                  'horas_papeis', 'horas_origem', 'atualizado_em']) then
    return new;
  end if;
  raise exception 'Sem permissão para alterar esta demanda (requer "Gerir o plano").';
end;
$$;
drop trigger if exists projetos_guarda_update on projetos;
create trigger projetos_guarda_update before update on projetos
  for each row execute function projetos_guarda_update();

-- ── 7. Normalização (substitui projetos_x_prioridade) ───────────────────────
-- A prioridade passa a ser calculada no cliente a partir de crit e dos pesos do workspace.
drop trigger if exists projetos_x_prioridade on projetos;
drop function if exists projetos_set_prioridade();
drop function if exists projeto_calc_prioridade(projetos);

create or replace function projetos_normaliza()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Relógio do servidor (a policy de eventos compara com now())
  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.atualizado_em := null;
    -- Pai do Redmine e campos de decisão/entrega são de quem gere
    -- (sessão sem usuário da API, como SQL Editor/importação, conta como quem gere)
    if not ((auth.uid() is null and current_user not in ('anon', 'authenticated'))
            or pode_gerir_projetos(new.workspace_id)) then
      new.pai_redmine := null;
      new.decisao_obs := null;
      new.decidido_por := null;
      new.entregue_em := null;
      -- Colunas antigas (fora da interface) também não vêm de quem não gere
      new.prioridade := null;
      new.etapa_id := null;
      new.data_alvo := null;
    end if;
  else
    new.atualizado_em := now();
  end if;

  -- Os 4 critérios preenchidos tiram a demanda da triagem
  if new.status = 'triagem' and new.crit is not null and cardinality(new.crit) = 4
     and array_position(new.crit, null) is null then
    new.status := 'pauta';
  end if;

  if jsonb_typeof(new.horas_papeis) = 'array'
     and exists (select 1 from jsonb_array_elements(new.horas_papeis) h where (h->>'horas')::numeric < 0) then
    raise exception 'Horas não podem ser negativas.';
  end if;

  -- Posição só existe no plano; ao (re)entrar sem posição, vai para o fim
  if new.status is distinct from 'plano' then
    new.posicao := null;
  end if;
  if new.status = 'plano' and new.posicao is null
     and (tg_op = 'INSERT' or old.status is distinct from 'plano') then
    new.posicao := coalesce((select max(p.posicao) from projetos p
                             where p.workspace_id = new.workspace_id and p.status = 'plano'), 0) + 1;
  end if;

  if new.status = 'entregue' then
    if tg_op = 'INSERT' then
      new.entregue_em := coalesce(new.entregue_em, now());
    elsif old.status is distinct from 'entregue' then
      new.entregue_em := now();
    end if;
  else
    new.entregue_em := null;
  end if;

  return new;
end;
$$;
-- Nome com "projetos_x" para disparar depois de projetos_guarda_update (ordem alfabética)
drop trigger if exists projetos_x_normaliza on projetos;
create trigger projetos_x_normaliza before insert or update on projetos
  for each row execute function projetos_normaliza();

-- ── Verificação (rodar depois e conferir) ────────────────────────────────────
-- select status, count(*), count(posicao) as com_posicao, count(*) filter (where horas_papeis <> '[]') as com_horas
--   from projetos group by 1 order by 1;
-- -- Esperado: só os 6 status novos; todo "plano" com posição.
-- select nome, externo, ativo, tipos_atividade from projeto_papeis order by workspace_id, ordem;
-- -- Esperado: Analista/Desenvolvedor/Testador com os tipos que estavam nas etapas.
-- select to_regclass('plano_config'), to_regclass('versao_capacidade'), to_regclass('plano_linha_base');
-- -- Esperado: os três nomes, nenhum nulo.
-- Depois, rode este arquivo de novo e confirme que não dá erro (idempotência).
