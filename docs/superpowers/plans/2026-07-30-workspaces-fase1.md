# Workspaces Fase 1 (Fundação de Dados + RLS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir o conceito de workspace no banco (Supabase/Postgres) por trás das 7 tabelas de domínio existentes, com isolamento real via RLS, migrando os dados atuais para um único "workspace inicial" — sem nenhuma mudança visível no comportamento do app.

**Architecture:** Duas tabelas novas (`workspaces`, `workspace_members`); as 7 tabelas existentes (`roles`, `equipes`, `produtos`, `versoes`, `oss`, `pontos`, `publicacoes`) ganham `workspace_id`; `profiles` continua só identidade — papel e status de aprovação migram de `profiles.role`/`profiles.prefs.status` para `workspace_members.role_id`/`.status`. O client (`index.html`) resolve um `CURRENT_WORKSPACE_ID` fixo (slug `'default'`) no boot e passa a filtrar/gravar todas as queries por ele. RLS entra por último, depois do client novo já estar validado em produção sem RLS.

**Tech Stack:** Supabase (Postgres + Auth), SQL puro (sem ferramenta de migration — arquivos versionados manualmente em `supabase/migrations/`), JS vanilla inline em `index.html`, Netlify (deploy automático no push para `main`).

## Global Constraints

- Nenhuma mudança de UI visível ao usuário final nesta fase (spec: `docs/superpowers/specs/2026-07-30-workspaces-fase1-design.md`).
- `profiles.equipe_id` e `profiles.gestor_geral` **não** são tocados nesta fase — continuam campos de identidade globais, fora do escopo aprovado (só `role`/status de aprovação migram).
- Sem projeto de staging: toda validação de banco é feita em produção, em estágios, nunca misturando "aditivo" com "destrutivo" no mesmo script.
- Sem suíte de testes automatizada no repo — verificação via SQL (contagens) e via injeção de JS no navegador com Playwright MCP (mesma técnica já usada e validada nesta sessão para os fixes de filtro de produto e importação do Redmine).
- Toda operação que roda contra o banco de produção real, ou que faz deploy (`git push` para `main`, que a Netlify publica automaticamente), é um **checkpoint manual** — precisa da confirmação explícita do usuário antes de rodar, mesmo dentro de um plano "autônomo".

---

### Task 1: Migração SQL — tabelas `workspaces` e `workspace_members`

**Files:**
- Create: `supabase/migrations/2026-07-30_01_workspaces_tables.sql`

**Interfaces:**
- Produces: tabelas `workspaces(id,nome,slug,created_at,created_by)` e `workspace_members(id,workspace_id,user_id,role_id,status,invited_by,created_at)`, e uma linha semente em `workspaces` com `slug='default'`. Tasks seguintes dependem do slug `'default'` existir.

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
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
```

- [ ] **Step 2: Revisar a sintaxe**

Não há Postgres local neste projeto. Revisar manualmente: nomes de tabela/coluna batem com o resto do arquivo, tipos `uuid`/`timestamptz` corretos, `references roles(id)` é válido porque `roles` já existe hoje (só ganha `workspace_id` na Task 2).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-07-30_01_workspaces_tables.sql
git commit -m "feat: adiciona migração SQL de workspaces e workspace_members"
```

(Este script **não** é aplicado ao banco ainda — isso acontece no checkpoint manual da Task 5.)

---

### Task 2: Migração SQL — `workspace_id` nas 7 tabelas existentes

**Files:**
- Create: `supabase/migrations/2026-07-30_02_workspace_id_columns.sql`

**Interfaces:**
- Consumes: `workspaces` com slug `'default'` (Task 1).
- Produces: coluna `workspace_id uuid not null` em `roles`, `equipes`, `produtos`, `versoes`, `oss`, `pontos`, `publicacoes`, todas apontando para o workspace inicial.

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
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
```

- [ ] **Step 2: Revisar a sintaxe**

Confirmar que todos os 7 nomes de tabela estão corretos e que o bloco `do $$ ... end $$` está balanceado (um `alter`/`update` por tabela, na mesma ordem nas 3 seções).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-07-30_02_workspace_id_columns.sql
git commit -m "feat: adiciona migração SQL de workspace_id nas tabelas de dominio"
```

---

### Task 3: Migração SQL — backfill de `workspace_members` + função `ensure_workspace_membership`

**Files:**
- Create: `supabase/migrations/2026-07-30_03_backfill_members_and_rpc.sql`

**Interfaces:**
- Consumes: `roles.workspace_id` (Task 2), `profiles.role`/`profiles.prefs` (schema atual, ainda não alterado).
- Produces: uma linha em `workspace_members` por `profiles` existente; função RPC `ensure_workspace_membership(ws_id uuid) returns table(status text, role_id uuid)`, chamada pelo client na Task 7. Esta função precisa existir **antes** do deploy do client novo (Task 13), mesmo com RLS ainda desligado — por isso fica numa migração própria, separada da migração de RLS (Task 4).

> **Nota de segurança (ajuste em relação à spec original):** a spec dizia que `INSERT` em `workspace_members` ficaria bloqueado para o client nesta fase. Mas o client PRECISA conseguir criar a própria linha de membership no primeiro login (não existe fluxo de convite ainda — Fase 2). Se essa decisão ("sou o primeiro membro, viro admin" vs "sou pendente") for tomada em JS e só validada por uma policy de RLS simples, um usuário malicioso poderia tentar se inserir direto como `status:'active'` com o `role_id` de admin. Por isso a decisão é feita dentro desta função `security definer` — o client nunca insere em `workspace_members` diretamente, só chama a função. Isso preserva a intenção da spec (nenhum insert *direto* do client) resolvendo o caso real do primeiro login.

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- 2026-07-30_03_backfill_members_and_rpc.sql
do $$
declare default_ws_id uuid;
begin
  select id into default_ws_id from workspaces where slug = 'default';
  if default_ws_id is null then
    raise exception 'Workspace com slug ''default'' não encontrado — rode 2026-07-30_01 primeiro';
  end if;

  insert into workspace_members (workspace_id, user_id, role_id, status)
  select
    default_ws_id,
    p.id,
    r.id,
    case
      when p.role is not null then 'active'
      when coalesce(p.prefs->>'status','') = 'rejected' then 'rejected'
      else 'pending'
    end
  from profiles p
  left join roles r on r.workspace_id = default_ws_id and r.nome = p.role
  where not exists (
    select 1 from workspace_members wm where wm.workspace_id = default_ws_id and wm.user_id = p.id
  );
end $$;

create or replace function ensure_workspace_membership(ws_id uuid)
returns table(status text, role_id uuid) language plpgsql security definer as $$
declare
  existing record;
  member_count int;
  admin_role_id uuid;
  new_status text;
  new_role_id uuid;
begin
  select wm.status as s, wm.role_id as r into existing from workspace_members wm
    where wm.workspace_id = ws_id and wm.user_id = auth.uid();
  if found then
    return query select existing.s, existing.r;
    return;
  end if;

  select count(*) into member_count from workspace_members where workspace_id = ws_id;
  if member_count = 0 then
    select id into admin_role_id from roles where workspace_id = ws_id and nome = 'admin';
    new_status := 'active';
    new_role_id := admin_role_id;
  else
    new_status := 'pending';
    new_role_id := null;
  end if;

  insert into workspace_members (workspace_id, user_id, role_id, status)
  values (ws_id, auth.uid(), new_role_id, new_status);

  return query select new_status, new_role_id;
end;
$$;

grant execute on function ensure_workspace_membership(uuid) to authenticated;
```

- [ ] **Step 2: Query de verificação (rodar manualmente após aplicar, junto com o checkpoint da Task 5)**

```sql
select
  (select count(*) from profiles) as total_profiles,
  (select count(*) from workspace_members
     where workspace_id = (select id from workspaces where slug='default')) as total_members;
```

Esperado: os dois números batem.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-07-30_03_backfill_members_and_rpc.sql
git commit -m "feat: adiciona backfill de workspace_members e RPC ensure_workspace_membership"
```

---

### Task 4: Migração SQL — RLS (função + policies), não aplicada ainda

**Files:**
- Create: `supabase/migrations/2026-07-30_04_rls_policies.sql`

**Interfaces:**
- Consumes: `workspace_id` em todas as 7 tabelas (Task 2), `workspace_members` (Task 1/3).
- Produces: funções `is_workspace_member(ws_id uuid, only_active boolean default true)` e `shares_workspace_with(other_user_id uuid)`; RLS habilitado + policies nas 10 tabelas (7 de domínio + `workspaces`, `workspace_members`, `profiles`).

> **Ajuste em relação à spec original:** a spec não previa RLS em `profiles`. Sem isso, `loadUsers()` (que hoje busca todos os profiles sem filtro) vazaria nome/e-mail/avatar de usuários de OUTRAS empresas assim que existir mais de um workspace. A policy `profiles_select` abaixo resolve isso: só permite ver o próprio perfil ou o de alguém que compartilha um workspace ativo com você.

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- 2026-07-30_04_rls_policies.sql  (NÃO RODAR AINDA — só na Task 14, depois do client novo validado em produção)

create or replace function is_workspace_member(ws_id uuid, only_active boolean default true)
returns boolean language sql security invoker stable as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
    and (not only_active or status = 'active')
  )
$$;

create or replace function shares_workspace_with(other_user_id uuid)
returns boolean language sql security invoker stable as $$
  select exists (
    select 1 from workspace_members wm1
    join workspace_members wm2 on wm1.workspace_id = wm2.workspace_id
    where wm1.user_id = auth.uid() and wm2.user_id = other_user_id and wm1.status = 'active'
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

create policy oss_isolation on oss for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy versoes_isolation on versoes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy produtos_isolation on produtos for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy pontos_isolation on pontos for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy publicacoes_isolation on publicacoes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy equipes_isolation on equipes for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy roles_select on roles for select using (is_workspace_member(workspace_id));
create policy roles_write on roles for all using (
  exists (select 1 from workspace_members wm join roles r on r.id=wm.role_id
          where wm.workspace_id=roles.workspace_id and wm.user_id=auth.uid() and wm.status='active' and r.nome='admin')
) with check (
  exists (select 1 from workspace_members wm join roles r on r.id=wm.role_id
          where wm.workspace_id=roles.workspace_id and wm.user_id=auth.uid() and wm.status='active' and r.nome='admin')
);

create policy workspaces_select on workspaces for select using (
  exists (select 1 from workspace_members where workspace_id = workspaces.id and user_id = auth.uid())
);

create policy workspace_members_select on workspace_members for select using (
  user_id = auth.uid() or is_workspace_member(workspace_id)
);
create policy workspace_members_admin_update on workspace_members for update using (
  exists (select 1 from workspace_members wm join roles r on r.id=wm.role_id
          where wm.workspace_id=workspace_members.workspace_id and wm.user_id=auth.uid() and wm.status='active' and r.nome='admin')
) with check (
  exists (select 1 from workspace_members wm join roles r on r.id=wm.role_id
          where wm.workspace_id=workspace_members.workspace_id and wm.user_id=auth.uid() and wm.status='active' and r.nome='admin')
);

create policy profiles_select on profiles for select using (
  id = auth.uid() or shares_workspace_with(id)
);
create policy profiles_insert_own on profiles for insert with check (id = auth.uid());
create policy profiles_update_own on profiles for update using (id = auth.uid()) with check (id = auth.uid());
```

- [ ] **Step 2: Revisar a sintaxe**

Confirmar que toda tabela com `enable row level security` tem pelo menos uma policy de `select` (senão, sem policy nenhuma, RLS bloqueia tudo por padrão — inclusive para o dono). Conferir que `workspace_members` não tem policy de `insert` (proposital — só a função `security definer` da Task 3 insere).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-07-30_04_rls_policies.sql
git commit -m "feat: adiciona migração SQL de RLS para isolamento por workspace"
```

---

### Task 5: [CHECKPOINT MANUAL] Aplicar migrações 1–3 em produção

**Files:** nenhum (operação de banco, não de código)

**Interfaces:**
- Consumes: os 3 arquivos SQL das Tasks 1–3.
- Produces: schema de produção pronto para o client novo (Tasks 6–12), ainda sem RLS.

- [ ] **Step 1: Confirmar com o usuário antes de prosseguir**

Pedir confirmação explícita antes de tocar em produção. Perguntar o nome real da empresa para substituir `'Minha Empresa'` na Task 1 antes de rodar.

- [ ] **Step 2: Backup**

Pedir para o usuário rodar um dump manual do banco (Supabase Dashboard → Database → Backups, ou `pg_dump` via CLI) antes de qualquer alteração.

- [ ] **Step 3: Rodar as 3 migrações no SQL Editor do Supabase, em ordem**

`2026-07-30_01_workspaces_tables.sql` → `2026-07-30_02_workspace_id_columns.sql` → `2026-07-30_03_backfill_members_and_rpc.sql`.

- [ ] **Step 4: Rodar a query de verificação da Task 3 e confirmar as contagens**

Colar o resultado antes de prosseguir para a Task 6.

---

### Task 6: Client — `CURRENT_WORKSPACE_ID` e resolução no boot

**Files:**
- Modify: `index.html:5216-5217` (globais junto a `CURRENT_USER`/`CURRENT_ROLE`)

**Interfaces:**
- Produces: `var CURRENT_WORKSPACE_ID=null;` e `async function resolveCurrentWorkspace()` — usada pelas Tasks 7, 8, 11.

- [ ] **Step 1: Editar as globais**

Local atual (`index.html:5216-5217`):
```js
var CURRENT_USER=null;
var CURRENT_ROLE=null;
```
Nova versão:
```js
var CURRENT_USER=null;
var CURRENT_ROLE=null;
var CURRENT_WORKSPACE_ID=null;
async function resolveCurrentWorkspace(){
  var {data:ws,error}=await sb.from('workspaces').select('id').eq('slug','default').single();
  if(error||!ws)throw new Error('Workspace padrão não encontrado (slug "default"). Rode as migrações de workspaces.');
  CURRENT_WORKSPACE_ID=ws.id;
  return ws.id;
}
```

- [ ] **Step 2: Verificar via navegador (Playwright MCP)**

Subir um servidor estático local (`python -m http.server 8765` na raiz do repo), navegar até `http://localhost:8765/index.html`, entrar como Visitante (senha `visita2024`), e no console:

```js
await resolveCurrentWorkspace();
CURRENT_WORKSPACE_ID; // deve ser uma string uuid, não null/undefined
```

Isso só funciona **depois** da Task 5 ter aplicado as migrações em produção (a função consulta o Supabase real).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: adiciona resolução de CURRENT_WORKSPACE_ID"
```

---

### Task 7: Client — `upsertCurrentUserProfile()` usa `ensure_workspace_membership`

**Files:**
- Modify: `index.html:2183-2227`

**Interfaces:**
- Consumes: `CURRENT_WORKSPACE_ID` (Task 6), RPC `ensure_workspace_membership` (Task 3).
- Produces: `upsertCurrentUserProfile()` agora retorna o **status de membership** (`'active'|'pending'|'rejected'`) em vez do status do profile. Consumida pelas Task 11 (nos dois blocos de init).

- [ ] **Step 1: Editar a função**

Local atual (`index.html:2183-2227`) mantém a parte de identidade (nome/avatar/email/colorIdx), mas remove toda a lógica de `role`/`status` de `profiles` e delega para a RPC:

```js
async function upsertCurrentUserProfile(){
  if(!CURRENT_USER)return;
  var meta=CURRENT_USER.user_metadata||{};
  var displayName=meta.full_name||meta.name||CURRENT_USER.email||'Usuário';
  var avatar=meta.avatar_url||meta.picture||'';
  var email=CURRENT_USER.email||'';
  var {data:existing}=await sb.from('profiles').select('prefs').eq('id',CURRENT_USER.id).maybeSingle();
  var existPrefs=parsePrefs(existing?existing.prefs:null);
  var newPrefs=Object.assign({},existPrefs,{displayName:displayName,email:email});
  delete newPrefs.role;delete newPrefs.status;
  if(avatar)newPrefs.avatar=avatar;
  if(newPrefs.colorIdx===undefined)newPrefs.colorIdx=null;
  if(!existing){
    var {error:insertProfileError}=await sb.from('profiles').insert({id:CURRENT_USER.id,prefs:newPrefs});
    if(insertProfileError){
      var {error:retryProfileError}=await sb.from('profiles').update({prefs:newPrefs}).eq('id',CURRENT_USER.id);
      if(retryProfileError)throw retryProfileError;
    }
  }else{
    await sb.from('profiles').update({prefs:newPrefs}).eq('id',CURRENT_USER.id);
  }
  if(avatar)sb.from('profiles').update({avatar_url:avatar}).eq('id',CURRENT_USER.id).then(function(){}).catch(function(){});
  var {data:membership,error:memErr}=await sb.rpc('ensure_workspace_membership',{ws_id:CURRENT_WORKSPACE_ID});
  if(memErr)throw memErr;
  var row=Array.isArray(membership)?membership[0]:membership;
  return row?row.status:'pending';
}
```

- [ ] **Step 2: Verificar via navegador**

Com sessão de Visitante (que não passa por este fluxo) não dá para testar Google OAuth localmente. Verificar por leitura de código +, quando o deploy real acontecer (Task 13), conferir no Supabase Table Editor que um login real cria/atualiza a linha em `profiles` (sem `role` nem `status` no `prefs`) e uma linha correspondente em `workspace_members`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: upsertCurrentUserProfile passa a usar workspace_members via RPC"
```

---

### Task 8: Client — `load()` filtra pelo workspace e resolve o role via `workspace_members`

**Files:**
- Modify: `index.html:5358-5451` (função `load()`)

**Interfaces:**
- Consumes: `CURRENT_WORKSPACE_ID` (Task 6).
- Produces: `S.prefs.produtos`, `S.versoes`, `S.oss`, `S.pontos`, `S.publicacoes`, `S_ROLES`, `CURRENT_ROLE`, `CURRENT_ROLE_NAME` — mesmo contrato de antes, agora escopados por workspace.

- [ ] **Step 1: Editar os pontos de leitura dentro de `load()`**

Trecho de produtos (`index.html:5364`), roles (`5385`), versões (`5399`), OSs (`5406`), pontos (`5418`), publicações (`5427`) ganham `.eq('workspace_id',CURRENT_WORKSPACE_ID)`:

```js
var {data:prods}=await sb.from('produtos').select('*').eq('workspace_id',CURRENT_WORKSPACE_ID).order('nome');
...
var {data:rolesData,error:rolesErr}=await sb.from('roles').select('*').eq('workspace_id',CURRENT_WORKSPACE_ID);
...
var {data:versoes}=await sb.from('versoes').select('*').eq('workspace_id',CURRENT_WORKSPACE_ID).order('created_at',{ascending:false});
...
var {data:oss}=await sb.from('oss').select('*').eq('workspace_id',CURRENT_WORKSPACE_ID).order('created_at');
...
var {data:pontos}=await sb.from('pontos').select('*').eq('workspace_id',CURRENT_WORKSPACE_ID).eq('user_id',uid).order('data',{ascending:false});
...
var {data:pubs}=await sb.from('publicacoes').select('*').eq('workspace_id',CURRENT_WORKSPACE_ID).order('inicio');
```

O trecho de resolução de role (`index.html:5371`, `5391-5394`) muda de ler `profiles.role` para ler `workspace_members`:

Local atual:
```js
var {data:prof}=await sb.from('profiles').select('nome, prefs, role').eq('id',uid).single();
...
// Role vem exclusivamente da coluna direta; null = aguardando aprovação
var roleNome=(prof&&prof.role)||null;
CURRENT_ROLE_NAME=roleNome;
CURRENT_ROLE=roleNome?S_ROLES.find(function(r){return r.nome===roleNome})||null:null;
applyMenuPermissions();
```
Nova versão:
```js
var {data:prof}=await sb.from('profiles').select('nome, prefs').eq('id',uid).single();
...
// Role vem de workspace_members; null/'pending'/'rejected' = sem acesso
var {data:membership}=await sb.from('workspace_members').select('role_id, status').eq('workspace_id',CURRENT_WORKSPACE_ID).eq('user_id',uid).maybeSingle();
CURRENT_ROLE=(membership&&membership.status==='active'&&membership.role_id)?S_ROLES.find(function(r){return r.id===membership.role_id})||null:null;
CURRENT_ROLE_NAME=CURRENT_ROLE?CURRENT_ROLE.nome:null;
applyMenuPermissions();
```

Note que `S_ROLES` já foi carregado (escopado por workspace) antes deste trecho, então `S_ROLES.find` já opera só sobre os roles do workspace atual.

- [ ] **Step 2: Verificar via navegador**

Repetir o teste de injeção de estado já usado nesta sessão para o filtro de produto: como Visitante, popular `S.oss`/`S.versoes` manualmente (sem tocar no Supabase) e confirmar que `renderKanban()` continua funcionando — isso garante que a mudança de shape de `S` não quebrou o consumo posterior. Como o Visitante não passa por `load()`, o teste real de ponta a ponta do `load()` acontece no checkpoint da Task 13 (login real em produção).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: load() filtra tabelas por workspace_id e resolve role via workspace_members"
```

---

### Task 9: Client — `loadUsers()` e `loadEquipes()` escopados por workspace

**Files:**
- Modify: `index.html:1528-1569` (`loadUsers()`)
- Modify: `index.html:1579-1585` (`loadEquipes()`)

**Interfaces:**
- Consumes: `CURRENT_WORKSPACE_ID` (Task 6).
- Produces: `S_USERS` com o mesmo shape de hoje (`id,email,displayName,avatar,role,status,colorIdx,equipeId,gestorGeral,cargo,redmineUser`) — só a origem da query muda. Continua sendo consumido sem alteração por `renderUsersPrefs()`, `mkRoleCard()`, `saveEditUserModal()`, etc.

- [ ] **Step 1: Editar `loadUsers()`**

`profiles` não tem `workspace_id`, então o escopo vem de um join com `workspace_members`:

```js
async function loadUsers(){
  try{
    var {data:members}=await sb.from('workspace_members')
      .select('status, role_id, roles(nome), profiles(id,nome,email,avatar_url,prefs,equipe_id,gestor_geral)')
      .eq('workspace_id',CURRENT_WORKSPACE_ID);
    if(!members)return;
    S_USERS=members.filter(function(m){return m.profiles}).map(function(m){
      var p=m.profiles;
      var prefs=parsePrefs(p.prefs);
      return{
        id:p.id,
        email:p.email||prefs.email||'',
        displayName:p.nome||prefs.displayName||prefs.email||p.email||'Usuário',
        avatar:p.avatar_url||prefs.avatar||'',
        role:m.roles?m.roles.nome:null,
        status:m.status,
        colorIdx:prefs.colorIdx!==undefined?prefs.colorIdx:null,
        equipeId:p.equipe_id||null,
        gestorGeral:!!p.gestor_geral,
        cargo:prefs.cargo||'',
        redmineUser:prefs.redmineUser||''
      };
    });
    var usedIdx=S_USERS.filter(function(u){return u.colorIdx!==null}).map(function(u){return u.colorIdx});
    var next=0;
    S_USERS.forEach(function(u){
      if(u.colorIdx===null){
        while(usedIdx.indexOf(next)>-1)next++;
        u.colorIdx=next;usedIdx.push(next);next++;
      }
    });
    S_USERS.forEach(function(u){
      var key=(u.displayName||'').trim().split(' ')[0];
      if(key)_USER_COLOR_MAP[key]=u.colorIdx;
    });
    _USER_COLOR_NEXT=Math.max(S_USERS.length,_USER_COLOR_NEXT);
    seedUserColors(S.oss.map(function(o){return o.atribuicao||''}).filter(Boolean));
    updatePendingAccessUI();
  }catch(e){console.warn('loadUsers:',e);}
}
```

- [ ] **Step 2: Editar `loadEquipes()`**

```js
async function loadEquipes(){
  try{
    var {data,error}=await sb.from('equipes').select('id,nome,gestor_id').eq('workspace_id',CURRENT_WORKSPACE_ID);
    if(error)throw error;
    S_EQUIPES=(data||[]).map(function(e){return{id:e.id,nome:e.nome,gestorId:e.gestor_id};});
  }catch(e){console.warn('loadEquipes:',e);S_EQUIPES=[];}
}
```

- [ ] **Step 3: Verificar via navegador**

Como Visitante, injetar um `S_USERS` de exemplo e chamar `renderUsersPrefs()` (se acessível) ou pelo menos `updatePendingAccessUI()` para confirmar que nada quebrou no consumo do shape. O teste real (contagem de usuários batendo com a produção) acontece na Task 13.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: loadUsers/loadEquipes escopados por workspace_id"
```

---

### Task 10: Client — `approveUser`, `rejectUser`, `saveUserRole`, `saveEditUserModal` operam em `workspace_members`

**Files:**
- Modify: `index.html:1597-1613` (`saveUserRole`)
- Modify: `index.html:1632-1663` (`approveUser`, `rejectUser`)
- Modify: `index.html:1860-1877` (`saveEditUserModal`)

**Interfaces:**
- Consumes: `CURRENT_WORKSPACE_ID` (Task 6), `S_ROLES` já escopado (Task 8).
- Produces: mesmo comportamento observável (toasts, atualização de `S_USERS`), agora persistido em `workspace_members` em vez de `profiles`.

- [ ] **Step 1: Editar `saveUserRole`**

```js
async function saveUserRole(userId,newRole){
  var u=S_USERS.find(function(x){return x.id===userId});if(!u)return;
  var roleRow=S_ROLES.find(function(r){return r.nome===newRole});
  var {error}=await sb.from('workspace_members').update({role_id:roleRow?roleRow.id:null}).eq('workspace_id',CURRENT_WORKSPACE_ID).eq('user_id',userId);
  if(error){toast('Erro ao salvar role','err');return;}
  u.role=newRole;
  if(CURRENT_USER&&userId===CURRENT_USER.id){
    CURRENT_ROLE_NAME=newRole;
    CURRENT_ROLE=roleRow||null;
    applyMenuPermissions();
  }
  renderUsersPrefs();
  toast('Role atualizado!');
}
```

- [ ] **Step 2: Editar `approveUser` e `rejectUser`**

```js
async function approveUser(userId){
  if(!isAdmin()){toast('Apenas admins podem aprovar usuários','err');return}
  var u=S_USERS.find(function(x){return x.id===userId});if(!u)return;
  var visualizador=S_ROLES.find(function(r){return r.nome==='visualizador'});
  var {data:updated,error}=await sb.from('workspace_members').update({status:'active',role_id:visualizador?visualizador.id:null}).eq('workspace_id',CURRENT_WORKSPACE_ID).eq('user_id',userId).select('id');
  if(error){toast('Erro ao aprovar: '+error.message,'err');return}
  if(!updated||!updated.length){toast('Aprovação não persistida. Verifique a política UPDATE da tabela workspace_members.','err');return}
  u.status='active';
  u.role='visualizador';
  toast((u.displayName||u.email)+' aprovado ✓');
  renderUsersPrefs();
  renderPendingRequests();
  updatePendingAccessUI();
}
async function rejectUser(userId){
  if(!isAdmin()){toast('Apenas admins podem remover usuários','err');return}
  var u=S_USERS.find(function(x){return x.id===userId});if(!u)return;
  var ok=await modalConfirm('Recusar solicitação','Recusar a solicitação de <strong>'+escHtml(u.displayName||u.email)+'</strong>? O usuário continuará sem acesso à plataforma.','Recusar','btn-danger');
  if(!ok)return;
  var {data:updated,error}=await sb.from('workspace_members').update({status:'rejected',role_id:null}).eq('workspace_id',CURRENT_WORKSPACE_ID).eq('user_id',userId).select('id');
  if(error){toast('Erro: '+error.message,'err');return}
  if(!updated||!updated.length){toast('Recusa não persistida. Verifique a política UPDATE da tabela workspace_members.','err');return}
  u.status='rejected';
  u.role=null;
  toast('Solicitação recusada');
  renderUsersPrefs();
  renderPendingRequests();
  updatePendingAccessUI();
}
```

- [ ] **Step 3: Editar `saveEditUserModal`**

```js
async function saveEditUserModal(){
  if(!_editUserModalId)return;
  var u=S_USERS.find(function(x){return x.id===_editUserModalId});if(!u)return;
  var cargo=(document.getElementById('eud-cargo')||{}).value||'';
  var role=(document.getElementById('eud-role')||{}).value||u.role;
  var equipeId=(document.getElementById('eud-equipe')||{}).value||null;
  var gestorGeral=!!(document.getElementById('eud-gestor')||{}).checked;
  var redmineUser=(document.getElementById('eud-redmine-user')||{}).value||'';
  try{
    var {data:p}=await sb.from('profiles').select('prefs').eq('id',_editUserModalId).maybeSingle();
    var prefs=Object.assign({},parsePrefs(p?p.prefs:null));
    prefs.cargo=cargo;prefs.redmineUser=redmineUser;
    var {error}=await sb.from('profiles').update({equipe_id:equipeId||null,gestor_geral:gestorGeral,prefs:prefs}).eq('id',_editUserModalId);
    if(error)throw error;
    var roleRow=S_ROLES.find(function(r){return r.nome===role});
    var {error:roleErr}=await sb.from('workspace_members').update({role_id:roleRow?roleRow.id:null}).eq('workspace_id',CURRENT_WORKSPACE_ID).eq('user_id',_editUserModalId);
    if(roleErr)throw roleErr;
    u.role=role;u.equipeId=equipeId||null;u.gestorGeral=gestorGeral;u.cargo=cargo;u.redmineUser=redmineUser;
    closeModal('modal-edit-user');renderUsersPrefs();toast(u.displayName+' atualizado ✓');
  }catch(e){toast('Erro ao salvar: '+e.message,'err');}
}
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: approveUser/rejectUser/saveUserRole/saveEditUserModal operam em workspace_members"
```

---

### Task 11: Client — gatilho da tela de pendente nos dois blocos de init

**Files:**
- Modify: `index.html:8038-8104` (bloco `getSession()`)
- Modify: `index.html:8107-8151` (bloco `onAuthStateChange` / `SIGNED_IN`)
- Modify: `index.html:5258-5265` (`mostrarPendente()` — única definição viva; há uma declaração morta e não usada em `index.html:5244`, com o mesmo nome — não editar essa)

**Interfaces:**
- Consumes: `resolveCurrentWorkspace()` (Task 6), `upsertCurrentUserProfile()` retornando status de membership (Task 7).
- Produces: mesmo fluxo visível de hoje (`mostrarPendente()` / `mostrarApp()`), agora vindo de `workspace_members.status`.

- [ ] **Step 1: Editar o bloco `getSession()`**

Local atual (`index.html:8062-8072`):
```js
  if(session&&session.user){
    _appIniciado=true;
    CURRENT_USER=session.user;
    updateUserBadge(session.user);
    setLoadingMsg('Carregando dados...');
    var status=await upsertCurrentUserProfile();
    if(status!=='active'){mostrarPendente(session.user);return;}
    await load();
    applyPrefs();
    if(!CURRENT_ROLE_NAME){mostrarPendente();return;}
    mostrarApp();
```
Nova versão (adiciona `resolveCurrentWorkspace()` antes de tudo que depende de workspace):
```js
  if(session&&session.user){
    _appIniciado=true;
    CURRENT_USER=session.user;
    updateUserBadge(session.user);
    setLoadingMsg('Carregando dados...');
    await resolveCurrentWorkspace();
    var status=await upsertCurrentUserProfile();
    if(status!=='active'){mostrarPendente();return;}
    await load();
    applyPrefs();
    if(!CURRENT_ROLE_NAME){mostrarPendente();return;}
    mostrarApp();
```

- [ ] **Step 2: Editar o bloco `onAuthStateChange`**

Local atual (`index.html:8112-8121`), mesma mudança:
```js
      CURRENT_USER=session.user;
      updateUserBadge(session.user);
      document.getElementById('login-screen').style.display='none';
      document.getElementById('loading-screen').style.display='flex';
      setLoadingMsg('Carregando dados...');
      await resolveCurrentWorkspace();
      var status=await upsertCurrentUserProfile();
      if(status!=='active'){mostrarPendente();return;}
      await load();
      applyPrefs();
      if(!CURRENT_ROLE_NAME){mostrarPendente();return;}
      mostrarApp();
```

Note que `mostrarPendente(session.user)`/`mostrarPendente(user)` (com argumento) deixam de ser chamadas — a única definição viva de `mostrarPendente()` (linha 5258) já não usa parâmetro, lê `CURRENT_USER.email` diretamente. Isso simplifica as duas chamadas para `mostrarPendente()` sem argumento em ambos os pontos.

- [ ] **Step 3: Verificar via navegador**

Repetir o smoke test de login como Visitante desta sessão (`entrar como Visitante` → `visita2024`) e confirmar que a tela principal ainda abre normalmente (o fluxo de Visitante não passa por `resolveCurrentWorkspace`/`upsertCurrentUserProfile`, então não deve haver diferença). O teste real do fluxo Google (pendente/aprovado) só é possível no checkpoint da Task 13, com login real.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: fluxo de login resolve workspace antes de checar membership"
```

---

### Task 12: Client — `workspace_id` nos writes (`dbSalvar*`, equipes, roles)

**Files:**
- Modify: `index.html:5461-5541` (`dbSalvarVersao`, `dbSalvarOS`, `dbSalvarPonto`, `dbSalvarPublicacao`, `dbSalvarProduto`)
- Modify: `index.html:1953-1980` (`salvarEquipeForm`)
- Modify: `index.html:1983-1998, 2137-2153` (`renderRolesPrefs`, `rolesCriar`)

**Interfaces:**
- Consumes: `CURRENT_WORKSPACE_ID` (Task 6).
- Produces: todo `insert`/`upsert` nas 7 tabelas passa a incluir `workspace_id`, satisfazendo o `NOT NULL` da Task 2 e (depois) o `WITH CHECK` das policies da Task 4.

- [ ] **Step 1: Editar os `dbSalvar*` (versões, OSs, pontos, publicações, produtos)**

```js
async function dbSalvarVersao(v){
  var {data,error}=await sb.from('versoes').upsert({
    id:v.id,workspace_id:CURRENT_WORKSPACE_ID,nome:v.nome,data:v.data||null,boletim:v.boletim||null,
    ativa:v.ativa,encerrada_em:v.encerradaEm||null,created_by:CURRENT_USER.id
  }).select().single();
  if(error)throw error;
  return data;
}
```
```js
async function dbSalvarOS(os){
  var {data,error}=await sb.from('oss').upsert({
    id:os.id,workspace_id:CURRENT_WORKSPACE_ID,versao_id:os.versaoId,num:os.num,titulo:os.titulo,
    produto:os.produto,status:os.status,obs:os.obs||'',link:os.link||'',
    atribuicao:os.atribuicao||'',estimated_hours:os.estimatedHours||0,entregas:os.entregas,created_by:CURRENT_USER.id,
    tipo_redmine:os.tipoRedmine||'',pai_redmine:os.paiRedmine||''
  }).select().single();
  if(error)throw error;
  return data;
}
```
```js
async function dbSalvarPonto(p){
  var {data,error}=await sb.from('pontos').upsert({
    id:p.id,workspace_id:CURRENT_WORKSPACE_ID,user_id:CURRENT_USER.id,versao_id:p.versaoId||null,
    data:p.data,dia:p.dia,marcacoes:p.marcacoes,
    horas_trabalhadas:p.horasTrabalhadas,apropriacoes:p.apropriacoes||[]
  },{onConflict:'user_id,data'}).select().single();
  if(error)throw error;
  return data;
}
```
```js
async function dbSalvarPublicacao(pub){
  var {data,error}=await sb.from('publicacoes').upsert({
    id:pub.id,workspace_id:CURRENT_WORKSPACE_ID,titulo:pub.titulo,inicio:pub.inicio,fim:pub.fim,
    tipo:pub.tipo,produto:pub.produto,descricao:pub.desc||'',created_by:CURRENT_USER.id
  }).select().single();
  if(error)throw error;
  return data;
}
```
```js
async function dbSalvarProduto(nome,grupo){
  await sb.from('produtos').upsert({nome:nome,grupo:grupo,workspace_id:CURRENT_WORKSPACE_ID},{onConflict:'nome'});
}
```

As funções `dbDeletar*`/`dbEncerrarVersao`/`dbReativarVersao`/`dbMoverOS`/`dbToggleEntrega`/`dbSalvarApropriacao`/`dbDeletarProduto` continuam iguais — operam por `id`, que já é único por linha; não precisam de `workspace_id` no `WHERE` porque RLS (Task 4) já garante que só se enxerga/edita linhas do próprio workspace.

- [ ] **Step 2: Editar `salvarEquipeForm` (insert de nova equipe)**

Local atual (`index.html:1958,1965`):
```js
  var payload={nome:nome,gestor_id:gestorId||null};
  ...
    var {data:eqData,error:eqErr}=await sb.from('equipes').insert(payload).select().single();
```
Nova versão:
```js
  var payload={nome:nome,gestor_id:gestorId||null,workspace_id:CURRENT_WORKSPACE_ID};
  ...
    var {data:eqData,error:eqErr}=await sb.from('equipes').insert(payload).select().single();
```
(O `update` de equipe existente, linha 1960, não precisa mudar — `workspace_id` de uma equipe não muda depois de criada.)

- [ ] **Step 3: Editar `renderRolesPrefs` e `rolesCriar`**

Local atual (`index.html:1997`):
```js
  var {data:rolesData}=await sb.from('roles').select('*');
```
Nova versão:
```js
  var {data:rolesData}=await sb.from('roles').select('*').eq('workspace_id',CURRENT_WORKSPACE_ID);
```

Local atual (`index.html:2148`):
```js
  var {error}=await sb.from('roles').insert({nome:nome,label:label,permissoes:permissoes});
```
Nova versão:
```js
  var {error}=await sb.from('roles').insert({nome:nome,label:label,permissoes:permissoes,workspace_id:CURRENT_WORKSPACE_ID});
```

- [ ] **Step 4: Editar `dbSalvarPrefs` — remover o campo legado `role` do `prefs`**

Local atual (`index.html:5548-5555`):
```js
  var {error}=await sb.from('profiles').update({prefs:{
    accent:S.prefs.accent,accentRgb:S.prefs.accentRgb,lightMode:S.prefs.lightMode,
    role:me?me.role:'visualizador',
    displayName:me?me.displayName:(meta.full_name||meta.name||''),
    avatar:(me&&me.avatar)||meta.avatar_url||meta.picture||'',
    email:CURRENT_USER.email||'',
    colorIdx:me?me.colorIdx:null
  }}).eq('id',CURRENT_USER.id);
```
Nova versão (sem `role:` — o papel agora vive só em `workspace_members`):
```js
  var {error}=await sb.from('profiles').update({prefs:{
    accent:S.prefs.accent,accentRgb:S.prefs.accentRgb,lightMode:S.prefs.lightMode,
    displayName:me?me.displayName:(meta.full_name||meta.name||''),
    avatar:(me&&me.avatar)||meta.avatar_url||meta.picture||'',
    email:CURRENT_USER.email||'',
    colorIdx:me?me.colorIdx:null
  }}).eq('id',CURRENT_USER.id);
```

- [ ] **Step 5: Verificar via navegador**

Como Visitante (que não grava nada no Supabase — `dbSalvarOS`/etc. nem chegam a ser chamados pela UI de visitante, já que `can('os_criar')` é sempre falso), não dá pra exercitar os `insert`/`upsert` reais. Confirmar por leitura: cada payload novo tem `workspace_id:CURRENT_WORKSPACE_ID` nas 5 tabelas certas. O teste real acontece na Task 13, criando/editando uma OS de verdade em produção e conferindo no Table Editor do Supabase que a linha nova tem o `workspace_id` correto.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: writes de versoes/oss/pontos/publicacoes/produtos/equipes/roles incluem workspace_id"
```

---

### Task 13: [CHECKPOINT MANUAL] Deploy em produção + percurso completo (RLS ainda desligado)

**Files:** nenhum (deploy + verificação manual)

**Interfaces:**
- Consumes: Tasks 6–12 (todo o client novo).
- Produces: confirmação de que o comportamento em produção é idêntico ao de antes da Fase 1, com RLS ainda desligado.

- [ ] **Step 1: Confirmar com o usuário antes do push**

`git push` para `main` dispara deploy automático na Netlify (`netlify.toml` já configurado) — pedir confirmação explícita antes.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Percurso completo como usuário real logado**

Dashboard, Demandas (Kanban e Ciclo, incluindo o filtro de produto novo desta sessão), Agenda, Ponto, Preferências (Usuários/Equipes/Roles), importação do Redmine (correção desta sessão). Checar console do navegador sem erros.

- [ ] **Step 4: Conferir no Supabase Table Editor**

Uma OS criada/editada durante o passo 3 tem `workspace_id` preenchido corretamente; `workspace_members` tem a linha do usuário logado com `status='active'`.

---

### Task 14: [CHECKPOINT MANUAL] Aplicar migração de RLS em produção

**Files:** nenhum (operação de banco)

**Interfaces:**
- Consumes: `2026-07-30_04_rls_policies.sql` (Task 4), client já validado (Task 13).

- [ ] **Step 1: Confirmar com o usuário, de preferência fora do horário de pico**

Ter o Supabase Dashboard aberto, pronto para rodar o rollback abaixo se necessário.

- [ ] **Step 2: Rodar `2026-07-30_04_rls_policies.sql`**

- [ ] **Step 3: Verificação positiva**

Login real como membro ativo — todas as telas devem continuar trazendo os mesmos dados de antes.

- [ ] **Step 4: Verificação negativa (prova de isolamento)**

Requisição direta à API REST do Supabase com a anon key e o JWT de um usuário que não está em `workspace_members` para esse workspace:

```bash
curl -s "$SUPA_URL/rest/v1/oss?select=*" \
  -H "apikey: $SUPA_ANON_KEY" \
  -H "Authorization: Bearer $JWT_DE_NAO_MEMBRO"
```

Esperado: `[]` (vazio), não a lista de OSs.

- [ ] **Step 5: Checar logs do Supabase por erros de policy**

- [ ] **Step 6: Rollback pronto, se necessário**

```sql
alter table oss disable row level security;
alter table versoes disable row level security;
alter table produtos disable row level security;
alter table pontos disable row level security;
alter table publicacoes disable row level security;
alter table equipes disable row level security;
alter table roles disable row level security;
alter table workspaces disable row level security;
alter table workspace_members disable row level security;
alter table profiles disable row level security;
```

---

### Task 15: [CHECKPOINT MANUAL] Limpeza — remover `profiles.role` legado

**Files:**
- Create: `supabase/migrations/2026-07-30_05_cleanup_profiles_role.sql`

**Interfaces:**
- Consumes: Task 14 estável há alguns dias, sem regressão relatada.

- [ ] **Step 1: Confirmar com o usuário que já se passaram alguns dias estáveis**

- [ ] **Step 2: Escrever e commitar a migração**

```sql
-- 2026-07-30_05_cleanup_profiles_role.sql
alter table profiles drop column if exists role;
```

- [ ] **Step 3: Rodar em produção**

- [ ] **Step 4: Commit do arquivo**

```bash
git add supabase/migrations/2026-07-30_05_cleanup_profiles_role.sql
git commit -m "chore: remove coluna legada profiles.role apos estabilizacao de workspaces"
```
