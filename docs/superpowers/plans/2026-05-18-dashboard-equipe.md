# Dashboard de Equipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Equipe" tab on the Dashboard for Gerentes PM (see their team's hours) and Superintendente (see all teams), with period-based filter (16→15 cycle).

**Architecture:** All changes are inline in `index.html`. New Supabase table `equipes` + two new columns in `profiles`. Six new permission/role entries. Dashboard tab and Preferences sections follow the same patterns already used by the "Central de Ajuda" tab and the "Redmine" prefs section.

**Tech Stack:** Vanilla JS, Supabase JS v2 (via `sb`), single-file HTML app, `homologacao` branch, `[skip netlify]` on all commits.

---

## File Map

| File | Change |
|---|---|
| `index.html` | Only file modified — all JS and HTML inline |
| SQL (manual) | equipes table + profiles columns + RLS |

---

### Task 1: SQL Setup (manual — run in Supabase SQL Editor)

**Files:**
- No file changes — SQL run manually by user

- [ ] **Step 1: Create `equipes` table**

```sql
CREATE TABLE equipes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome      TEXT NOT NULL,
  gestor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
```

- [ ] **Step 2: Add columns to `profiles`**

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS equipe_id    UUID    REFERENCES equipes(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gestor_geral BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 3: RLS on `equipes` table**

```sql
ALTER TABLE equipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados leem equipes"
ON equipes FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Admins gerenciam equipes"
ON equipes FOR ALL
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
```

- [ ] **Step 4: RLS on `pontos` — replace existing SELECT policy**

Check existing policies first:
```sql
SELECT policyname FROM pg_policies WHERE tablename = 'pontos' AND cmd = 'SELECT';
```

If a policy named something like `pontos_select` (which only allows `auth.uid() = user_id`) exists, drop it and replace:
```sql
-- Drop old policy (replace exact name from query above):
DROP POLICY IF EXISTS "pontos_select" ON pontos;
DROP POLICY IF EXISTS "Users can view own pontos" ON pontos;

-- New policy that also allows team managers:
CREATE POLICY "Usuarios e gestores veem pontos"
ON pontos FOR SELECT
USING (
  auth.uid() = user_id
  OR
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN equipes e ON e.id = p.equipe_id
    WHERE p.id = pontos.user_id
      AND e.gestor_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND gestor_geral = TRUE
  )
);
```

- [ ] **Step 5: Notify dev**

Run the SQL above in the Supabase SQL Editor. No commit needed (schema-only step).

---

### Task 2: Data Layer — S_EQUIPES, loadEquipes(), update loadUsers()

**Files:**
- Modify: `index.html` — near line 1060 (globals), line 1106 (`loadUsers`), line 1448 (`S` object), line 4042 (load function)

- [ ] **Step 1: Add `S_EQUIPES` global (line ~1061, after `S_ROLES`)**

Find:
```javascript
var S_ROLES=[];  // lista de todos os roles carregados do Supabase
```

Replace with:
```javascript
var S_ROLES=[];  // lista de todos os roles carregados do Supabase
var S_EQUIPES=[]; // lista de { id, nome, gestorId }
```

- [ ] **Step 2: Add `pontosEquipe` to S object (line ~1448)**

Find:
```javascript
var S={versoes:[],oss:[],pontos:[],publicacoes:[],filtro:'todos',filtroAtrib:'todos',filtroAtribuicao:'todos',bolFiltro:'todos',editOS:null,versaoK:null,
```

Replace with:
```javascript
var S={versoes:[],oss:[],pontos:[],pontosEquipe:[],publicacoes:[],filtro:'todos',filtroAtrib:'todos',filtroAtribuicao:'todos',bolFiltro:'todos',editOS:null,versaoK:null,
```

- [ ] **Step 3: Update `loadUsers()` to select `equipe_id` and `gestor_geral` (line ~1108)**

Find:
```javascript
    var {data:profiles}=await sb.from('profiles').select('id,nome,email,avatar_url,prefs,role');
```

Replace with:
```javascript
    var {data:profiles}=await sb.from('profiles').select('id,nome,email,avatar_url,prefs,role,equipe_id,gestor_geral');
```

- [ ] **Step 4: Map the new fields in `loadUsers()` (line ~1118)**

Find:
```javascript
        role:p.role||prefs.role||'visualizador',
        colorIdx:prefs.colorIdx!==undefined?prefs.colorIdx:null
      };
```

Replace with:
```javascript
        role:p.role||prefs.role||'visualizador',
        colorIdx:prefs.colorIdx!==undefined?prefs.colorIdx:null,
        equipeId:p.equipe_id||null,
        gestorGeral:!!p.gestor_geral
      };
```

- [ ] **Step 5: Add `loadEquipes()` function — insert after `loadUsers()` (after line ~1141)**

Insert after the closing brace of `loadUsers`:
```javascript

async function loadEquipes(){
  try{
    var {data,error}=await sb.from('equipes').select('id,nome,gestor_id');
    if(error)throw error;
    S_EQUIPES=(data||[]).map(function(e){return{id:e.id,nome:e.nome,gestorId:e.gestor_id};});
  }catch(e){console.warn('loadEquipes:',e);S_EQUIPES=[];}
}
```

- [ ] **Step 6: Call `loadEquipes()` in `load()` alongside `loadUsers()` (line ~4042)**

Find:
```javascript
    await loadUsers();
```

Replace with:
```javascript
    await loadUsers();
    await loadEquipes();
```

- [ ] **Step 7: Commit**

```
git add index.html
git commit -m "feat: data layer S_EQUIPES, loadEquipes, loadUsers equipe_id/gestor_geral [skip netlify]"
```

---

### Task 3: Permission Labels — add dashboard_equipe and dashboard_todas_equipes

**Files:**
- Modify: `index.html` — line ~1233 (`PERM_LABELS` in `renderRolesPrefs`)

- [ ] **Step 1: Add the two new permissions to PERM_LABELS**

Find:
```javascript
    'acoes.preferencias_admin':'Administrar Preferências'
  };
```

Replace with:
```javascript
    'acoes.preferencias_admin':'Administrar Preferências',
    'acoes.dashboard_equipe':'Dashboard: ver equipe própria',
    'acoes.dashboard_todas_equipes':'Dashboard: ver todas as equipes'
  };
```

- [ ] **Step 2: Commit**

```
git add index.html
git commit -m "feat: add dashboard_equipe and dashboard_todas_equipes to permission labels [skip netlify]"
```

---

### Task 4: Preferences — Equipes section (CRUD)

**Files:**
- Modify: `index.html` — HTML at line ~716, JS after `renderUsersPrefs` area, call at line ~1636

- [ ] **Step 1: Add `pref-section-equipes` HTML before `pref-section-users` (line ~717)**

Find:
```html
          <!-- USUÁRIOS DA PLATAFORMA -->
          <div class="pref-section" id="pref-section-users">
```

Replace with:
```html
          <!-- EQUIPES -->
          <div class="pref-section" id="pref-section-equipes" style="display:none"></div>

          <!-- USUÁRIOS DA PLATAFORMA -->
          <div class="pref-section" id="pref-section-users">
```

- [ ] **Step 2: Add `renderEquipesPrefs()` and CRUD helpers — insert before `renderRolesPrefs()` (line ~1227)**

Insert the following block immediately before `async function renderRolesPrefs()`:
```javascript
function renderEquipesPrefs(){
  var sec=document.getElementById('pref-section-equipes');
  if(!sec)return;
  if(!can('preferencias_admin')){sec.style.display='none';return;}
  sec.style.display='';
  var linhas=S_EQUIPES.map(function(e){
    var gestorNome='—';
    if(e.gestorId){var gu=S_USERS.find(function(u){return u.id===e.gestorId});if(gu)gestorNome=escHtml(gu.displayName);}
    return'<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border2)">'+
      '<div style="flex:1;font-size:13px">'+escHtml(e.nome)+'</div>'+
      '<div style="font-size:12px;color:var(--muted)">Gestor: '+gestorNome+'</div>'+
      '<button class="btn btn-xs btn-ghost" onclick="editarEquipe(\''+e.id+'\')">✏</button>'+
      '<button class="btn btn-xs btn-ghost" style="color:var(--err)" onclick="removerEquipe(\''+e.id+'\')">✕</button>'+
    '</div>';
  }).join('');
  sec.innerHTML=
    '<div class="pref-section-title">Equipes</div>'+
    '<div id="equipes-list">'+
      (linhas||'<div style="font-size:12px;color:var(--hint);padding:6px 0">Nenhuma equipe cadastrada.</div>')+
    '</div>'+
    '<button class="btn btn-sm" style="margin-top:12px" onclick="novaEquipeForm()">+ Nova equipe</button>'+
    '<div id="equipe-form" style="display:none;margin-top:12px;padding:12px;background:var(--card2);border-radius:var(--radius)">'+
      '<input type="hidden" id="equipe-form-id">'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
        '<input class="form-input" id="equipe-form-nome" placeholder="Nome da equipe" style="flex:1;min-width:150px">'+
        '<select class="form-input" id="equipe-form-gestor" style="flex:1;min-width:150px">'+
          '<option value="">— Sem gestor —</option>'+
          S_USERS.map(function(u){return'<option value="'+u.id+'">'+escHtml(u.displayName)+'</option>';}).join('')+
        '</select>'+
        '<button class="btn btn-sm" onclick="salvarEquipeForm()">Salvar</button>'+
        '<button class="btn btn-sm btn-ghost" onclick="cancelarEquipeForm()">Cancelar</button>'+
      '</div>'+
    '</div>';
}

function novaEquipeForm(){
  var f=document.getElementById('equipe-form');
  if(!f)return;
  document.getElementById('equipe-form-id').value='';
  document.getElementById('equipe-form-nome').value='';
  document.getElementById('equipe-form-gestor').value='';
  f.style.display='';
}

function editarEquipe(id){
  var e=S_EQUIPES.find(function(x){return x.id===id});if(!e)return;
  var f=document.getElementById('equipe-form');
  if(!f)return;
  document.getElementById('equipe-form-id').value=e.id;
  document.getElementById('equipe-form-nome').value=e.nome;
  document.getElementById('equipe-form-gestor').value=e.gestorId||'';
  f.style.display='';
}

function cancelarEquipeForm(){
  var f=document.getElementById('equipe-form');if(f)f.style.display='none';
}

async function salvarEquipeForm(){
  var id=document.getElementById('equipe-form-id').value.trim();
  var nome=document.getElementById('equipe-form-nome').value.trim();
  var gestorId=document.getElementById('equipe-form-gestor').value||null;
  if(!nome){toast('Informe o nome da equipe','err');return;}
  var payload={nome:nome,gestor_id:gestorId||null};
  if(id){
    var {error}=await sb.from('equipes').update(payload).eq('id',id);
    if(error){toast('Erro ao salvar equipe','err');return;}
    var eq=S_EQUIPES.find(function(x){return x.id===id});
    if(eq){eq.nome=nome;eq.gestorId=gestorId||null;}
  }else{
    var {data,error}=await sb.from('equipes').insert(payload).select().single();
    if(error){toast('Erro ao criar equipe','err');return;}
    S_EQUIPES.push({id:data.id,nome:data.nome,gestorId:data.gestor_id||null});
  }
  toast('Equipe salva!');
  cancelarEquipeForm();
  renderEquipesPrefs();
}

async function removerEquipe(id){
  if(!confirm('Remover esta equipe? Membros perderão a associação.'))return;
  var {error}=await sb.from('equipes').delete().eq('id',id);
  if(error){toast('Erro ao remover','err');return;}
  S_EQUIPES=S_EQUIPES.filter(function(x){return x.id!==id;});
  toast('Equipe removida');
  renderEquipesPrefs();
}

```

- [ ] **Step 3: Call `renderEquipesPrefs()` when Admin tab renders (line ~1636)**

Find:
```javascript
    renderRedmineConfig();renderZendeskConfig();renderRolesPrefs();renderUsersPrefs();
```

Replace with:
```javascript
    renderRedmineConfig();renderZendeskConfig();renderRolesPrefs();renderEquipesPrefs();renderUsersPrefs();
```

- [ ] **Step 4: Commit**

```
git add index.html
git commit -m "feat: preferences equipes section with CRUD [skip netlify]"
```

---

### Task 5: Preferences — Users equipe dropdown + gestor_geral checkbox

**Files:**
- Modify: `index.html` — `renderUsersPrefs()` (~line 1176), add `saveUserEquipe` and `saveUserGestorGeral` after `saveUserRole`

- [ ] **Step 1: Add equipe dropdown and gestor_geral checkbox to each user card in `renderUsersPrefs()` (line ~1213)**

In `renderUsersPrefs()`, inside the `el.innerHTML=sorted.map(...)` block, find the closing part of the `roleHtml` section where the card is assembled. Specifically, find (the return of the user card):

```javascript
    return'<div class="user-card">'+
      avatarHtml+
      '<div style="flex:1;min-width:0">'+
        '<div id="user-name-pref-'+u.id+'" style="font-size:13px;font-weight:500;color:var(--text);display:flex;align-items:center;gap:4px">'+
          '<span>'+nomeDisplay+(isMe?' <span style="font-size:10px;color:var(--hint)">(você)</span>':'')+' </span>'+
          editIcon+
        '</div>'+
        '<div style="font-size:11px;color:var(--hint);margin-top:1px">'+colorDot+'</div>'+
      '</div>'+
      roleHtml+
    '</div>';
```

Replace with:
```javascript
    var equipeHtml='';
    var gestorGeralHtml='';
    if(can('preferencias_admin')&&!isMe){
      var equipeOpts='<option value="">— Sem equipe —</option>'+
        S_EQUIPES.map(function(e){return'<option value="'+e.id+'"'+(u.equipeId===e.id?' selected':'')+'>'+escHtml(e.nome)+'</option>';}).join('');
      equipeHtml='<select onchange="saveUserEquipe(\''+u.id+'\',this.value)" style="border:1px solid var(--border);background:var(--card2);color:var(--text);font-size:11px;padding:3px 6px;border-radius:4px;cursor:pointer;margin-left:6px">'+equipeOpts+'</select>';
      gestorGeralHtml='<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);margin-left:8px;cursor:pointer">'+
        '<input type="checkbox" '+(u.gestorGeral?'checked':'')+' onchange="saveUserGestorGeral(\''+u.id+'\',this.checked)" style="accent-color:var(--accent)">'+
        'Gestor geral</label>';
    }
    return'<div class="user-card">'+
      avatarHtml+
      '<div style="flex:1;min-width:0">'+
        '<div id="user-name-pref-'+u.id+'" style="font-size:13px;font-weight:500;color:var(--text);display:flex;align-items:center;gap:4px">'+
          '<span>'+nomeDisplay+(isMe?' <span style="font-size:10px;color:var(--hint)">(você)</span>':'')+' </span>'+
          editIcon+
        '</div>'+
        '<div style="font-size:11px;color:var(--hint);margin-top:1px">'+colorDot+'</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0">'+
        roleHtml+equipeHtml+gestorGeralHtml+
      '</div>'+
    '</div>';
```

- [ ] **Step 2: Add `saveUserEquipe` and `saveUserGestorGeral` after `saveUserRole` (line ~1153)**

Find (the closing brace and blank line after `saveUserRole`):
```javascript
  u.role=newRole;
  renderUsersPrefs();
  toast('Role atualizado!');
}
```

After that closing `}`, insert:
```javascript

async function saveUserEquipe(userId,equipeId){
  var u=S_USERS.find(function(x){return x.id===userId});if(!u)return;
  var val=equipeId||null;
  var {error}=await sb.from('profiles').update({equipe_id:val}).eq('id',userId);
  if(error){toast('Erro ao salvar equipe','err');return;}
  u.equipeId=val;
  toast('Equipe atualizada');
}

async function saveUserGestorGeral(userId,checked){
  var u=S_USERS.find(function(x){return x.id===userId});if(!u)return;
  var {error}=await sb.from('profiles').update({gestor_geral:checked}).eq('id',userId);
  if(error){toast('Erro ao salvar','err');return;}
  u.gestorGeral=checked;
  toast('Gestor geral '+(checked?'ativado':'desativado'));
}
```

- [ ] **Step 3: Commit**

```
git add index.html
git commit -m "feat: users prefs equipe dropdown and gestor_geral checkbox [skip netlify]"
```

---

### Task 6: Dashboard — Equipe tab

**Files:**
- Modify: `index.html` — HTML ~line 380 (tab button + panel), JS at `setDashTab` (~line 4614), new state variable + render functions, `renderDash` tab visibility (~line 1649)

- [ ] **Step 1: Add tab button and panel HTML (line ~381, after `dash-tab-btn-ajuda`)**

Find:
```html
          <div id="dash-tab-btn-ajuda" onclick="setDashTab('ajuda')" style="padding:8px 18px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);margin-bottom:-1px;user-select:none">🎓 Central de Ajuda</div>
        </div>
```

Replace with:
```html
          <div id="dash-tab-btn-ajuda" onclick="setDashTab('ajuda')" style="padding:8px 18px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);margin-bottom:-1px;user-select:none">🎓 Central de Ajuda</div>
          <div id="dash-tab-btn-equipe" onclick="setDashTab('equipe')" style="display:none;padding:8px 18px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);margin-bottom:-1px;user-select:none">👥 Equipe</div>
        </div>
```

- [ ] **Step 2: Add equipe panel HTML (after the `dash-screen-ajuda` closing div, before `</div>` of `screen-dashboard`)**

Find:
```html
        </div>
      </div>

      <!-- KANBAN -->
```

Replace with:
```html
        </div>
        <!-- Tab: Equipe -->
        <div id="dash-screen-equipe" style="display:none"></div>
      </div>

      <!-- KANBAN -->
```

- [ ] **Step 3: Add `_dashEquipe` state variable (after `_ajudaPeriodo` or similar globals, line ~1452 area)**

Find:
```javascript
var _agendaMes=new Date().getMonth(),_agendaAno=new Date().getFullYear(),_agendaFiltro='todos';
```

Replace with:
```javascript
var _agendaMes=new Date().getMonth(),_agendaAno=new Date().getFullYear(),_agendaFiltro='todos';
var _dashEquipe={periodoOffset:0,equipeId:'todas',pessoaId:'todas'};
```

- [ ] **Step 4: Update `setDashTab()` to handle 3 tabs (line ~4614)**

Find and replace the entire function:
```javascript
function setDashTab(tab){
  var vs=document.getElementById('dash-screen-versao');
  var aj=document.getElementById('dash-screen-ajuda');
  var bv=document.getElementById('dash-tab-btn-versao');
  var ba=document.getElementById('dash-tab-btn-ajuda');
  if(!vs||!aj||!bv||!ba)return;
  var isAjuda=(tab==='ajuda');
  vs.style.display=isAjuda?'none':'';
  aj.style.display=isAjuda?'':'none';
  bv.style.borderBottomColor=isAjuda?'transparent':'var(--accent)';
  bv.style.color=isAjuda?'var(--muted)':'var(--accent)';
  ba.style.borderBottomColor=isAjuda?'var(--accent)':'transparent';
  ba.style.color=isAjuda?'var(--accent)':'var(--muted)';
  if(isAjuda&&!_ajudaDados.articles.length)loadCentralAjuda();
}
```

Replace with:
```javascript
function setDashTab(tab){
  ['versao','ajuda','equipe'].forEach(function(t){
    var panel=document.getElementById('dash-screen-'+t);
    var btn=document.getElementById('dash-tab-btn-'+t);
    var active=(t===tab);
    if(panel)panel.style.display=active?'':'none';
    if(btn){
      btn.style.borderBottomColor=active?'var(--accent)':'transparent';
      btn.style.color=active?'var(--accent)':'var(--muted)';
    }
  });
  if(tab==='ajuda'&&!_ajudaDados.articles.length)loadCentralAjuda();
  if(tab==='equipe')renderDashEquipe();
}
```

- [ ] **Step 5: Show/hide equipe tab button in `renderDash()` (line ~1649)**

Find (first lines of `renderDash`):
```javascript
function renderDash(){
  // Popula select de versão
  var vfEl=document.getElementById('dash-versao-filtro');
```

Replace with:
```javascript
function renderDash(){
  var tabEqBtn=document.getElementById('dash-tab-btn-equipe');
  if(tabEqBtn)tabEqBtn.style.display=(can('dashboard_equipe')||can('dashboard_todas_equipes')||isAdmin())?'':'none';
  // Popula select de versão
  var vfEl=document.getElementById('dash-versao-filtro');
```

- [ ] **Step 6: Add `calcPeriodoEquipe`, `labelPeriodoEquipe`, `loadPontosEquipe`, `renderDashEquipe`, `renderDashEquipeTabela`, `atualizarDashEquipe` — insert after `setDashTab` function (after line ~4628)**

Insert the following block immediately after the closing brace of `setDashTab`:
```javascript

function calcPeriodoEquipe(offset){
  var hoje=new Date();
  var day=hoje.getDate();
  var baseMes=day>15?hoje.getMonth():hoje.getMonth()-1;
  var baseAno=hoje.getFullYear();
  while(baseMes<0){baseMes+=12;baseAno--;}
  var mes=baseMes+offset,ano=baseAno;
  while(mes<0){mes+=12;ano--;}
  while(mes>11){mes-=12;ano++;}
  var inicio=ano+'-'+String(mes+1).padStart(2,'0')+'-16';
  var fimMes=mes+1,fimAno=ano;
  if(fimMes>11){fimMes=0;fimAno++;}
  var fim=fimAno+'-'+String(fimMes+1).padStart(2,'0')+'-15';
  return{inicio:inicio,fim:fim};
}

function labelPeriodoEquipe(inicio,fim){
  var M=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  var mi=parseInt(inicio.split('-')[1],10)-1;
  var mf=parseInt(fim.split('-')[1],10)-1;
  return'16/'+M[mi]+' – 15/'+M[mf];
}

async function loadPontosEquipe(userIds,inicio,fim){
  if(!userIds||!userIds.length){S.pontosEquipe=[];return;}
  try{
    var {data,error}=await sb.from('pontos')
      .select('id,user_id,data,horas_trabalhadas,apropriacoes')
      .in('user_id',userIds)
      .gte('data',inicio)
      .lte('data',fim);
    if(error)throw error;
    S.pontosEquipe=(data||[]).map(function(p){return{
      id:p.id,userId:p.user_id,data:p.data,
      horasTrabalhadas:parseFloat(p.horas_trabalhadas)||0,
      apropriacoes:p.apropriacoes||[]
    };});
  }catch(e){console.warn('loadPontosEquipe:',e);S.pontosEquipe=[];}
}

async function atualizarDashEquipe(){
  S.pontosEquipe=[];
  await renderDashEquipe();
}

async function renderDashEquipe(){
  var el=document.getElementById('dash-screen-equipe');if(!el)return;
  var periodo=calcPeriodoEquipe(_dashEquipe.periodoOffset);
  var label=labelPeriodoEquipe(periodo.inicio,periodo.fim);
  var showEquipeFilter=can('dashboard_todas_equipes')||isAdmin();
  var equipes=showEquipeFilter?S_EQUIPES:S_EQUIPES.filter(function(e){return e.gestorId===CURRENT_USER.id;});
  if(!showEquipeFilter&&equipes.length)_dashEquipe.equipeId=equipes[0].id;
  var equipeId=_dashEquipe.equipeId;
  var membros=equipeId==='todas'
    ?S_USERS.filter(function(u){return equipes.some(function(e){return u.equipeId===e.id;});})
    :S_USERS.filter(function(u){return u.equipeId===equipeId;});
  var pessoaId=_dashEquipe.pessoaId;
  var equipeFilterHtml=showEquipeFilter
    ?'<select class="form-input" style="width:auto;font-size:13px" onchange="_dashEquipe.equipeId=this.value;_dashEquipe.pessoaId=\'todas\';renderDashEquipe()">'+
      '<option value="todas">Todas</option>'+
      equipes.map(function(e){return'<option value="'+e.id+'"'+(e.id===equipeId?' selected':'')+'>'+escHtml(e.nome)+'</option>';}).join('')+
      '</select>'
    :'';
  var pessoaFilterHtml='<select class="form-input" style="width:auto;font-size:13px" onchange="_dashEquipe.pessoaId=this.value;renderDashEquipe()">'+
    '<option value="todas">Todas as pessoas</option>'+
    membros.map(function(u){return'<option value="'+u.id+'"'+(u.id===pessoaId?' selected':'')+'>'+escHtml(u.displayName)+'</option>';}).join('')+
    '</select>';
  el.innerHTML=
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap">'+
      '<button class="btn btn-sm btn-ghost" onclick="_dashEquipe.periodoOffset--;S.pontosEquipe=[];renderDashEquipe()">←</button>'+
      '<span style="font-size:14px;font-weight:500;min-width:145px;text-align:center">'+label+'</span>'+
      '<button class="btn btn-sm btn-ghost" onclick="_dashEquipe.periodoOffset++;S.pontosEquipe=[];renderDashEquipe()">→</button>'+
      (equipeFilterHtml?'<div style="margin-left:8px">'+equipeFilterHtml+'</div>':'')+
      '<div>'+pessoaFilterHtml+'</div>'+
      '<button class="btn btn-sm btn-ghost" style="margin-left:auto" onclick="atualizarDashEquipe()">↻ Atualizar</button>'+
    '</div>'+
    '<div id="dash-equipe-tabela"><div style="color:var(--muted);font-size:13px;padding:20px 0">Carregando...</div></div>';
  var userIds=(pessoaId==='todas'?membros:membros.filter(function(u){return u.id===pessoaId;})).map(function(u){return u.id;});
  await loadPontosEquipe(userIds,periodo.inicio,periodo.fim);
  var visiveis=pessoaId==='todas'?membros:membros.filter(function(u){return u.id===pessoaId;});
  renderDashEquipeTabela(visiveis);
}

function renderDashEquipeTabela(membros){
  var el=document.getElementById('dash-equipe-tabela');if(!el)return;
  if(!membros.length){el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">Nenhum membro nesta equipe no período.</div>';return;}
  var MESES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  var rows=membros.map(function(u){
    var pu=S.pontosEquipe.filter(function(p){return p.userId===u.id;});
    var hP=pu.reduce(function(a,p){return a+(p.horasTrabalhadas||0);},0);
    var hA=pu.reduce(function(a,p){return a+((p.apropriacoes||[]).reduce(function(b,x){return b+(x.horas||0);},0));},0);
    var pct=hP>0?Math.round(hA/hP*1000)/10:null;
    return{nome:u.displayName,hP:hP,hA:hA,pct:pct};
  }).sort(function(a,b){return a.nome.localeCompare(b.nome);});
  var totP=rows.reduce(function(a,r){return a+r.hP;},0);
  var totA=rows.reduce(function(a,r){return a+r.hA;},0);
  var totPct=totP>0?Math.round(totA/totP*1000)/10:null;
  function pctColor(pct){if(pct===null)return'color:var(--muted)';if(pct>=95)return'color:#22c55e';if(pct>=80)return'color:#f59e0b';return'color:#ef4444';}
  function fH(h){return h>0?h.toFixed(1)+'h':'—';}
  function fP(p){return p!==null?p.toFixed(1)+'%':'—';}
  var th='<tr style="font-size:12px;color:var(--muted);border-bottom:1px solid var(--border)">'+
    '<th style="text-align:left;padding:8px 12px;font-weight:500">Pessoa</th>'+
    '<th style="text-align:right;padding:8px 12px;font-weight:500">Hora Ponto</th>'+
    '<th style="text-align:right;padding:8px 12px;font-weight:500">Hora Apropriada</th>'+
    '<th style="text-align:right;padding:8px 12px;font-weight:500">% Apropriada</th></tr>';
  var tb=rows.map(function(r){
    return'<tr style="border-bottom:1px solid var(--border2);font-size:13px">'+
      '<td style="padding:8px 12px">'+escHtml(r.nome)+'</td>'+
      '<td style="text-align:right;padding:8px 12px;color:var(--muted)">'+fH(r.hP)+'</td>'+
      '<td style="text-align:right;padding:8px 12px;color:var(--muted)">'+fH(r.hA)+'</td>'+
      '<td style="text-align:right;padding:8px 12px;'+pctColor(r.pct)+'">'+fP(r.pct)+'</td></tr>';
  }).join('');
  var tf='<tr style="font-size:13px;font-weight:600;border-top:2px solid var(--border)">'+
    '<td style="padding:8px 12px">Total</td>'+
    '<td style="text-align:right;padding:8px 12px">'+fH(totP)+'</td>'+
    '<td style="text-align:right;padding:8px 12px">'+fH(totA)+'</td>'+
    '<td style="text-align:right;padding:8px 12px;'+pctColor(totPct)+'">'+fP(totPct)+'</td></tr>';
  el.innerHTML='<table style="width:100%;border-collapse:collapse">'+
    '<thead>'+th+'</thead><tbody>'+tb+'</tbody><tfoot>'+tf+'</tfoot></table>';
}
```

- [ ] **Step 7: Commit**

```
git add index.html
git commit -m "feat: dashboard equipe tab with period filter, team filter, hours table [skip netlify]"
```

---

## Self-Review

### Spec Coverage Check

| Spec requirement | Task |
|---|---|
| `equipes` table with `id, nome, gestor_id` | Task 1 |
| `profiles.equipe_id` and `profiles.gestor_geral` | Task 1 |
| RLS: gestores veem pontos da equipe + gestor_geral | Task 1 |
| `dashboard_equipe` permission | Task 3 + Task 6 |
| `dashboard_todas_equipes` permission | Task 3 + Task 6 |
| Equipes section in Preferences (CRUD) | Task 4 |
| Equipe dropdown in Users section | Task 5 |
| Gestor geral checkbox in Users section | Task 5 |
| Dashboard "Equipe" tab (conditional show) | Task 6 |
| Period filter with ← → navigation, default current cycle | Task 6 |
| Team filter (only for `dashboard_todas_equipes` or admin) | Task 6 |
| Person filter | Task 6 |
| Table: Pessoa, Hora Ponto, Hora Apropriada, % Apropriada | Task 6 |
| Total row | Task 6 |
| Color coding on % (≥95 verde, 80–94 amarelo, <80 vermelho, null cinza) | Task 6 |
| Membros sem ponto exibem `—` | Task 6 (fH/fP return `—` when zero/null) |
| `loadPontosEquipe` lazy on tab open | Task 6 |
| Gerente PM sees only own team (no team filter) | Task 6 |

### Placeholder Scan
None found — all steps include complete code.

### Type Consistency
- `S_EQUIPES[].gestorId` → used consistently in Task 2, 4, 5, 6
- `S_USERS[].equipeId` → used consistently in Task 2, 5, 6
- `S_USERS[].gestorGeral` → used consistently in Task 2, 5
- `S.pontosEquipe[].userId` → used consistently in Task 2, 6
- `_dashEquipe.periodoOffset` → used consistently in Task 3 state, Task 6 render functions
