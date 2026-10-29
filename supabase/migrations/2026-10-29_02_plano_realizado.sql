-- 2026-10-29_02_plano_realizado.sql
-- Plano de capacidade: realizado agregado por demanda (projeto), versão e tipo de atividade,
-- somado entre TODAS as pessoas do workspace (sem expor de quem é cada hora),
-- e marca de sincronização com o Redmine.
-- Considera apropriações de OSs com projeto_id não nulo, em qualquer status.

create or replace function plano_realizado(p_workspace_id uuid)
returns table(projeto_id uuid, versao_id uuid, activity_type_id text, horas numeric)
language sql security definer set search_path = public, pg_temp stable as $$
  with ap as (
    select o.projeto_id, p.versao_id, a
    from pontos p
    cross join lateral jsonb_array_elements(coalesce(p.apropriacoes, '[]'::jsonb)) a
    join oss o on o.id::text = a->>'osId'
    where is_workspace_member(p_workspace_id)
      and p.workspace_id = p_workspace_id
      and o.workspace_id = p_workspace_id
      and o.projeto_id is not null
  ),
  -- Valores de horas malformados contam 0 (não derrubam a função inteira)
  linhas as (
    select ap.projeto_id, ap.versao_id, b->>'activityTypeId' as activity_type_id, case when (b->>'horas') ~ '^-?[0-9]+(\.[0-9]+)?$' then (b->>'horas')::numeric else 0 end as horas
    from ap cross join lateral jsonb_array_elements(ap.a->'breakdown') b
    where jsonb_typeof(ap.a->'breakdown') = 'array'
    union all
    select ap.projeto_id, ap.versao_id, null, case when (ap.a->>'horas') ~ '^-?[0-9]+(\.[0-9]+)?$' then (ap.a->>'horas')::numeric else 0 end
    from ap
    where coalesce(jsonb_typeof(ap.a->'breakdown'), 'null') <> 'array'
       or jsonb_array_length(ap.a->'breakdown') = 0
  )
  select l.projeto_id, l.versao_id, l.activity_type_id, sum(l.horas)
  from linhas l
  group by 1, 2, 3
$$;
revoke execute on function plano_realizado(uuid) from public, anon;
grant execute on function plano_realizado(uuid) to authenticated;

create or replace function plano_marcar_sync(p_workspace_id uuid)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agora timestamptz := now();
begin
  if not pode_gerir_projetos(p_workspace_id) then
    raise exception 'sem permissão para marcar a sincronização do plano';
  end if;
  insert into plano_config (workspace_id, redmine_sync_em)
  values (p_workspace_id, v_agora)
  on conflict (workspace_id) do update set redmine_sync_em = excluded.redmine_sync_em;
  return v_agora;
end
$$;
revoke execute on function plano_marcar_sync(uuid) from public, anon;
grant execute on function plano_marcar_sync(uuid) to authenticated;

-- Verificação (rodar no SQL Editor de produção):
--   select * from plano_realizado('<workspace_id da Siacon>') limit 5;
-- Esperado: 0 linhas (no SQL Editor auth.uid() é nulo, então quem chama não é membro).
-- O caso de membro é verificado pelo console do app:
--   await sb.rpc('plano_realizado',{p_workspace_id:CURRENT_WORKSPACE_ID})
-- e a soma por projeto_id deve bater com projetos_horas_totais.
