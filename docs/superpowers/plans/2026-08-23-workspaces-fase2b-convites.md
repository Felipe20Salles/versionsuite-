# Workspaces Fase 2b (Convite por E-mail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que qualquer admin de um workspace convide gente pro próprio workspace por e-mail (com role escolhido na hora), com aceite automático e imediato no primeiro login — substituindo a inserção manual via SQL Editor.

**Architecture:** Uma tabela nova `workspace_invites` (RLS direta via `is_workspace_admin(workspace_id)`, sem RPC pra criar/listar/cancelar) + uma RPC nova `security definer` `claim_invite()` que resgata convites pendentes do e-mail logado. `bootstrap_login()` (Fase 2a) permanece intocada — `claim_invite()` é chamada só em dois pontos do client: `resolveWorkspaceForLogin()` quando o boot retorna 0 workspaces, e `abrirSwitcher(forced=false)` quando o usuário abre o switcher manualmente. A UI de convidar/listar/cancelar entra dentro da seção "Usuários da plataforma" já existente em Preferências, reaproveitando o padrão visual de `modal-pending-requests`.

**Tech Stack:** Supabase (Postgres + Auth), SQL puro versionado manualmente em `supabase/migrations/`, JS vanilla inline em `index.html`, Netlify (deploy automático no push para `main`).

**Spec:** `docs/superpowers/specs/2026-08-23-workspaces-fase2b-convites-design.md`

## Global Constraints

- `bootstrap_login()` (RPC de todo login) não é modificada nesta feature — convite é resolvido por `claim_invite()`, uma RPC separada, chamada só nos dois pontos descritos acima (spec, seção "Decisões de design").
- Sem envio de e-mail real avisando o convidado — fora do app, manual (spec, "Fora de Escopo").
- Gestão de convite 100% pela UI (criar, listar, cancelar) — nada de SQL manual no dia a dia depois desta feature no ar.
- Sem suíte de testes automatizada no repo (app é um `index.html` único) — verificação via SQL Editor (contagens/queries) e navegador. Fluxos que exigem login real (Google OAuth) **só podem ser testados na porta 8080** — nunca em servidor estático ad hoc.
- Toda operação contra o banco de produção real, ou que faça deploy (`git push` para `main`), é um **checkpoint manual** — precisa de confirmação explícita do usuário antes de rodar.
- Reaproveitar helpers/padrões já existentes: `escHtml()` (`index.html:3223` antes desta feature), `openModal`/`closeModal`, `S_ROLES` já carregado por workspace, classes `.modal-overlay`/`.modal`/`.modal-header`/`.modal-title`/`.modal-footer`/`.form-group`/`.form-label`/`.form-input`/`.btn`/`.btn-primary`/`.btn-ghost`/`.btn-sm`, `.user-card` (mesmo componente visual da lista de usuários e de solicitações pendentes).
- Migrações novas seguem o padrão `supabase/migrations/YYYY-MM-DD_NN_descricao.sql`. Já existe `2026-08-23_01_roles_unique_por_workspace.sql` — as próximas desta feature começam em `_02`. Função nova é `security definer` com `set search_path = public, pg_temp`.

---

### Task 1: Migração SQL — tabela `workspace_invites`

**Files:**
- Create: `supabase/migrations/2026-08-23_02_workspace_invites.sql`

**Interfaces:**
- Produces: tabela `workspace_invites(id, workspace_id, email, role_id, invited_by, created_at)`, RLS ligada com policy `workspace_invites_admin_all` (`is_workspace_admin(workspace_id)`, todas as operações). Consumida pela Task 3 (client insert/select/delete) e Task 2 (RPC `claim_invite`).

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- 2026-08-23_02_workspace_invites.sql
--
-- Convite por e-mail (Fase 2b): admin do workspace pré-cadastra um e-mail +
-- role; quando essa pessoa loga pela primeira vez com esse e-mail, entra
-- direto ativa (ver claim_invite(), 2026-08-23_03). Sem coluna de status —
-- a linha existe enquanto o convite está pendente, some ao ser aceita ou
-- cancelada.

create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  email text not null,
  role_id uuid not null references roles(id),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

alter table workspace_invites enable row level security;

-- Gerenciado direto pelo client (sem RPC pra criar/listar/cancelar) — só
-- admin do workspace mexe nos convites do próprio workspace. Mesmo padrão
-- de roles_write/equipes_isolation (2026-07-30_04_rls_policies.sql).
create policy workspace_invites_admin_all on workspace_invites for all
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
```

- [ ] **Step 2: Revisar a sintaxe**

Confirmar que `is_workspace_admin(uuid)` já existe em produção (criada em `2026-07-30_04_rls_policies.sql`, Fase 1) — esta migração depende dela mas não a recria. Confirmar que `unique(workspace_id, email)` é o par certo: permite o mesmo e-mail ter convites pendentes em workspaces diferentes ao mesmo tempo, mas não duplicado no mesmo workspace.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-08-23_02_workspace_invites.sql
git commit -m "feat: adiciona tabela workspace_invites com RLS por admin"
```

(Não aplicada ao banco ainda — isso acontece no checkpoint manual da Task 6.)

---

### Task 2: Migração SQL — RPC `claim_invite()`

**Files:**
- Create: `supabase/migrations/2026-08-23_03_claim_invite.sql`

**Interfaces:**
- Consumes: `workspace_invites` (Task 1), `workspace_members` (Fase 1).
- Produces: RPC `claim_invite()` retornando `jsonb` (array de `{workspace_id}` resgatados, `[]` se nenhum). Consumida pela Task 5 (`claimPendingInvites()` no client).

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- 2026-08-23_03_claim_invite.sql
--
-- Resgata TODOS os convites pendentes do e-mail logado de uma vez (cobre o
-- caso de alguém convidado por mais de um workspace antes do primeiro
-- login), criando a membership 'active' já com o role escolhido pelo admin
-- e apagando o convite. Chamada só pelo client, nunca dentro de
-- bootstrap_login() — ver Global Constraints deste plano.

create or replace function claim_invite()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv record;
  claimed jsonb := '[]'::jsonb;
begin
  for inv in
    select * from workspace_invites where email = auth.jwt()->>'email'
  loop
    insert into workspace_members (workspace_id, user_id, role_id, status)
    values (inv.workspace_id, auth.uid(), inv.role_id, 'active')
    on conflict (workspace_id, user_id) do nothing;
    delete from workspace_invites where id = inv.id;
    claimed := claimed || jsonb_build_object('workspace_id', inv.workspace_id);
  end loop;
  return claimed;
end;
$$;

revoke execute on function claim_invite() from public;
grant execute on function claim_invite() to authenticated;
```

- [ ] **Step 2: Revisar a sintaxe**

Confirmar que `workspace_members` tem a constraint `unique(workspace_id, user_id)` (Fase 1, `2026-07-30_01_workspaces_tables.sql`) — é ela que o `on conflict` referencia. Confirmar que `profiles.id` do usuário logado já existe nesse ponto (garantido: `upsertCurrentUserProfile()` roda antes de `resolveWorkspaceForLogin()` no boot desde a Task 5 da Fase 2a).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-08-23_03_claim_invite.sql
git commit -m "feat: adiciona RPC claim_invite para resgatar convites pendentes"
```

---

### Task 3: Client — HTML da UI de convite (botão, modais)

**Files:**
- Modify: `index.html` (bloco `pref-section-users`, dentro do painel Admin de Preferências)
- Modify: `index.html` (bloco `pref-section-pending-access` / `pref-section-visitor`)
- Modify: `index.html` (bloco `modal-pending-requests`)

**Interfaces:**
- Produces: botão `#btn-convidar-usuario`, seção `#pref-section-invites-sent` (com `#pending-invites-subtitle`), modal `#modal-pending-invites` (com `#pending-invites-list`), modal `#modal-convidar` (com `#cv-email`, `#cv-role`, `#cv-error`, `#cv-btn-convidar`). Consumidos pela Task 4.

- [ ] **Step 1: Adicionar o botão "+ Convidar" ao lado do badge de role**

Local atual:
```html
          <div class="pref-section" id="pref-section-users">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div class="pref-section-title" style="margin-bottom:0">Usuários da plataforma</div>
              <span id="pref-role-badge" style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(124,111,247,.15);color:#7c6ff7;border:1px solid rgba(124,111,247,.3)">—</span>
            </div>
```

Nova versão:
```html
          <div class="pref-section" id="pref-section-users">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div class="pref-section-title" style="margin-bottom:0">Usuários da plataforma</div>
              <div style="display:flex;gap:8px;align-items:center">
                <button class="btn btn-sm btn-ghost" id="btn-convidar-usuario" onclick="abrirConvidarModal()" style="display:none">+ Convidar</button>
                <span id="pref-role-badge" style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(124,111,247,.15);color:#7c6ff7;border:1px solid rgba(124,111,247,.3)">—</span>
              </div>
            </div>
```

(Visibilidade real do botão é controlada em JS pela Task 4 — `style="display:none"` aqui é só o estado inicial antes do primeiro `renderUsersPrefs()`.)

- [ ] **Step 2: Adicionar a seção "Convites pendentes"**

Local atual (entre `pref-section-pending-access` e `pref-section-visitor`):
```html
              <span id="pending-access-badge" class="bell-badge" style="display:none;position:static;border-color:var(--card2)">0</span>
              <span style="color:var(--muted);font-size:18px">›</span>
            </button>
          </div>

          <div class="pref-section" id="pref-section-visitor">
```

Nova versão (insere a seção nova entre as duas):
```html
              <span id="pending-access-badge" class="bell-badge" style="display:none;position:static;border-color:var(--card2)">0</span>
              <span style="color:var(--muted);font-size:18px">›</span>
            </button>
          </div>

          <div class="pref-section" id="pref-section-invites-sent">
            <button type="button" onclick="openPendingInvites()" style="width:100%;display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--card2);border:1px solid var(--border);border-radius:10px;color:var(--text);cursor:pointer;text-align:left">
              <span style="font-size:18px">✉️</span>
              <span style="flex:1">
                <span style="display:block;font-size:13px;font-weight:600">Convites pendentes</span>
                <span id="pending-invites-subtitle" style="display:block;font-size:11px;color:var(--muted);margin-top:2px">Nenhum convite pendente.</span>
              </span>
              <span style="color:var(--muted);font-size:18px">›</span>
            </button>
          </div>

          <div class="pref-section" id="pref-section-visitor">
```

- [ ] **Step 3: Adicionar os dois modais novos (lista de convites + formulário de convidar)**

Local atual (fim do bloco `modal-pending-requests`):
```html
    <div id="pending-requests-list" style="display:flex;flex-direction:column;gap:8px"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal('modal-pending-requests')">Fechar</button>
    </div>
  </div>
</div>
```

Nova versão (dois modais novos logo depois do fechamento de `modal-pending-requests`):
```html
    <div id="pending-requests-list" style="display:flex;flex-direction:column;gap:8px"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal('modal-pending-requests')">Fechar</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="modal-pending-invites">
  <div class="modal" style="max-width:580px;width:calc(100% - 32px)">
    <div class="modal-header">
      <div>
        <div class="modal-title">Convites pendentes</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px">Pessoas convidadas que ainda não fizeram o primeiro login.</div>
      </div>
      <button class="modal-close" onclick="closeModal('modal-pending-invites')">×</button>
    </div>
    <div id="pending-invites-list" style="display:flex;flex-direction:column;gap:8px"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal('modal-pending-invites')">Fechar</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="modal-convidar">
  <div class="modal" style="max-width:380px">
    <div class="modal-title">Convidar usuário</div>
    <div class="form-group">
      <label class="form-label">E-mail (Google)</label>
      <input class="form-input" id="cv-email" placeholder="pessoa@email.com" autocomplete="off">
    </div>
    <div class="form-group">
      <label class="form-label">Perfil</label>
      <select class="form-input" id="cv-role"></select>
    </div>
    <div id="cv-error" style="display:none;font-size:12px;color:var(--red-text);padding:8px 12px;background:var(--red-dim);border-radius:8px;margin-top:4px"></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal('modal-convidar')">Cancelar</button>
      <button class="btn btn-primary" id="cv-btn-convidar" onclick="enviarConvite()">Convidar</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Revisar visualmente**

Confirmar que nenhum `id` novo colide com algo já existente (`grep -c 'id="btn-convidar-usuario"\|id="pref-section-invites-sent"\|id="modal-pending-invites"\|id="modal-convidar"' index.html` deve dar `1` para cada).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: adiciona HTML de convite de usuario (botao, secao, modais)"
```

---

### Task 4: Client — funções JS de convidar/listar/cancelar

**Files:**
- Modify: `index.html` (novo bloco de JS, logo após `openPendingRequests()` e antes de `_avatarFallback()`)
- Modify: `index.html` (`renderUsersPrefs()`, início da função)

**Interfaces:**
- Consumes: `#btn-convidar-usuario`/`#pref-section-invites-sent`/`#pending-invites-subtitle`/`#modal-pending-invites`/`#pending-invites-list`/`#modal-convidar`/`#cv-email`/`#cv-role`/`#cv-error`/`#cv-btn-convidar` (Task 3), `S_ROLES`/`CURRENT_WORKSPACE_ID`/`isAdmin()`/`escHtml()`/`openModal`/`closeModal`/`toast()` (já existentes).
- Produces: `carregarConvitesPendentes()`, `updatePendingInvitesUI()`, `renderPendingInvitesList()`, `openPendingInvites()`, `cancelarConvite(inviteId)`, `abrirConvidarModal()`, `enviarConvite()`, global `S_INVITES`. `carregarConvitesPendentes` e `renderPendingInvitesList` são consumidas pela Task 5 indiretamente (mesmo padrão de refresh após `claim_invite`, mas do lado de quem recebeu — não precisa chamar nada daqui).

- [ ] **Step 1: Escrever as funções de convite**

Local atual (`index.html`, fim de `openPendingRequests()`):
```js
function openPendingRequests(){
  if(!isAdmin()){toast('Apenas admins podem gerenciar solicitações','err');return;}
  renderPendingRequests();
  openModal('modal-pending-requests');
}

function _avatarFallback(imgEl,initials,bgColor){
```

Nova versão (bloco de convite inserido entre as duas):
```js
function openPendingRequests(){
  if(!isAdmin()){toast('Apenas admins podem gerenciar solicitações','err');return;}
  renderPendingRequests();
  openModal('modal-pending-requests');
}

// ── CONVITES DE WORKSPACE ────────────────────────────────────────────────────
var S_INVITES=[];
async function carregarConvitesPendentes(){
  if(!isAdmin()||!CURRENT_WORKSPACE_ID){S_INVITES=[];updatePendingInvitesUI();return;}
  var {data,error}=await sb.from('workspace_invites').select('id,email,role_id').eq('workspace_id',CURRENT_WORKSPACE_ID);
  if(error){S_INVITES=[];updatePendingInvitesUI();return;}
  S_INVITES=data||[];
  updatePendingInvitesUI();
}
function updatePendingInvitesUI(){
  var subtitle=document.getElementById('pending-invites-subtitle');
  if(!subtitle)return;
  var count=S_INVITES.length;
  subtitle.textContent=count
    ?count+' '+(count===1?'convite pendente':'convites pendentes')
    :'Nenhum convite pendente.';
}
function renderPendingInvitesList(){
  var list=document.getElementById('pending-invites-list');if(!list)return;
  if(!S_INVITES.length){
    list.innerHTML='<div style="padding:28px 16px;text-align:center;color:var(--hint);font-size:12px">Nenhum convite pendente.</div>';
    return;
  }
  list.innerHTML=S_INVITES.map(function(inv){
    var roleRow=S_ROLES.find(function(r){return r.id===inv.role_id});
    var roleLabel=roleRow?(roleRow.label||roleRow.nome):'—';
    return'<div class="user-card">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:500;color:var(--text)">'+escHtml(inv.email)+'</div>'+
        '<div style="font-size:11px;color:var(--hint)">'+escHtml(roleLabel)+'</div>'+
      '</div>'+
      '<button class="btn btn-sm btn-ghost" onclick="cancelarConvite(\''+inv.id+'\')" title="Cancelar convite">×</button>'+
    '</div>';
  }).join('');
}
async function openPendingInvites(){
  if(!isAdmin()){toast('Apenas admins podem gerenciar convites','err');return;}
  await carregarConvitesPendentes();
  renderPendingInvitesList();
  openModal('modal-pending-invites');
}
async function cancelarConvite(inviteId){
  var {error}=await sb.from('workspace_invites').delete().eq('id',inviteId);
  if(error){toast('Erro ao cancelar convite: '+error.message,'err');return;}
  await carregarConvitesPendentes();
  renderPendingInvitesList();
  toast('Convite cancelado');
}
function abrirConvidarModal(){
  document.getElementById('cv-email').value='';
  document.getElementById('cv-error').style.display='none';
  var roleEl=document.getElementById('cv-role');
  roleEl.innerHTML=S_ROLES.map(function(r){return'<option value="'+r.id+'">'+escHtml(r.label||r.nome)+'</option>';}).join('');
  openModal('modal-convidar');
}
async function enviarConvite(){
  var email=document.getElementById('cv-email').value.trim();
  var roleId=document.getElementById('cv-role').value;
  var errEl=document.getElementById('cv-error');
  errEl.style.display='none';
  if(!email){errEl.textContent='Informe o e-mail.';errEl.style.display='block';return;}
  if(!roleId){errEl.textContent='Escolha um perfil.';errEl.style.display='block';return;}
  var btn=document.getElementById('cv-btn-convidar');
  btn.disabled=true;btn.textContent='Convidando...';
  var {error}=await sb.from('workspace_invites').insert({workspace_id:CURRENT_WORKSPACE_ID,email:email,role_id:roleId});
  btn.disabled=false;btn.textContent='Convidar';
  if(error){
    errEl.textContent=(error.code==='23505')?'Já existe um convite pendente pra esse e-mail.':'Erro ao convidar: '+error.message;
    errEl.style.display='block';
    return;
  }
  closeModal('modal-convidar');
  await carregarConvitesPendentes();
  toast('Convite enviado ✓');
}

function _avatarFallback(imgEl,initials,bgColor){
```

- [ ] **Step 2: Chamar `carregarConvitesPendentes()` e mostrar o botão "Convidar" quando `renderUsersPrefs()` roda**

Local atual (início de `renderUsersPrefs()`):
```js
function renderUsersPrefs(){
  // Badge do role do usuário logado
  var myRole=currentUserRole();
  var badge=document.getElementById('pref-role-badge');
  if(badge){
    badge.textContent=ROLE_LABELS[myRole]||myRole;
    badge.style.cssText='font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;';
    if(myRole==='admin')badge.style.cssText+='background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)';
    else badge.style.cssText+='background:rgba(124,111,247,.15);color:#7c6ff7;border:1px solid rgba(124,111,247,.3)';
  }
```

Nova versão:
```js
function renderUsersPrefs(){
  // Badge do role do usuário logado
  var myRole=currentUserRole();
  var badge=document.getElementById('pref-role-badge');
  if(badge){
    badge.textContent=ROLE_LABELS[myRole]||myRole;
    badge.style.cssText='font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;';
    if(myRole==='admin')badge.style.cssText+='background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)';
    else badge.style.cssText+='background:rgba(124,111,247,.15);color:#7c6ff7;border:1px solid rgba(124,111,247,.3)';
  }
  var btnConvidar=document.getElementById('btn-convidar-usuario');
  if(btnConvidar)btnConvidar.style.display=isAdmin()?'inline-block':'none';
  carregarConvitesPendentes();
```

(`carregarConvitesPendentes()` é assíncrona e atualiza o subtítulo quando termina — não precisa de `await` aqui, `renderUsersPrefs()` continua síncrona como já era.)

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: implementa convidar/listar/cancelar convite de usuario"
```

---

### Task 5: Client — resgatar convite no boot e no switcher

**Files:**
- Modify: `index.html` (`resolveWorkspaceForLogin()`)
- Modify: `index.html` (`abrirSwitcher()`, ramo `!forced`)

**Interfaces:**
- Consumes: RPC `claim_invite()` (Task 2), `bootstrapLogin()`/`abrirSwitcher()` (Fase 2a, já existentes).
- Produces: `claimPendingInvites()` — usada tanto por `resolveWorkspaceForLogin()` quanto por `abrirSwitcher()`.

- [ ] **Step 1: Adicionar `claimPendingInvites()` e chamá-la em `resolveWorkspaceForLogin()` quando não há workspace nenhum**

Local atual:
```js
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

Nova versão:
```js
// Chamada só aqui e em abrirSwitcher() (nunca dentro de bootstrap_login()) —
// mantém a RPC de todo login intocada. Resgata convite(s) pendente(s) do
// e-mail logado; retorna true se algum foi resgatado.
async function claimPendingInvites(){
  try{
    var {data,error}=await sb.rpc('claim_invite');
    if(error)return false;
    return Array.isArray(data)&&data.length>0;
  }catch(e){return false;}
}
async function resolveWorkspaceForLogin(){
  var boot=await bootstrapLogin();
  var workspaces=boot.workspaces||[];
  if(workspaces.length===0){
    var claimed=await claimPendingInvites();
    if(claimed){
      boot=await bootstrapLogin();
      workspaces=boot.workspaces||[];
    }
  }
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

- [ ] **Step 2: Resgatar convite também na abertura manual do switcher**

Local atual:
```js
async function abrirSwitcher(forced){
  _switcherForced=!!forced;
  if(!forced){
    try{
      var boot=await bootstrapLogin();
      _BOOT_WORKSPACES=boot.workspaces||[];
      _CAN_CREATE_WORKSPACE=!!boot.can_create;
    }catch(e){toast('Erro ao carregar workspaces: '+e.message,true);return;}
  }
```

Nova versão:
```js
async function abrirSwitcher(forced){
  _switcherForced=!!forced;
  if(!forced){
    try{
      await claimPendingInvites();
      var boot=await bootstrapLogin();
      _BOOT_WORKSPACES=boot.workspaces||[];
      _CAN_CREATE_WORKSPACE=!!boot.can_create;
    }catch(e){toast('Erro ao carregar workspaces: '+e.message,true);return;}
  }
```

Cobre quem já tem acesso a algum workspace e recebeu um convite novo depois: da próxima vez que clicar no badge 🏢 (que chama `abrirSwitcher(false)`), o convite é resgatado antes da lista ser buscada, então já aparece no switcher.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: resgata convite pendente no boot e na abertura do switcher"
```

---

### Task 6: Aplicar em produção e roteiro de verificação manual

**Files:** nenhum (checkpoint operacional — pede confirmação explícita do usuário antes de cada sub-passo contra produção real)

- [ ] **Step 1: Aplicar as 2 migrações novas em produção**

Via SQL Editor do Supabase, como `postgres` (necessário pra `security definer` bypassar RLS de verdade, mesma exigência das fases anteriores), nesta ordem:
1. `2026-08-23_02_workspace_invites.sql`
2. `2026-08-23_03_claim_invite.sql`

Confirmar com o usuário antes de rodar.

- [ ] **Step 2: Deploy**

`git push origin main` (Netlify publica automaticamente). Confirmar com o usuário antes.

- [ ] **Step 3: Roteiro manual (porta 8080, login real)**

Seguir os 5 cenários da spec (seção 4):

1. Admin convida um e-mail que nunca logou → aparece em "Convites pendentes". Login desse e-mail (Google, porta 8080) → entra direto ativo no workspace, com o role escolhido — sem tela de aprovação.
2. Admin convida um e-mail que já tem acesso a outro workspace → nada muda até essa pessoa clicar no badge 🏢 (abrir o switcher); depois disso, o workspace novo aparece na lista.
3. Cancelar um convite antes de aceito → some da lista "Convites pendentes"; login desse e-mail depois cai no fluxo normal (sem acesso / criar workspace), sem entrar automaticamente.
4. Convidar o mesmo e-mail duas vezes pro mesmo workspace → erro inline "Já existe um convite pendente pra esse e-mail", sem travar o form.
5. Mesmo e-mail convidado por dois workspaces diferentes antes de logar → no primeiro login, `claim_invite()` resgata os dois de uma vez; como `workspaces.length` vira 2, cai no switcher (`forced`, sem escolha lembrada ainda).

- [ ] **Step 4: Registrar o resultado**

Depois do roteiro, resumir para o usuário quais dos 5 cenários passaram e quais não, sem assumir sucesso sem ter rodado de fato (`superpowers:verification-before-completion`).

---
