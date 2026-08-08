-- 2026-08-08_03_workspace_members_fk_ondelete.sql
--
-- workspace_members.user_id / .role_id foram declaradas em 2026-07-30_01 sem
-- ON DELETE, então herdaram NO ACTION: hoje apagar um usuário (profiles) ou um
-- role em produção falha com violação de FK.
--   user_id -> profiles(id): on delete cascade   (sai o usuário, sai a membership)
--   role_id -> roles(id)   : on delete set null  (sai o role, membership fica sem role)
--
-- Os nomes default do Postgres para essas FKs seriam workspace_members_user_id_fkey /
-- workspace_members_role_id_fkey (constraints inline sem nome em 2026-07-30_01), mas
-- em vez de confiar no nome a remoção é feita por DESCOBERTA em pg_constraint. Isso
-- evita o pior caso de um `drop constraint if exists` com nome errado: o drop não faz
-- nada, o add cria uma SEGUNDA FK na mesma coluna, a FK antiga continua bloqueando o
-- delete e o PostgREST passa a reclamar de relacionamento ambíguo no embedding
-- `workspace_members.select('profiles(...)')` usado na Task 9.
--
-- Idempotente.

do $$
declare
  r record;
begin
  -- FKs existentes de coluna única em user_id / role_id
  for r in
    select con.conname,
           (select a.attname from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) as col
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'workspace_members'
       and con.contype = 'f'
       and coalesce(array_length(con.conkey, 1), 0) = 1
       and (select a.attname from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) in ('user_id','role_id')
  loop
    execute format('alter table public.workspace_members drop constraint %I', r.conname);
    raise notice 'workspace_members: FK % (%) removida para recriacao', r.conname, r.col;
  end loop;

  alter table public.workspace_members
    add constraint workspace_members_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;

  alter table public.workspace_members
    add constraint workspace_members_role_id_fkey
    foreign key (role_id) references public.roles(id) on delete set null;
end $$;

-- Verificação:
-- select con.conname, con.confdeltype,
--        (select a.attname from pg_attribute a
--          where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) as coluna
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--  where rel.relname = 'workspace_members' and con.contype = 'f'
--  order by 3;
-- confdeltype esperado: user_id = 'c' (cascade), role_id = 'n' (set null),
--                       workspace_id/invited_by = 'a' (no action, inalteradas).
