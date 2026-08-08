-- 2026-08-08_02_unique_por_workspace.sql
--
-- Torna as chaves de upsert de `produtos` e `pontos` únicas POR WORKSPACE.
--
-- Problema: dbSalvarProduto() faz upsert com onConflict:'nome' e dbSalvarPonto()
-- com onConflict:'user_id,data'. A migração 2026-07-30_02 só adicionou a coluna
-- workspace_id — as chaves únicas antigas (globais) nunca foram tocadas. Com dois
-- workspaces, salvar um produto de mesmo nome sobrescreveria e sequestraria a linha
-- do outro workspace.
--
-- As tabelas `produtos` e `pontos` são anteriores a este repositório: NÃO existe
-- migração aqui que as tenha criado, então o nome real das constraints únicas em
-- produção é DESCONHECIDO. Por isso a remoção é feita por DESCOBERTA
-- (pg_constraint/pg_index), nunca por nome chutado.
--
-- Idempotente: rodar de novo não faz nada (as constraints antigas já não existem
-- e as novas são criadas só se ausentes).
--
-- ATENÇÃO (verificar ANTES de aplicar): rode o bloco de inspeção do final deste
-- arquivo primeiro. Se aparecer uma PRIMARY KEY de coluna única em produtos(nome)
-- ou uma PK em pontos(user_id,data), esta migração NÃO a remove (removê-la quebraria
-- FKs e a identidade das linhas) — ela apenas emite um `raise warning` e o problema
-- continua de pé, precisando de decisão manual.

-- ── produtos: unique(nome) → unique(workspace_id, nome) ───────────────────────
do $$
declare
  r record;
  dups int;
begin
  -- 1) Constraints únicas de coluna única sobre `nome`.
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'produtos'
       and con.contype = 'u'
       and coalesce(array_length(con.conkey, 1), 0) = 1
       and (
         select array_agg(a.attname order by a.attname)
           from pg_attribute a
          where a.attrelid = con.conrelid and a.attnum = any(con.conkey)
       ) = array['nome']::name[]
  loop
    execute format('alter table public.produtos drop constraint %I', r.conname);
    raise notice 'produtos: constraint unica % (nome) removida', r.conname;
  end loop;

  -- 2) Índices únicos "soltos" (criados via create unique index, sem constraint).
  --    PostgREST aceita esses índices em onConflict, então também precisam sair.
  for r in
    select ic.relname as idxname
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_class tc on tc.oid = i.indrelid
      join pg_namespace ns on ns.oid = tc.relnamespace
     where ns.nspname = 'public'
       and tc.relname = 'produtos'
       and i.indisunique
       and not i.indisprimary
       and i.indpred is null
       and i.indnkeyatts = 1
       and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
       and (
         select array_agg(a.attname order by a.attname)
           from pg_attribute a
          where a.attrelid = i.indrelid and a.attnum = any(i.indkey::smallint[])
       ) = array['nome']::name[]
  loop
    execute format('drop index public.%I', r.idxname);
    raise notice 'produtos: indice unico % (nome) removido', r.idxname;
  end loop;

  -- 3) PK de coluna única sobre `nome`: não removemos automaticamente.
  if exists (
    select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relname = 'produtos' and con.contype = 'p'
       and coalesce(array_length(con.conkey, 1), 0) = 1
       and (
         select array_agg(a.attname order by a.attname)
           from pg_attribute a
          where a.attrelid = con.conrelid and a.attnum = any(con.conkey)
       ) = array['nome']::name[]
  ) then
    raise warning 'produtos: a PRIMARY KEY e (nome) — ela continua impondo unicidade GLOBAL. Remover a PK exige decisao manual (FKs/identidade das linhas).';
  end if;

  -- 4) Nova constraint composta.
  if not exists (
    select 1 from pg_constraint
     where conname = 'produtos_workspace_id_nome_key'
       and conrelid = 'public.produtos'::regclass
  ) then
    select count(*) into dups from (
      select workspace_id, nome from public.produtos
       group by workspace_id, nome having count(*) > 1
    ) d;
    if dups > 0 then
      raise exception 'produtos: existem % pares (workspace_id, nome) duplicados — limpe os duplicados antes de rodar esta migracao', dups;
    end if;
    alter table public.produtos add constraint produtos_workspace_id_nome_key unique (workspace_id, nome);
    raise notice 'produtos: constraint produtos_workspace_id_nome_key (workspace_id, nome) criada';
  end if;
end $$;

-- ── pontos: unique(user_id, data) → unique(workspace_id, user_id, data) ───────
do $$
declare
  r record;
  dups int;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'pontos'
       and con.contype = 'u'
       and coalesce(array_length(con.conkey, 1), 0) = 2
       and (
         select array_agg(a.attname order by a.attname)
           from pg_attribute a
          where a.attrelid = con.conrelid and a.attnum = any(con.conkey)
       ) = array['data','user_id']::name[]
  loop
    execute format('alter table public.pontos drop constraint %I', r.conname);
    raise notice 'pontos: constraint unica % (user_id, data) removida', r.conname;
  end loop;

  for r in
    select ic.relname as idxname
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_class tc on tc.oid = i.indrelid
      join pg_namespace ns on ns.oid = tc.relnamespace
     where ns.nspname = 'public'
       and tc.relname = 'pontos'
       and i.indisunique
       and not i.indisprimary
       and i.indpred is null
       and i.indnkeyatts = 2
       and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
       and (
         select array_agg(a.attname order by a.attname)
           from pg_attribute a
          where a.attrelid = i.indrelid and a.attnum = any(i.indkey::smallint[])
       ) = array['data','user_id']::name[]
  loop
    execute format('drop index public.%I', r.idxname);
    raise notice 'pontos: indice unico % (user_id, data) removido', r.idxname;
  end loop;

  if exists (
    select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relname = 'pontos' and con.contype = 'p'
       and coalesce(array_length(con.conkey, 1), 0) = 2
       and (
         select array_agg(a.attname order by a.attname)
           from pg_attribute a
          where a.attrelid = con.conrelid and a.attnum = any(con.conkey)
       ) = array['data','user_id']::name[]
  ) then
    raise warning 'pontos: a PRIMARY KEY e (user_id, data) — ela continua impondo unicidade GLOBAL. Remover a PK exige decisao manual.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'pontos_workspace_id_user_id_data_key'
       and conrelid = 'public.pontos'::regclass
  ) then
    select count(*) into dups from (
      select workspace_id, user_id, data from public.pontos
       group by workspace_id, user_id, data having count(*) > 1
    ) d;
    if dups > 0 then
      raise exception 'pontos: existem % trios (workspace_id, user_id, data) duplicados — limpe os duplicados antes de rodar esta migracao', dups;
    end if;
    alter table public.pontos add constraint pontos_workspace_id_user_id_data_key unique (workspace_id, user_id, data);
    raise notice 'pontos: constraint pontos_workspace_id_user_id_data_key (workspace_id, user_id, data) criada';
  end if;
end $$;

-- ── Inspeção (rodar ANTES e DEPOIS, não faz parte da migração) ────────────────
-- select rel.relname as tabela, con.conname, con.contype,
--        (select array_agg(a.attname order by a.attnum)
--           from pg_attribute a
--          where a.attrelid = con.conrelid and a.attnum = any(con.conkey)) as colunas
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   join pg_namespace ns on ns.oid = rel.relnamespace
--  where ns.nspname = 'public' and rel.relname in ('produtos','pontos')
--    and con.contype in ('u','p')
--  order by 1, 2;
--
-- select tc.relname as tabela, ic.relname as indice, i.indisunique, i.indisprimary,
--        pg_get_indexdef(i.indexrelid) as definicao
--   from pg_index i
--   join pg_class ic on ic.oid = i.indexrelid
--   join pg_class tc on tc.oid = i.indrelid
--   join pg_namespace ns on ns.oid = tc.relnamespace
--  where ns.nspname = 'public' and tc.relname in ('produtos','pontos') and i.indisunique
--  order by 1, 2;
