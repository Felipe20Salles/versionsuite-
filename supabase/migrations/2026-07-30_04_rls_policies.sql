-- 2026-07-30_04_rls_policies.sql  (NÃO RODAR AINDA — só na Task 14, depois do client novo validado em produção)

create or replace function is_workspace_member(ws_id uuid, only_active boolean default true)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
    and (not only_active or status = 'active')
  )
$$;

create or replace function shares_workspace_with(other_user_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from workspace_members wm1
    join workspace_members wm2 on wm1.workspace_id = wm2.workspace_id
    where wm1.user_id = auth.uid() and wm2.user_id = other_user_id and wm1.status = 'active'
  )
$$;

create or replace function is_workspace_admin(ws_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from workspace_members wm join roles r on r.id = wm.role_id
    where wm.workspace_id = ws_id and wm.user_id = auth.uid()
    and wm.status = 'active' and r.workspace_id = ws_id and r.nome = 'admin'
  )
$$;

alter table oss enable row level security;
alter table versoes enable row level security;
alter table produtos enable row level security;
alter table pontos enable row level security;
alter table publicacoes enable row level security;
alter table equipes enable row level security;
alter table roles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table profiles enable row level security;

-- Reconciliação com produção (checada ao vivo em 2026-08-10 via pg_policies):
-- produção já tinha RLS habilitado + policies próprias nestas mesmas tabelas, criadas
-- antes deste projeto (achado da Task 5 / workspaces_preexistente_rls). Essas policies
-- antigas NÃO checam workspace_id — em Postgres, múltiplas policies permissivas no
-- mesmo comando são combinadas com OR, então sem este DROP as policies antigas
-- continuariam liberando acesso cross-workspace mesmo depois das novas serem criadas
-- (a isolação ficaria furada na prática, embora pareça aplicada). "Update Roles" (a
-- mais grave — UPDATE público, sem exigir nem autenticação) já foi corrigida à parte,
-- fora desta migração, por ser urgente demais pra esperar a Task 14 completa.
drop policy if exists "Admins gerenciam equipes" on equipes;
drop policy if exists "Usuarios autenticados leem equipes" on equipes;
drop policy if exists oss_select on oss;
drop policy if exists oss_insert on oss;
drop policy if exists oss_update on oss;
drop policy if exists oss_delete on oss;
drop policy if exists "Usuarios e gestores veem pontos" on pontos;
drop policy if exists pontos_insert on pontos;
drop policy if exists pontos_update on pontos;
drop policy if exists pontos_delete on pontos;
drop policy if exists produtos_select on produtos;
drop policy if exists produtos_insert on produtos;
drop policy if exists produtos_update on produtos;
drop policy if exists produtos_delete on produtos;
drop policy if exists pub_select on publicacoes;
drop policy if exists pub_insert on publicacoes;
drop policy if exists pub_update on publicacoes;
drop policy if exists pub_delete on publicacoes;
drop policy if exists versoes_select on versoes;
drop policy if exists versoes_insert on versoes;
drop policy if exists versoes_update on versoes;
drop policy if exists versoes_delete on versoes;
drop policy if exists roles_read_authenticated on roles;
drop policy if exists "Update Roles" on roles;
drop policy if exists "Admins podem atualizar qualquer profile" on profiles;
drop policy if exists profiles_select_authenticated on profiles;
-- profiles_select (nome antigo, auth.uid()=id) é recriado mais abaixo sob o mesmo nome
-- com drop-if-exists — não precisa de drop separado aqui. profiles_update (nome antigo)
-- já tem a mesma condição (auth.uid()=id) da profiles_update_own nova, então não é um
-- buraco de isolamento, mas o nome mudou — sem este drop ficaria uma policy órfã
-- redundante em produção.
drop policy if exists profiles_update on profiles;

-- Todo `create policy`/`create trigger` abaixo é precedido de `drop ... if exists`:
-- este arquivo é aplicado em lote no SQL editor e um único nome duplicado aborta e
-- reverte a transação inteira (foi exatamente o que aconteceu no incidente da Task 5).
drop policy if exists oss_isolation on oss;
create policy oss_isolation on oss for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists versoes_isolation on versoes;
create policy versoes_isolation on versoes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists produtos_isolation on produtos;
create policy produtos_isolation on produtos for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists pontos_isolation on pontos;
create policy pontos_isolation on pontos for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists publicacoes_isolation on publicacoes;
create policy publicacoes_isolation on publicacoes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists equipes_isolation on equipes;
create policy equipes_isolation on equipes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

drop policy if exists roles_select on roles;
create policy roles_select on roles for select using (is_workspace_member(workspace_id));
drop policy if exists roles_write on roles;
create policy roles_write on roles for all using (
  is_workspace_admin(workspace_id)
) with check (
  is_workspace_admin(workspace_id)
);

-- DEFEITO CONHECIDO — resolvido em 2026-08-08_01: workspaces fica DE PROPÓSITO sem
-- nenhuma policy de select. O client não lê a tabela diretamente — resolveCurrentWorkspace()
-- usa a RPC security definer get_workspace_id_by_slug(), que ignora RLS e não exige
-- membership prévia (é o que evita o deadlock de um usuário novo não conseguir nem
-- descobrir o workspace pra pedir acesso). Confirmado ao vivo em produção em 2026-08-10:
-- workspaces já está com rls_ligado=true e 0 policies — não recriar workspaces_select aqui,
-- isso reabriria o deadlock que 2026-08-08_01 já fechou.
drop policy if exists workspaces_select on workspaces;

-- Estas duas já foram aplicadas isoladamente por 2026-08-08_01 (mesmas definições).
drop policy if exists workspace_members_select on workspace_members;
create policy workspace_members_select on workspace_members for select using (
  user_id = auth.uid() or is_workspace_member(workspace_id)
);
drop policy if exists workspace_members_admin_update on workspace_members;
create policy workspace_members_admin_update on workspace_members for update using (
  is_workspace_admin(workspace_id)
) with check (
  is_workspace_admin(workspace_id)
);

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid() or shares_workspace_with(id)
);
drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles for update using (
  exists (select 1 from workspace_members wm where wm.user_id = profiles.id and is_workspace_admin(wm.workspace_id))
) with check (
  exists (select 1 from workspace_members wm where wm.user_id = profiles.id and is_workspace_admin(wm.workspace_id))
);

create or replace function prevent_self_privilege_escalation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id = auth.uid() and (
    (new.gestor_geral is true and old.gestor_geral is not true)
    or (new.role is not null and new.role is distinct from old.role)
  ) then
    raise exception 'Você não pode alterar seu próprio gestor_geral/role — peça a outro admin.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_self_escalation on profiles;
create trigger profiles_prevent_self_escalation
before update on profiles
for each row execute function prevent_self_privilege_escalation();
