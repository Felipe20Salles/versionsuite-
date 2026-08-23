# Workspaces Fase 2a (Criação de Workspace + Switcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um usuário autorizado (allowlist) crie novos workspaces e troque entre os que já é membro, substituindo o slug `'default'` hardcoded por uma resolução dinâmica via RPC — sem quebrar o comportamento atual de quem só tem acesso à `LG`.

**Architecture:** Duas RPCs novas `security definer` (`bootstrap_login`, `create_workspace`) somadas a uma tabela de allowlist (`workspace_creators`, invisível ao client, só lida pela RPC). O client (`index.html`) troca `resolveCurrentWorkspace()` por `resolveWorkspaceForLogin()`, que chama `bootstrap_login()` e ramifica para uma de quatro telas: app normal, "Criar workspace", "Sem acesso" ou um switcher modal — reaproveitando a infraestrutura de modal (`openModal`/`closeModal`) e o helper `escHtml`/`bolSlugify` já existentes. Troca de workspace e criação bem-sucedida terminam em `location.reload()` (o boot já sabe re-selecionar via `localStorage`), evitando duplicar a sequência de pós-login (`applyPrefs`/`mostrarApp`/Paralelo/etc.) que hoje só existe inline nos dois pontos de boot.

**Tech Stack:** Supabase (Postgres + Auth), SQL puro versionado manualmente em `supabase/migrations/`, JS vanilla inline em `index.html`, Netlify (deploy automático no push para `main`).

**Spec:** `docs/superpowers/specs/2026-08-13-workspaces-fase2-criacao-switcher-design.md`

## Global Constraints

- Quem hoje só é membro da `LG` (`can_create=false`, 1 workspace) não deve ver nenhuma tela ou botão novo — comportamento idêntico ao atual (spec seção 3).
- Sem convite por e-mail/link nesta fase: usuário com 0 workspaces e fora da allowlist cai num dead-end ("Sem acesso"). Entrar num workspace já existente continua manual (admin insere `workspace_members` direto via SQL Editor) — Fase 2b resolve isso de verdade. Comportamento intencional, já revisado na spec — não é escopo desta implementação mudar.
- Gestão da tabela `workspace_creators` é manual via SQL Editor do Supabase (spec: "Fora de Escopo") — nenhuma UI de admin para ela nesta fase.
- Sem suíte de testes automatizada no repo (app é um `index.html` único) — verificação via SQL Editor (contagens/queries) e navegador. Fluxos que exigem login real (Google OAuth) **só podem ser testados na porta 8080** — nunca em servidor estático ad hoc (ex.: `python -m http.server 8765`), que só serve para o fluxo de Visitante. Se não estiver claro como subir a 8080, perguntar ao usuário em vez de assumir.
- Toda operação contra o banco de produção real, ou que faça deploy (`git push` para `main`), é um **checkpoint manual** — precisa de confirmação explícita do usuário antes de rodar.
- Reaproveitar helpers já existentes em vez de reescrever: `escHtml()` (`index.html:3223`) para qualquer nome vindo do usuário inserido via `innerHTML`, `bolSlugify()` (`index.html:3477`) para gerar o identificador a partir do nome, `openModal`/`closeModal` (`index.html:2318-2319`) e as classes `.modal-overlay`/`.modal`/`.modal-title`/`.modal-footer`/`.form-group`/`.form-label`/`.form-input`/`.btn`/`.btn-primary`/`.btn-ghost` para toda UI nova.
- Migrações novas seguem o padrão `supabase/migrations/YYYY-MM-DD_NN_descricao.sql`, funções `security definer` com `set search_path = public, pg_temp` (Task 4 da Fase 1 documentou por quê: sem isso uma tabela temporária do chamador pode sombrear nomes de relação no corpo da função).

---

### Task 1: Migração SQL — tabela `workspace_creators`

**Files:**
- Create: `supabase/migrations/2026-08-20_01_workspace_creators.sql`

**Interfaces:**
- Produces: tabela `workspace_creators(email text primary key)`, RLS ligada e sem nenhuma policy — invisível ao client, só lida por funções `security definer`. Consumida pelas Tasks 2 e 3.

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- 2026-08-20_01_workspace_creators.sql
--
-- Allowlist de e-mails autorizados a criar workspace novo (Fase 2a).
-- Sem FK para profiles/auth.users: o e-mail pode ser cadastrado antes da
-- pessoa nunca ter logado. Gestão é manual via SQL Editor do Supabase.

create table workspace_creators (
  email text primary key
);

-- Sem policy de propósito: a tabela só é lida pelas RPCs security definer
-- bootstrap_login() e create_workspace() (2026-08-20_02/_03), nunca por
-- SELECT direto do client — mesmo padrão já usado em `workspaces`
-- (2026-08-08_01_workspace_minimal_access.sql).
alter table workspace_creators enable row level security;
```

- [ ] **Step 2: Revisar a sintaxe**

Confirmar que o nome da tabela e da coluna batem com o que as Tasks 2 e 3 vão usar (`workspace_creators.email`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-08-20_01_workspace_creators.sql
git commit -m "feat: adiciona migração da allowlist workspace_creators"
```

(Não aplicada ao banco ainda — isso acontece no checkpoint manual da Task 8.)

---

### Task 2: Migração SQL — RPC `bootstrap_login()`

**Files:**
- Create: `supabase/migrations/2026-08-20_02_bootstrap_login.sql`

**Interfaces:**
- Consumes: `workspace_creators` (Task 1), `workspaces`/`workspace_members` (Fase 1).
- Produces: RPC `bootstrap_login()` retornando `jsonb` no formato `{workspaces:[{id,nome,slug,status},...], can_create:boolean}`. Consumida pela Task 5 (`bootstrapLogin()` no client).

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- 2026-08-20_02_bootstrap_login.sql
--
-- Substitui resolveCurrentWorkspace() (que resolvia sempre o slug fixo
-- 'default') por uma resolução real de multi-tenant: lista os workspaces
-- do usuário logado e se ele pode criar um novo.

create or replace function bootstrap_login()
returns jsonb language sql security definer set search_path = public, pg_temp stable as $$
  select jsonb_build_object(
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'nome', w.nome, 'slug', w.slug, 'status', wm.status
      ))
      from workspace_members wm
      join workspaces w on w.id = wm.workspace_id
      where wm.user_id = auth.uid() and wm.status in ('active','pending')
    ), '[]'::jsonb),
    'can_create', exists(
      select 1 from workspace_creators where email = auth.jwt()->>'email'
    )
  )
$$;

revoke execute on function bootstrap_login() from public;
grant execute on function bootstrap_login() to authenticated;
```

- [ ] **Step 2: Revisar a sintaxe**

Confirmar que `status in ('active','pending')` exclui `rejected` (spec seção 2: um usuário só-rejeitado deve cair no mesmo fluxo de quem não tem workspace nenhum). Confirmar que os nomes das colunas (`w.nome`, `w.slug`, `wm.status`) batem com o schema real de `workspaces`/`workspace_members` (Fase 1, `2026-07-30_01_workspaces_tables.sql`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-08-20_02_bootstrap_login.sql
git commit -m "feat: adiciona RPC bootstrap_login para resolução multi-workspace"
```

---

### Task 3: Migração SQL — RPC `create_workspace(nome, slug)`

**Files:**
- Create: `supabase/migrations/2026-08-20_03_create_workspace.sql`

**Interfaces:**
- Consumes: `workspace_creators` (Task 1), `roles`/`workspaces`/`workspace_members` (Fase 1).
- Produces: RPC `create_workspace(nome text, slug text) returns uuid` — cria workspace + role `admin` + membership do criador numa única transação. Consumida pela Task 6 (`criarWorkspace()` no client).

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- 2026-08-20_03_create_workspace.sql
--
-- Cria um workspace novo de forma atômica: workspace + role admin + membership
-- do criador, tudo numa function (uma transação), evitando a condição de
-- corrida documentada no bootstrap de ensure_workspace_membership (Fase 1):
-- aqui não há count() separado do insert, o criador é sempre o único membro.

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

  return new_ws_id;
end;
$$;

revoke execute on function create_workspace(text, text) from public;
grant execute on function create_workspace(text, text) to authenticated;
```

- [ ] **Step 2: Revisar a sintaxe**

Confirmar que `workspaces.slug` continua `unique` (Fase 1, `2026-07-30_01`) — é essa constraint que faz um slug duplicado estourar `23505` naturalmente (spec seção 2, item 5), sem precisar de checagem manual aqui. Confirmar que o formato do `permissoes` bate exatamente com o usado em `index.html:2171` (`roles.insert`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-08-20_03_create_workspace.sql
git commit -m "feat: adiciona RPC create_workspace atomica"
```

---

### Task 4: Client — HTML das telas novas (Criar workspace, Sem acesso, switcher, badge no topbar)

**Files:**
- Modify: `index.html:478-480` (depois do bloco `pending-screen`, antes de `<div class="app">`)
- Modify: `index.html:576` (topbar, antes de `#user-badge`)
- Modify: `index.html:1369-1371` (depois do modal de visitante, antes do comentário `MODAL PONTO`)

**Interfaces:**
- Produces: elementos `#create-workspace-screen`, `#no-access-screen`, `#workspace-badge`/`#workspace-badge-name`, `#modal-switcher` (com `#switcher-list`, `#switcher-btn-criar`, `#switcher-btn-fechar`, `#switcher-btn-sair`). Consumidos pelas Tasks 5, 6 e 7.

- [ ] **Step 1: Inserir as telas "Criar workspace" e "Sem acesso"**

Local atual (`index.html:471-480`):
```html
<div id="pending-screen" style="display:none;position:fixed;inset:0;background:var(--bg);z-index:450;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:40px;text-align:center">
  <div style="font-family:var(--mono);font-size:20px;font-weight:500;margin-bottom:4px">Version<span style="color:var(--accent)">Suite</span></div>
  <div style="font-size:32px">⏳</div>
  <div style="font-size:18px;font-weight:600;color:var(--fg)">Acesso aguardando aprovação</div>
  <div style="font-size:14px;color:var(--muted);max-width:380px;line-height:1.6">Sua conta foi criada com sucesso, mas ainda precisa ser liberada por um administrador. Aguarde o contato da equipe.</div>
  <div id="pending-user-email" style="font-size:12px;color:var(--hint);font-family:var(--mono);margin-top:4px"></div>
  <button class="btn btn-ghost btn-sm" onclick="signOut()" style="margin-top:12px">Sair</button>
</div>

<div class="app">
```

Nova versão (adiciona os dois blocos novos entre o `pending-screen` e `<div class="app">`, sem alterar o que já existe):
```html
<div id="pending-screen" style="display:none;position:fixed;inset:0;background:var(--bg);z-index:450;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:40px;text-align:center">
  <div style="font-family:var(--mono);font-size:20px;font-weight:500;margin-bottom:4px">Version<span style="color:var(--accent)">Suite</span></div>
  <div style="font-size:32px">⏳</div>
  <div style="font-size:18px;font-weight:600;color:var(--fg)">Acesso aguardando aprovação</div>
  <div style="font-size:14px;color:var(--muted);max-width:380px;line-height:1.6">Sua conta foi criada com sucesso, mas ainda precisa ser liberada por um administrador. Aguarde o contato da equipe.</div>
  <div id="pending-user-email" style="font-size:12px;color:var(--hint);font-family:var(--mono);margin-top:4px"></div>
  <button class="btn btn-ghost btn-sm" onclick="signOut()" style="margin-top:12px">Sair</button>
</div>

<div id="create-workspace-screen" style="display:none;position:fixed;inset:0;background:var(--bg);z-index:500;align-items:center;justify-content:center;flex-direction:column">
  <div style="text-align:center;max-width:380px;width:calc(100% - 32px);padding:40px 32px;background:var(--card);border:1px solid var(--border);border-radius:20px">
    <div style="font-family:var(--mono);font-size:20px;font-weight:500;margin-bottom:4px">Criar workspace</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:24px">Cada workspace isola seus produtos, versões e equipe.</div>
    <div class="form-group" style="text-align:left">
      <label class="form-label">Nome do workspace</label>
      <input class="form-input" id="cw-nome" placeholder="ex.: Nome do Cliente ou Projeto" oninput="onCwNomeInput()" autocomplete="off">
    </div>
    <div class="form-group" style="text-align:left">
      <label class="form-label">Identificador</label>
      <input class="form-input" id="cw-slug" placeholder="identificador" oninput="onCwSlugInput()" autocomplete="off">
      <div style="font-size:11px;color:var(--hint);margin-top:4px">usado internamente, sem espaços</div>
    </div>
    <div id="cw-error" style="display:none;margin-top:6px;font-size:12px;color:var(--red-text);padding:8px 12px;background:var(--red-dim);border-radius:8px;text-align:left"></div>
    <button class="btn btn-primary" id="cw-btn-criar" onclick="criarWorkspace()" style="width:100%;margin-top:18px">Criar workspace</button>
    <button class="btn btn-ghost" onclick="confirmarLogout()" style="width:100%;margin-top:8px">Sair</button>
  </div>
</div>

<div id="no-access-screen" style="display:none;position:fixed;inset:0;background:var(--bg);z-index:500;align-items:center;justify-content:center;flex-direction:column">
  <div style="text-align:center;max-width:380px;padding:40px 32px;background:var(--card);border:1px solid var(--border);border-radius:20px">
    <div style="font-size:40px;margin-bottom:16px">🔒</div>
    <div style="font-family:var(--mono);font-size:18px;font-weight:500;margin-bottom:8px">Sem acesso</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:24px;line-height:1.6">Você ainda não tem acesso a nenhum workspace. Peça para alguém te convidar.</div>
    <button class="btn btn-ghost" onclick="confirmarLogout()" style="width:100%">Sair</button>
  </div>
</div>

<div class="app">
```

- [ ] **Step 2: Inserir o badge de workspace no topbar**

Local atual (`index.html:576`):
```html
        <div id="user-badge" style="display:flex;align-items:center;gap:8px;padding:4px 10px;background:var(--card2);border-radius:20px;border:1px solid var(--border);cursor:pointer" onclick="confirmarLogout()">
```

Nova versão (badge novo logo antes do `user-badge`, escondido por padrão — a Task 7 controla quando ele aparece):
```html
        <div id="workspace-badge" style="display:none;align-items:center;gap:6px;padding:4px 10px;background:var(--card2);border-radius:20px;border:1px solid var(--border);cursor:pointer;font-size:12px;color:var(--muted)" onclick="abrirSwitcher()">
          <span>🏢</span><span id="workspace-badge-name"></span>
        </div>
        <div id="user-badge" style="display:flex;align-items:center;gap:8px;padding:4px 10px;background:var(--card2);border-radius:20px;border:1px solid var(--border);cursor:pointer" onclick="confirmarLogout()">
```

- [ ] **Step 3: Inserir o modal do switcher**

Local atual (`index.html:1351-1371`, bloco do modal de visitante seguido do comentário do próximo modal):
```html
<!-- MODAL VISITANTE -->
<div class="modal-overlay" id="modal-visitor" style="z-index:600">
  <div class="modal" style="max-width:380px">
    <div class="modal-title">👁 Entrar como Visitante</div>
    <div class="form-group">
      <label class="form-label">Seu nome</label>
      <input class="form-input" id="visitor-nome" placeholder="Como quer ser chamado?" autocomplete="off">
    </div>
    <div class="form-group">
      <label class="form-label">Senha de acesso</label>
      <input type="password" class="form-input" id="visitor-senha" placeholder="Senha fornecida pelo administrador">
    </div>
    <div id="visitor-error" style="display:none;font-size:12px;color:var(--red-text);padding:8px 12px;background:var(--red-dim);border-radius:8px;margin-top:4px"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal('modal-visitor')">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmarVisitante()">Entrar</button>
    </div>
  </div>
</div>

<!-- MODAL PONTO -->
```

Nova versão (modal do switcher inserido entre os dois):
```html
<!-- MODAL VISITANTE -->
<div class="modal-overlay" id="modal-visitor" style="z-index:600">
  <div class="modal" style="max-width:380px">
    <div class="modal-title">👁 Entrar como Visitante</div>
    <div class="form-group">
      <label class="form-label">Seu nome</label>
      <input class="form-input" id="visitor-nome" placeholder="Como quer ser chamado?" autocomplete="off">
    </div>
    <div class="form-group">
      <label class="form-label">Senha de acesso</label>
      <input type="password" class="form-input" id="visitor-senha" placeholder="Senha fornecida pelo administrador">
    </div>
    <div id="visitor-error" style="display:none;font-size:12px;color:var(--red-text);padding:8px 12px;background:var(--red-dim);border-radius:8px;margin-top:4px"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal('modal-visitor')">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmarVisitante()">Entrar</button>
    </div>
  </div>
</div>

<!-- MODAL SWITCHER DE WORKSPACE -->
<div class="modal-overlay" id="modal-switcher">
  <div class="modal" style="max-width:360px">
    <div class="modal-title">Escolher workspace</div>
    <div id="switcher-list" style="display:flex;flex-direction:column;gap:8px;margin:12px 0"></div>
    <button class="btn btn-ghost" id="switcher-btn-criar" style="display:none;width:100%" onclick="closeModal('modal-switcher');mostrarCriarWorkspace()">+ Criar novo workspace</button>
    <div class="modal-footer">
      <button class="btn" id="switcher-btn-fechar" onclick="closeModal('modal-switcher')">Fechar</button>
      <button class="btn btn-ghost" id="switcher-btn-sair" style="display:none" onclick="confirmarLogout()">Sair</button>
    </div>
  </div>
</div>

<!-- MODAL PONTO -->
```

- [ ] **Step 4: Revisar visualmente**

Confirmar que nenhum `id` novo colide com algo já existente no arquivo (`grep -c 'id="create-workspace-screen"\|id="no-access-screen"\|id="workspace-badge"\|id="modal-switcher"' index.html` deve dar `1` para cada). Confirmar que as duas telas novas (`z-index:500`, igual ao `login-screen`) e o modal (`z-index:300`, padrão de `.modal-overlay`) não têm z-index colidindo com `pending-screen` (450) ou `loading-screen` (400) de um jeito que quebre alguma transição — como só uma tela fica visível por vez (Task 5 garante isso), a ordem de z-index não importa na prática.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: adiciona telas e modal de workspace (criar, sem acesso, switcher)"
```

---

### Task 5: Client — fluxo de boot resolve múltiplos workspaces

**Files:**
- Modify: `index.html:5223-5232` (globais `CURRENT_WORKSPACE_ID` / `resolveCurrentWorkspace`)
- Modify: `index.html:5273-5280` (`mostrarPendente()`, versão ativa)
- Modify: `index.html:5251-5257` (`mostrarLogin()`)
- Modify: `index.html:2206-2232` (`upsertCurrentUserProfile()`)
- Modify: `index.html:8074-8096` (bloco `getSession()`)
- Modify: `index.html:8131-8155` (bloco `onAuthStateChange` / `SIGNED_IN`)

**Interfaces:**
- Consumes: RPCs `bootstrap_login()` (Task 2), elementos `#create-workspace-screen`/`#no-access-screen` (Task 4).
- Produces: `resolveWorkspaceForLogin()` (retorna o workspace escolhido ou `null` se uma tela bloqueante já foi mostrada), `mostrarCriarWorkspace()`, `mostrarSemAcesso()`, `lastWorkspaceKey()`, globais `_BOOT_WORKSPACES`/`_CAN_CREATE_WORKSPACE`. Consumidas pelas Tasks 6 e 7.

- [ ] **Step 1: Trocar `resolveCurrentWorkspace()` por `bootstrapLogin()` + `resolveWorkspaceForLogin()`**

Local atual (`index.html:5223-5232`):
```js
var CURRENT_WORKSPACE_ID=null;
// Resolve via RPC security definer (2026-08-08_01) em vez de SELECT direto: a tabela
// workspaces tem RLS ligada e nenhuma policy de SELECT — de propósito, para que um
// usuário ainda não-membro consiga descobrir o workspace e pedir acesso.
async function resolveCurrentWorkspace(){
  var {data:wsId,error}=await sb.rpc('get_workspace_id_by_slug',{ws_slug:'default'});
  if(error||!wsId)throw new Error('Workspace padrão não encontrado (slug "default"). Rode as migrações de workspaces.');
  CURRENT_WORKSPACE_ID=wsId;
  return wsId;
}
```

Nova versão:
```js
var CURRENT_WORKSPACE_ID=null;
var _BOOT_WORKSPACES=[];      // último resultado de bootstrap_login(): [{id,nome,slug,status},...]
var _CAN_CREATE_WORKSPACE=false;

async function bootstrapLogin(){
  var {data,error}=await sb.rpc('bootstrap_login');
  if(error)throw error;
  return data||{workspaces:[],can_create:false};
}
function lastWorkspaceKey(){
  return 'vs_last_workspace_'+(CURRENT_USER&&CURRENT_USER.id||'');
}
function pickRememberedWorkspace(list){
  var remembered=localStorage.getItem(lastWorkspaceKey());
  return remembered&&list.find(function(w){return w.id===remembered&&w.status==='active'})||null;
}
// Substitui resolveCurrentWorkspace(): agora resolve dinamicamente quantos
// workspaces o usuário tem, em vez de sempre assumir o slug fixo 'default'.
// Retorna o workspace escolhido, ou null se uma tela bloqueante (criar
// workspace / sem acesso / switcher / pendente) já foi mostrada — quem chama
// deve parar o boot nesse caso.
async function resolveWorkspaceForLogin(){
  var boot=await bootstrapLogin();
  var workspaces=boot.workspaces||[];
  _BOOT_WORKSPACES=workspaces;
  _CAN_CREATE_WORKSPACE=!!boot.can_create;
  if(workspaces.length===0){
    if(_CAN_CREATE_WORKSPACE)mostrarCriarWorkspace();else mostrarSemAcesso();
    return null;
  }
  var resolved=workspaces.length===1?workspaces[0]:pickRememberedWorkspace(workspaces);
  if(!resolved){await abrirSwitcher(true);return null;}
  CURRENT_WORKSPACE_ID=resolved.id;
  localStorage.setItem(lastWorkspaceKey(),resolved.id);
  if(resolved.status!=='active'){mostrarPendente();return null;}
  return resolved;
}
```

- [ ] **Step 2: Fazer as telas "bloqueantes" existentes esconderem as telas novas**

Local atual (`index.html:5251-5257`, `mostrarLogin`):
```js
function mostrarLogin(msg){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('pending-screen').style.display='none';
  document.querySelector('.app').style.display='none';
  var msgEl=document.getElementById('login-msg');
  if(msgEl){if(msg){msgEl.textContent=msg;msgEl.style.display='block'}else{msgEl.style.display='none'}}
}
```

Nova versão:
```js
function mostrarLogin(msg){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('pending-screen').style.display='none';
  document.getElementById('create-workspace-screen').style.display='none';
  document.getElementById('no-access-screen').style.display='none';
  document.querySelector('.app').style.display='none';
  var msgEl=document.getElementById('login-msg');
  if(msgEl){if(msg){msgEl.textContent=msg;msgEl.style.display='block'}else{msgEl.style.display='none'}}
}
function mostrarCriarWorkspace(){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('login-screen').style.display='none';
  document.getElementById('pending-screen').style.display='none';
  document.getElementById('no-access-screen').style.display='none';
  document.getElementById('create-workspace-screen').style.display='flex';
  document.querySelector('.app').style.display='none';
  document.getElementById('cw-nome').value='';
  document.getElementById('cw-slug').value='';
  document.getElementById('cw-error').style.display='none';
  _cwSlugDirty=false;
}
function mostrarSemAcesso(){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('login-screen').style.display='none';
  document.getElementById('pending-screen').style.display='none';
  document.getElementById('create-workspace-screen').style.display='none';
  document.getElementById('no-access-screen').style.display='flex';
  document.querySelector('.app').style.display='none';
}
```

Local atual (`index.html:5273-5280`, versão ativa de `mostrarPendente`, a que sobrescreve a primeira definição em JS):
```js
function mostrarPendente(){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('login-screen').style.display='none';
  document.getElementById('pending-screen').style.display='flex';
  document.querySelector('.app').style.display='none';
  var el=document.getElementById('pending-user-email');
  if(el&&CURRENT_USER)el.textContent=CURRENT_USER.email||'';
}
```

Nova versão:
```js
function mostrarPendente(){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('login-screen').style.display='none';
  document.getElementById('create-workspace-screen').style.display='none';
  document.getElementById('no-access-screen').style.display='none';
  document.getElementById('pending-screen').style.display='flex';
  document.querySelector('.app').style.display='none';
  var el=document.getElementById('pending-user-email');
  if(el&&CURRENT_USER)el.textContent=CURRENT_USER.email||'';
}
```

(Não mexer na primeira definição de `mostrarPendente`, linha 5259 — é código morto pré-existente, `getElementById` sempre resolve o primeiro `pending-screen` do DOM e quem roda de fato é a segunda definição, que é a editada acima. Fora de escopo desta fase.)

- [ ] **Step 3: Simplificar `upsertCurrentUserProfile()` — remove a chamada a `ensure_workspace_membership`**

Local atual (`index.html:2206-2232`):
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

Nova versão — a função volta a ser só sincronização de identidade (nome/avatar/e-mail); quem resolve membership/status agora é `resolveWorkspaceForLogin()` (Step 1), a partir do que `bootstrap_login()` já retornou:
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
}
```

**Nota:** isso torna a RPC `ensure_workspace_membership` (Fase 1) sem nenhuma chamada no client após esta task — permanece definida no banco (inofensivo), mas passa a ser código morto do lado do servidor. Não removê-la nesta fase (fora de escopo; documentar como achado de limpeza se quiser revisitar depois).

- [ ] **Step 4: Atualizar os dois pontos de boot para usar o novo fluxo**

Local atual (`index.html:8082-8093`, dentro do bloco `getSession()`):
```js
    try{
      await resolveCurrentWorkspace();
      var status=await upsertCurrentUserProfile();
      if(status!=='active'){mostrarPendente();return;}
      await load();
    }catch(e){
      // Sem isso a tela de loading fica presa para sempre.
      console.error('[VS] Falha ao inicializar a sessão:',e);
      _appIniciado=false;
      mostrarLogin('Não foi possível carregar seus dados ('+(e&&e.message?e.message:'erro desconhecido')+'). Tente entrar novamente.');
      return;
    }
```

Nova versão:
```js
    try{
      await upsertCurrentUserProfile();
      var resolved=await resolveWorkspaceForLogin();
      if(!resolved)return;
      await load();
      updateWorkspaceBadge();
    }catch(e){
      // Sem isso a tela de loading fica presa para sempre.
      console.error('[VS] Falha ao inicializar a sessão:',e);
      _appIniciado=false;
      mostrarLogin('Não foi possível carregar seus dados ('+(e&&e.message?e.message:'erro desconhecido')+'). Tente entrar novamente.');
      return;
    }
```

Local atual (`index.html:8141-8152`, dentro de `onAuthStateChange`/`SIGNED_IN`):
```js
      try{
        await resolveCurrentWorkspace();
        var status=await upsertCurrentUserProfile();
        if(status!=='active'){mostrarPendente();return;}
        await load();
      }catch(e){
        // Sem isso a tela de loading fica presa para sempre.
        console.error('[VS] Falha ao inicializar a sessão:',e);
        _appIniciado=false;
        mostrarLogin('Não foi possível carregar seus dados ('+(e&&e.message?e.message:'erro desconhecido')+'). Tente entrar novamente.');
        return;
      }
```

Nova versão:
```js
      try{
        await upsertCurrentUserProfile();
        var resolved=await resolveWorkspaceForLogin();
        if(!resolved)return;
        await load();
        updateWorkspaceBadge();
      }catch(e){
        // Sem isso a tela de loading fica presa para sempre.
        console.error('[VS] Falha ao inicializar a sessão:',e);
        _appIniciado=false;
        mostrarLogin('Não foi possível carregar seus dados ('+(e&&e.message?e.message:'erro desconhecido')+'). Tente entrar novamente.');
        return;
      }
```

(`updateWorkspaceBadge()` e `abrirSwitcher()` só existem a partir da Task 7 — este passo já deixa as chamadas prontas; até a Task 7 rodar, `updateWorkspaceBadge` fica undefined e o boot vai quebrar. É esperado: as Tasks 5, 6 e 7 desta feature são sequenciais e o app só volta a rodar de ponta a ponta depois da Task 7. Não faça deploy/checkpoint manual antes disso.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: fluxo de boot resolve workspace via bootstrap_login"
```

---

### Task 6: Client — tela "Criar workspace"

**Files:**
- Modify: `index.html` (novo bloco de JS, sugestão: logo depois de `upsertCurrentUserProfile()`, `index.html:2232` na numeração pré-Task 5 — inserir onde fizer sentido depois das edições anteriores)

**Interfaces:**
- Consumes: `#create-workspace-screen`/`#cw-nome`/`#cw-slug`/`#cw-error`/`#cw-btn-criar` (Task 4), `bolSlugify()` (`index.html:3477`), RPC `create_workspace` (Task 3), `lastWorkspaceKey()` (Task 5).
- Produces: `onCwNomeInput()`, `onCwSlugInput()`, `criarWorkspace()`, global `_cwSlugDirty`.

- [ ] **Step 1: Escrever as funções da tela**

Adicionar (por exemplo logo após a nova versão de `upsertCurrentUserProfile()` escrita na Task 5):
```js
// ── CRIAR WORKSPACE ──────────────────────────────────────────────────────────
var _cwSlugDirty=false;
function onCwNomeInput(){
  if(_cwSlugDirty)return;
  document.getElementById('cw-slug').value=bolSlugify(document.getElementById('cw-nome').value);
}
function onCwSlugInput(){_cwSlugDirty=true;}
async function criarWorkspace(){
  var nome=document.getElementById('cw-nome').value.trim();
  var slug=document.getElementById('cw-slug').value.trim();
  var errEl=document.getElementById('cw-error');
  errEl.style.display='none';
  if(!nome){errEl.textContent='Informe o nome do workspace.';errEl.style.display='block';return;}
  if(!slug){errEl.textContent='Informe o identificador.';errEl.style.display='block';return;}
  var btn=document.getElementById('cw-btn-criar');
  btn.disabled=true;btn.textContent='Criando...';
  var {data:wsId,error}=await sb.rpc('create_workspace',{nome:nome,slug:slug});
  if(error){
    errEl.textContent=(error.code==='23505')?'Já existe um workspace com esse identificador. Escolha outro.':'Erro ao criar workspace: '+error.message;
    errEl.style.display='block';
    btn.disabled=false;btn.textContent='Criar workspace';
    return;
  }
  localStorage.setItem(lastWorkspaceKey(),wsId);
  location.reload();
}
```

`bolSlugify` (`index.html:3477`) já faz exatamente o slugify pedido pela spec (minúsculas, remove acento, espaço/símbolo→hífen, sem hífen nas pontas) — reaproveitado em vez de duplicado.

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: implementa tela de criacao de workspace"
```

---

### Task 7: Client — switcher de workspace (modal + badge no topbar)

**Files:**
- Modify: `index.html` (novo bloco de JS, logo depois das funções da Task 6)

**Interfaces:**
- Consumes: `#workspace-badge`/`#workspace-badge-name`, `#modal-switcher`/`#switcher-list`/`#switcher-btn-criar`/`#switcher-btn-fechar`/`#switcher-btn-sair` (Task 4), `escHtml()` (`index.html:3223`), `openModal`/`closeModal` (`index.html:2318-2319`), `_BOOT_WORKSPACES`/`_CAN_CREATE_WORKSPACE`/`lastWorkspaceKey()` (Task 5).
- Produces: `abrirSwitcher(forced)`, `renderSwitcherList()`, `selecionarWorkspace(wsId)`, `updateWorkspaceBadge()` — as duas últimas fecham os usos pendentes de `resolveWorkspaceForLogin()` (Task 5, que já chama `abrirSwitcher(true)`) e dos dois pontos de boot (Task 5, que já chamam `updateWorkspaceBadge()`).

- [ ] **Step 1: Escrever as funções do switcher**

```js
// ── SWITCHER DE WORKSPACE ────────────────────────────────────────────────────
var _switcherForced=false;
// forced=true: chamado no meio do boot, antes do app existir na tela (2+
// workspaces sem escolha lembrada em localStorage) — sem botão "Fechar",
// porque não há nada por trás do modal para voltar.
// forced=false (padrão): aberto pelo usuário a qualquer momento via badge do
// topbar — busca a lista fresca (memberships podem ter mudado) e some com
// "Fechar" normal.
async function abrirSwitcher(forced){
  _switcherForced=!!forced;
  if(!forced){
    try{
      var boot=await bootstrapLogin();
      _BOOT_WORKSPACES=boot.workspaces||[];
      _CAN_CREATE_WORKSPACE=!!boot.can_create;
    }catch(e){toast('Erro ao carregar workspaces: '+e.message,true);return;}
  }
  renderSwitcherList();
  document.getElementById('switcher-btn-fechar').style.display=forced?'none':'inline-block';
  document.getElementById('switcher-btn-sair').style.display=forced?'inline-block':'none';
  if(forced){
    document.getElementById('loading-screen').style.display='none';
    document.getElementById('login-screen').style.display='none';
    document.getElementById('pending-screen').style.display='none';
    document.getElementById('create-workspace-screen').style.display='none';
    document.getElementById('no-access-screen').style.display='none';
    document.querySelector('.app').style.display='none';
  }
  openModal('modal-switcher');
}
function renderSwitcherList(){
  var el=document.getElementById('switcher-list');
  var ativos=_BOOT_WORKSPACES.filter(function(w){return w.status==='active'});
  el.innerHTML=ativos.map(function(w){
    var atual=w.id===CURRENT_WORKSPACE_ID;
    return '<button class="btn'+(atual?' btn-primary':' btn-ghost')+'" style="width:100%;text-align:left" '+
      (atual?'disabled':('onclick="selecionarWorkspace(\''+w.id+'\')"'))+'>'+
      (atual?'✓ ':'')+escHtml(w.nome)+'</button>';
  }).join('')||'<div style="font-size:12px;color:var(--muted)">Nenhum workspace ativo.</div>';
  document.getElementById('switcher-btn-criar').style.display=_CAN_CREATE_WORKSPACE?'block':'none';
}
function selecionarWorkspace(wsId){
  localStorage.setItem(lastWorkspaceKey(),wsId);
  location.reload();
}
function updateWorkspaceBadge(){
  var el=document.getElementById('workspace-badge');
  if(!el)return;
  var show=(_BOOT_WORKSPACES.length>1)||_CAN_CREATE_WORKSPACE;
  el.style.display=show?'flex':'none';
  var resolved=_BOOT_WORKSPACES.find(function(w){return w.id===CURRENT_WORKSPACE_ID});
  document.getElementById('workspace-badge-name').textContent=resolved?resolved.nome:'';
}
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: implementa switcher de workspace no topbar"
```

---

### Task 8: Aplicar em produção e roteiro de verificação manual

**Files:** nenhum (checkpoint operacional — pede confirmação explícita do usuário antes de cada sub-passo contra produção real)

- [ ] **Step 1: Aplicar as 3 migrações novas em produção**

Via SQL Editor do Supabase, como `postgres` (dono das tabelas — necessário para que `security definer` bypasse RLS de verdade, mesma exigência documentada no gate da Task 13 da Fase 1), nesta ordem:
1. `2026-08-20_01_workspace_creators.sql`
2. `2026-08-20_02_bootstrap_login.sql`
3. `2026-08-20_03_create_workspace.sql`

Confirmar com o usuário antes de rodar.

- [ ] **Step 2: Adicionar pelo menos um e-mail à allowlist**

Sem isso não dá pra testar a criação de workspace. Pedir ao usuário o e-mail Google usado para login e rodar manualmente:
```sql
insert into workspace_creators (email) values ('<email-do-felipe-aqui>');
```

- [ ] **Step 3: Deploy**

`git push origin main` (Netlify publica automaticamente). Confirmar com o usuário antes.

- [ ] **Step 4: Roteiro manual (porta 8080, login real)**

Reaproveitar a técnica já validada na Fase 1 (servidor local na porta 8080 — ver Global Constraints; perguntar ao usuário como subir se não estiver claro) ou testar direto em produção. Seguir os 6 cenários da spec (seção 5):

1. E-mail na allowlist, login novo (conta que nunca logou nesse workspace) → tela "Criar workspace" aparece; criar → conferir no Table Editor que `workspaces` + `workspace_members` (`status='active'`, `role_id` apontando pro role `admin`) + `roles` (`nome='admin'`) foram criados para o novo workspace; app carrega já escopado pro workspace novo (criar uma versão/produto de teste e confirmar que não aparece nada da `LG`).
2. Membro único da `LG` (sem estar na allowlist) loga → comportamento idêntico ao atual: nenhuma tela nova, nenhum badge de workspace no topbar.
3. Um mesmo usuário com 2 memberships ativas (`LG` + o workspace novo) loga → badge de workspace aparece no topbar; abrir o switcher, trocar, confirmar que os dados de um workspace não vazam pro outro (produtos/versões diferentes em cada um).
4. E-mail fora da allowlist, zero memberships → tela "Sem acesso", sem forma de criar (confirmar que não existe nenhum botão de ação nessa tela).
5. Tentar criar um workspace com slug já existente → erro inline "Já existe um workspace com esse identificador. Escolha outro.", form não trava (dá pra tentar de novo com outro slug sem reload).
6. Duplo-clique real no botão "Criar workspace" → confirmar que a segunda chamada falha (constraint `unique` de `slug`) e que a UI mostra o erro de forma sensata, sem duplicar workspace nenhum (conferir contagem em `workspaces` depois).

- [ ] **Step 5: Registrar o resultado**

Depois do roteiro, resumir para o usuário quais dos 6 cenários passaram e quais não, sem assumir sucesso sem ter rodado de fato (`superpowers:verification-before-completion`).

---
