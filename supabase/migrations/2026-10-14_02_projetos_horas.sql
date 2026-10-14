-- 2026-10-14_02_projetos_horas.sql
-- Horas apropriadas das OSs de projetos, somadas entre TODAS as pessoas do workspace,
-- sem expor de quem é cada hora (o client só carrega o próprio ponto).
-- Uma apropriação com detalhamento por atividade vira uma linha por atividade;
-- sem detalhamento, vira uma linha com activity_type_id nulo.

create or replace function projeto_horas_agregadas(p_projeto_id uuid)
returns table(data date, activity_type_id text, horas numeric)
language sql security definer set search_path = public, pg_temp stable as $$
  with proj as (
    select workspace_id from projetos where id = p_projeto_id and is_workspace_member(workspace_id)
  ),
  ap as (
    select p.data::date as data, a
    from pontos p
    join proj on proj.workspace_id = p.workspace_id
    cross join lateral jsonb_array_elements(coalesce(p.apropriacoes, '[]'::jsonb)) a
    where (a->>'osId') in (select o.id::text from oss o where o.projeto_id = p_projeto_id)
  ),
  linhas as (
    select ap.data, b->>'activityTypeId' as activity_type_id, (b->>'horas')::numeric as horas
    from ap cross join lateral jsonb_array_elements(ap.a->'breakdown') b
    where jsonb_typeof(ap.a->'breakdown') = 'array'
    union all
    select ap.data, null, (ap.a->>'horas')::numeric
    from ap
    where coalesce(jsonb_typeof(ap.a->'breakdown'), 'null') <> 'array'
       or jsonb_array_length(ap.a->'breakdown') = 0
  )
  select l.data, l.activity_type_id, sum(l.horas) from linhas l group by 1, 2 order by 1
$$;
revoke execute on function projeto_horas_agregadas(uuid) from public;
grant execute on function projeto_horas_agregadas(uuid) to authenticated;

create or replace function projetos_horas_totais(p_workspace_id uuid)
returns table(projeto_id uuid, horas numeric)
language sql security definer set search_path = public, pg_temp stable as $$
  select o.projeto_id, sum((a->>'horas')::numeric)
  from pontos p
  cross join lateral jsonb_array_elements(coalesce(p.apropriacoes, '[]'::jsonb)) a
  join oss o on o.id::text = a->>'osId'
  where is_workspace_member(p_workspace_id)
    and p.workspace_id = p_workspace_id
    and o.workspace_id = p_workspace_id
    and o.projeto_id is not null
  group by o.projeto_id
$$;
revoke execute on function projetos_horas_totais(uuid) from public;
grant execute on function projetos_horas_totais(uuid) to authenticated;
