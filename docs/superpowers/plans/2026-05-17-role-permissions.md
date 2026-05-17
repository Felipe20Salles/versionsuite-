# Role Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar sistema de permissões granular por role no VersionSuite, carregando permissões do Supabase e aplicando na interface.

**Architecture:** Adicionar `CURRENT_ROLE` e `S_ROLES` como globals. Funções `can()` e `canMenu()` consultam `CURRENT_ROLE.permissoes` para cada verificação. O carregamento ocorre no `load()` assíncrono, junto com os outros dados do Supabase.

**Tech Stack:** Vanilla JS, Supabase JS v2, HTML único (`index.html`). Sem framework, sem build step.

---

## Mapa de Arquivos

Único arquivo modificado: `index.html` (`C:\Users\costa\OneDrive\Documentos\GitHub\versionsuite-\index.html`)

| Área | Linha atual | O que muda |
|---|---|---|
| Globals de roles | ~963–990 | Remove `membro`, adiciona `S_ROLES`, atualiza `isAdmin()`, adiciona `can()` e `canMenu()` |
| `CURRENT_USER` | ~3539 | Adiciona `var CURRENT_ROLE = null;` ao lado |
| `load()` async | ~3661–3728 | Carrega `CURRENT_ROLE` e `S_ROLES` do Supabase |
| `goScreen()` | ~1330–1367 | Sidebar visibility + topbar actions com `can()` / `canMenu()` |
| `renderKanban()` | ~1502–1523 | Separa botão Editar (`can('os_editar')`) do botão Deletar (`can('os_deletar_propria')`) |
| `canEditOS()` | ~979–983 | Simplifica para usar `can('os_editar')` |
| `deleteOS()` | ~3949 | Troca guard para `can('os_deletar_propria')` |
| `bolRenderOSItem()` | ~1730–1835 | Corpo edit vs. read-only por `can('boletim_editar')` |
| `renderAgenda()` | ~3482 | Pills de publicação: clique abre edit só se `can('agenda_editar')` |
| HTML Preferências | ~617–630 | Adiciona `<div id="pref-section-roles">` antes da seção de usuários |
| `goScreen()` preferencias | ~1362 | Chama `renderRolesPrefs()` |
| Nova função `renderRolesPrefs()` | — | Nova função após `renderUsersPrefs()` |
| `renderUsersPrefs()` | ~1039–1100 | Select de roles dinâmico + badge âmbar para não configurados |
| `saveUserRole()` | ~1030–1037 | Usa roles dinâmicos de `S_ROLES` |

---

## Task 1: Globals — CURRENT_ROLE, S_ROLES, can(), canMenu(), isAdmin()

**Files:**
- Modify: `index.html:963–990` (globals de roles)
- Modify: `index.html:3539` (declaração de CURRENT_USER)

- [ ] **Passo 1: Atualizar bloco de globals de roles (linha ~963–990)**

Substituir o bloco atual:
```javascript
// ── SISTEMA DE USUÁRIOS / ROLES ───────────────────────────────────────────────
// Roles: 'admin' | 'membro' | 'visualizador'
// Armazenado em profiles.prefs.role + profiles.prefs.displayName + profiles.prefs.color
// Admin pode alterar roles de outros. Membro/Visualizador só vê.

var S_USERS=[];  // lista de { id, email, displayName, avatar, role, colorIdx }

var ROLE_LABELS={admin:'Admin',membro:'Membro',visualizador:'Visualizador'};
var ROLE_PRIORITY={admin:0,membro:1,visualizador:2};

function currentUserRole(){
  var u=S_USERS.find(function(x){return x.id===CURRENT_USER.id});
  return u?u.role:'membro';
}
function isAdmin(){return currentUserRole()==='admin';}
function isVisualizador(){return currentUserRole()==='visualizador';}
function canEditOS(os){
  var role=currentUserRole();
  if(role==='admin')return true;
  if(role==='visualizador')return false;
  return !!(os&&CURRENT_USER&&os.createdBy===CURRENT_USER.id);
}
function canEditVersao(v){
  var role=currentUserRole();
  if(role==='admin')return true;
  if(role==='visualizador')return false;
  return !!(v&&CURRENT_USER&&v.createdBy===CURRENT_USER.id);
}
```

Por:
```javascript
// ── SISTEMA DE USUÁRIOS / ROLES ───────────────────────────────────────────────
// Roles carregados do Supabase (tabela 'roles'). Default: 'visualizador'.
// S_ROLES: [ { id, nome, label, permissoes: { acoes:{}, menus:{} } } ]
// CURRENT_ROLE: row do role do usuário logado (ou null se não encontrado).

var S_USERS=[];  // lista de { id, email, displayName, avatar, role, colorIdx }
var S_ROLES=[];  // lista de todos os roles carregados do Supabase

var ROLE_LABELS={admin:'Admin',visualizador:'Visualizador'};
var ROLE_PRIORITY={admin:0,visualizador:99};

function currentUserRole(){
  var u=S_USERS.find(function(x){return x.id===CURRENT_USER.id});
  return u?u.role:'visualizador';
}
function isAdmin(){return !!(CURRENT_ROLE&&CURRENT_ROLE.nome==='admin');}
function isVisualizador(){return !CURRENT_ROLE||CURRENT_ROLE.nome==='visualizador';}
function can(acao){
  if(!CURRENT_USER||CURRENT_USER.isVisitor||!CURRENT_ROLE)return false;
  return !!(CURRENT_ROLE.permissoes&&CURRENT_ROLE.permissoes.acoes&&CURRENT_ROLE.permissoes.acoes[acao]);
}
function canMenu(menu){
  if(!CURRENT_USER||CURRENT_USER.isVisitor||!CURRENT_ROLE)return false;
  return !!(CURRENT_ROLE.permissoes&&CURRENT_ROLE.permissoes.menus&&CURRENT_ROLE.permissoes.menus[menu]);
}
function canEditOS(os){return can('os_editar');}
function canEditVersao(v){
  if(!CURRENT_ROLE)return false;
  return isAdmin()||(can('os_editar')&&!!(v&&CURRENT_USER&&v.createdBy===CURRENT_USER.id));
}
```

- [ ] **Passo 2: Adicionar CURRENT_ROLE junto a CURRENT_USER (linha ~3539)**

Localizar:
```javascript
var CURRENT_USER=null;
```

Substituir por:
```javascript
var CURRENT_USER=null;
var CURRENT_ROLE=null;
```

- [ ] **Passo 3: Verificar manualmente no browser**

Abrir `index.html` no browser. Abrir o Console (F12). Digitar `can('os_criar')` — deve retornar `false` (CURRENT_ROLE ainda é null). Digitar `typeof canMenu` — deve retornar `"function"`. Sem erros no console.

- [ ] **Passo 4: Commit**

```bash
git add index.html
git commit -m "feat: adiciona can(), canMenu(), S_ROLES e CURRENT_ROLE"
```

---

## Task 2: Carregar CURRENT_ROLE e S_ROLES no load()

**Files:**
- Modify: `index.html:3661–3728` (função `load()` assíncrona)

- [ ] **Passo 1: Adicionar carregamento de S_ROLES e CURRENT_ROLE após o bloco de prefs (linha ~3687)**

Localizar este trecho no `load()`:
```javascript
    if(prof&&prof.prefs){
      var pr=prof.prefs;
      if(pr.accent){S.prefs.accent=pr.accent;S.prefs.accentRgb=pr.accentRgb||S.prefs.accentRgb}
      if(pr.lightMode!==undefined)S.prefs.lightMode=pr.lightMode;
    }
```

Adicionar **após** esse bloco:
```javascript
    // Carregar todos os roles disponíveis
    var {data:rolesData}=await sb.from('roles').select('*');
    S_ROLES=rolesData||[];
    // Popular ROLE_LABELS dinamicamente com roles da tabela
    S_ROLES.forEach(function(r){ROLE_LABELS[r.nome]=r.label||r.nome;});

    // Carregar role do usuário atual
    var roleNome=(prof&&prof.prefs&&prof.prefs.role)||'visualizador';
    CURRENT_ROLE=S_ROLES.find(function(r){return r.nome===roleNome})||null;
```

- [ ] **Passo 2: Verificar no browser após login**

Fazer login na aplicação. Abrir o Console (F12). Digitar `CURRENT_ROLE` — deve retornar o objeto do role do usuário logado (ex: `{id: "...", nome: "admin", label: "Administrador", permissoes: {...}}`). Digitar `S_ROLES.length` — deve retornar o número de roles na tabela (6).

- [ ] **Passo 3: Verificar can() com role real**

No console, digitar `can('os_criar')` — se o usuário for admin, deve retornar `true`. Digitar `canMenu('boletim')` — resultado deve bater com as permissões do role.

- [ ] **Passo 4: Commit**

```bash
git add index.html
git commit -m "feat: carrega CURRENT_ROLE e S_ROLES do Supabase no load()"
```

---

## Task 3: Aplicar permissões na sidebar e topbar via goScreen()

**Files:**
- Modify: `index.html:1330–1367` (função `goScreen()`)

- [ ] **Passo 1: Atualizar goScreen() — sidebar e topbar actions**

Localizar o início de `goScreen()` até o trecho de `acts`:
```javascript
  var isVisitor=CURRENT_USER&&CURRENT_USER.isVisitor;
  var acts={dashboard:isVisitor?'':'<button class="btn btn-primary btn-sm" onclick="openNovaVersao()">+ Nova versão</button>',
    kanban:isVisitor?'':'<button class="btn btn-primary btn-sm" onclick="openNovaOS()">+ Nova OS</button>',
    boletim:'',ponto:isVisitor?'':'<button class="btn btn-primary btn-sm" onclick="openNovoRegistro()">+ Adicionar dia</button>',
    historico:'',preferencias:'',agenda:isVisitor?'':'<button class="btn btn-primary btn-sm" onclick="openNovaPublicacao()">+ Nova publicação</button>'};
```

Substituir por:
```javascript
  var isVisitor=CURRENT_USER&&CURRENT_USER.isVisitor;
  var acts={
    dashboard:isVisitor?'':'<button class="btn btn-primary btn-sm" onclick="openNovaVersao()">+ Nova versão</button>',
    kanban:(!isVisitor&&can('os_criar'))?'<button class="btn btn-primary btn-sm" onclick="openNovaOS()">+ Nova OS</button>':'',
    boletim:'',
    ponto:(!isVisitor&&canMenu('ponto'))?'<button class="btn btn-primary btn-sm" onclick="openNovoRegistro()">+ Adicionar dia</button>':'',
    historico:'',preferencias:'',
    agenda:(!isVisitor&&can('agenda_editar'))?'<button class="btn btn-primary btn-sm" onclick="openNovaPublicacao()">+ Nova publicação</button>':''
  };
```

- [ ] **Passo 2: Adicionar visibilidade dos itens de sidebar após o bloco de acts**

Localizar logo após a linha `document.getElementById('topbar-actions').innerHTML=acts[name]||'';`:
```javascript
  document.getElementById('topbar-sub').textContent='';
```

Adicionar **antes** desta linha:
```javascript
  // Sidebar: aplicar permissões de menu
  var navBoletim=document.getElementById('nav-boletim');
  var navPonto=document.getElementById('nav-ponto');
  var navPrefs=document.getElementById('nav-preferencias');
  if(navBoletim)navBoletim.style.display=(!isVisitor&&canMenu('boletim'))?'':'none';
  if(navPonto)navPonto.style.display=(!isVisitor&&canMenu('ponto'))?'':'none';
  if(navPrefs)navPrefs.style.display=(!isVisitor&&canMenu('preferencias'))?'':'none';
```

- [ ] **Passo 3: Verificar no browser**

Logar com um usuário cujo role não tem `menus.boletim`. Navegar entre telas. Os itens Boletim e/ou Ponto devem sumir da sidebar. Logar como admin — todos os itens devem aparecer. Navegar para Kanban: o botão "+ Nova OS" deve aparecer apenas para roles com `acoes.os_criar = true`.

- [ ] **Passo 4: Commit**

```bash
git add index.html
git commit -m "feat: aplica canMenu() e can() na sidebar e topbar via goScreen()"
```

---

## Task 4: Aplicar permissões nos botões de OS no Kanban

**Files:**
- Modify: `index.html:1502–1523` (dentro de `renderKanban()`)
- Modify: `index.html:3949` (guard em `deleteOS()`)

- [ ] **Passo 1: Separar lógica de editar e deletar em renderKanban()**

Localizar (linha ~1502–1523):
```javascript
      var canEd=canEditOS(os);
      return'<div class="os-card'+(isIncompleta?' os-incompleta':'')+'">'+
        ...
        '<div class="os-card-actions">'+
          '<div class="os-action-row">'+
            (canEd?'<button class="os-action-btn edit" onclick="event.stopPropagation();openEditOS(\''+os.id+'\')">✏ Editar</button>':'')+
            (canEd?'<button class="os-action-btn del" onclick="event.stopPropagation();deleteOS(\''+os.id+'\')">✕ Deletar</button>':'')+
```

Substituir as duas linhas de `canEd`:
```javascript
      var canEd=can('os_editar');
      var canDel=can('os_deletar_propria')&&os.createdBy===CURRENT_USER.id;
      return'<div class="os-card'+(isIncompleta?' os-incompleta':'')+'">'+
        ...
        '<div class="os-card-actions">'+
          '<div class="os-action-row">'+
            (canEd?'<button class="os-action-btn edit" onclick="event.stopPropagation();openEditOS(\''+os.id+'\')">✏ Editar</button>':'')+
            (canDel?'<button class="os-action-btn del" onclick="event.stopPropagation();deleteOS(\''+os.id+'\')">✕ Deletar</button>':'')+
```

- [ ] **Passo 2: Atualizar guard de deleteOS() (linha ~3949)**

Localizar:
```javascript
  if(!canEditOS(os)){toast('Sem permissão para deletar esta OS','err');return}
```

Substituir por:
```javascript
  if(!can('os_deletar_propria')||os.createdBy!==CURRENT_USER.id){toast('Sem permissão para deletar esta OS','err');return}
```

- [ ] **Passo 3: Verificar no browser**

Logar como PM (role com `os_editar: true` e `os_deletar_propria: true`). Abrir o Kanban. Verificar que botão Editar aparece em todas as OSs, mas Deletar só aparece nas OSs criadas pelo próprio usuário. Logar como documentacao (sem permissão de editar) — nenhum botão deve aparecer.

- [ ] **Passo 4: Commit**

```bash
git add index.html
git commit -m "feat: separa permissões os_editar e os_deletar_propria no Kanban"
```

---

## Task 5: Aplicar permissão de edição no Boletim

**Files:**
- Modify: `index.html:1730–1835` (função `bolRenderOSItem()`)
- Modify: `index.html:432` (botão "+ Adicionar OS" no HTML do boletim)

- [ ] **Passo 1: Ocultar botão "+ Adicionar OS" no HTML**

Localizar (linha ~432):
```html
            <button class="btn btn-primary btn-sm" onclick="bolAdicionarOS()">+ Adicionar OS</button>
```

Substituir por:
```html
            <button id="bol-btn-add-os" class="btn btn-primary btn-sm" onclick="bolAdicionarOS()">+ Adicionar OS</button>
```

- [ ] **Passo 2: Controlar visibilidade do botão em setBolTab()**

Localizar a função `setBolTab`:
```javascript
function setBolTab(t){BOL_TAB=t;bolRenderOSList();}
```

Substituir por:
```javascript
function setBolTab(t){BOL_TAB=t;bolRenderOSList();var b=document.getElementById('bol-btn-add-os');if(b)b.style.display=can('boletim_editar')?'':'none';}
```

- [ ] **Passo 3: Tornar bolRenderOSItem() sensível a permissões**

No início de `bolRenderOSItem(os)` (linha ~1730), adicionar logo após `var b=BOL_BADGE_STYLES[os.badge]||BOL_BADGE_STYLES.melhoria;`:

```javascript
  var podeEditar=can('boletim_editar');
```

No final de `bolRenderOSItem()`, localizar o trecho que define o `bodyStyle` e o retorno do item (linha ~1782–1835). Envolver o conteúdo do body expandível com um condicional:

Localizar:
```javascript
  var bodyStyle=os.open?'display:block':'display:none';
  return'<div id="bol-item-'+os.id+'"...>'+
    '<div ...onclick="bolToggleOS(\''+os.id+'\')">'+
      ...
    '</div>'+
    '<div id="bol-body-'+os.id+'" style="'+bodyStyle+';padding:14px 16px;border-top:1px solid var(--border)">'+
      pdfBlock+textoBlock+aiBlock+
      ...
    '</div>'+
  '</div>';
```

Alterar o body para mostrar modo edição ou leitura:
```javascript
  var bodyStyle=os.open?'display:block':'display:none';
  var bodyContent=podeEditar
    ? pdfBlock+textoBlock+aiBlock+
      '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.3px">Tipo</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">'+badgeSel+'</div>'+
      // ... (manter todo o conteúdo atual do body até o fechamento)
    : '<div style="padding:8px 0;font-size:13px;color:var(--muted)">'+
        '<div style="font-weight:500;margin-bottom:4px">'+escHtml(os.titulo)+'</div>'+
        (os.descricao?'<div style="font-size:12px;line-height:1.6">'+os.descricao+'</div>':'')+
        (os.aprovado?'<div style="margin-top:8px"><span style="font-size:11px;background:var(--green-dim);color:var(--green-text);padding:2px 8px;border-radius:10px">✓ Aprovado</span></div>':'')+
      '</div>';
```

> **Nota de implementação:** O `bodyContent` no modo editor deve conter todo o HTML que estava antes entre as tags do body (pdfBlock, textoBlock, aiBlock, badgeSel, inputs de título, descrição, imagens, e os botões Aprovar/Remover do rodapé). Apenas mover para dentro da branch `podeEditar ? ... : ...`.

- [ ] **Passo 4: Verificar no browser**

Logar como usuário sem `boletim_editar`. Navegar para Boletim. O botão "+ Adicionar OS" não deve aparecer. Clicar em um item — deve expandir mostrando apenas título e descrição. Logar como admin — botão aparece e itens abrem com o editor completo.

- [ ] **Passo 5: Commit**

```bash
git add index.html
git commit -m "feat: aplica can('boletim_editar') no Boletim"
```

---

## Task 6: Aplicar permissão de edição na Agenda

**Files:**
- Modify: `index.html:3482` (pills de publicação em `renderAgenda()`)

- [ ] **Passo 1: Condicionar onclick das pills à permissão**

Localizar em `renderAgenda()` (linha ~3482):
```javascript
        return'<div class="agenda-pub-pill '+cls+'" style="background:'+cor+'" onclick="openEditPub(\''+p.id+'\')" title="'+p.titulo+'">'+
```

Substituir por:
```javascript
        return'<div class="agenda-pub-pill '+cls+'" style="background:'+cor+'"'+(can('agenda_editar')?' onclick="openEditPub(\''+p.id+'\')"':'')+' title="'+p.titulo+'">'+
```

- [ ] **Passo 2: Verificar no browser**

Logar como usuário sem `agenda_editar`. Navegar para Agenda. Clicar em uma publicação — não deve abrir o modal de edição. Logar como admin — clicar abre normalmente.

- [ ] **Passo 3: Commit**

```bash
git add index.html
git commit -m "feat: aplica can('agenda_editar') nas pills da Agenda"
```

---

## Task 7: HTML — Adicionar seção de Roles nas Preferências

**Files:**
- Modify: `index.html:617–630` (HTML do screen-preferencias)

- [ ] **Passo 1: Adicionar div da seção de Roles antes da seção de Usuários**

Localizar (linha ~617–620):
```html
      <!-- PREFERENCIAS -->
      <div id="screen-preferencias" class="screen">
        <!-- USUÁRIOS DA PLATAFORMA -->
        <div class="pref-section" id="pref-section-users">
```

Substituir por:
```html
      <!-- PREFERENCIAS -->
      <div id="screen-preferencias" class="screen">
        <!-- ROLES E PERMISSÕES (visível apenas para admin) -->
        <div class="pref-section" id="pref-section-roles" style="display:none"></div>

        <!-- USUÁRIOS DA PLATAFORMA -->
        <div class="pref-section" id="pref-section-users">
```

- [ ] **Passo 2: Verificar que a div existe sem erros**

Abrir o browser, navegar para Preferências. Inspecionar o DOM (F12 → Elements). Verificar que `#pref-section-roles` existe e está `display:none`. Sem erros no console.

- [ ] **Passo 3: Commit**

```bash
git add index.html
git commit -m "feat: adiciona placeholder da seção de Roles nas Preferências"
```

---

## Task 8: Implementar renderRolesPrefs()

**Files:**
- Modify: `index.html:~1100` (após `renderUsersPrefs()`)
- Modify: `index.html:1362` (chamada em `goScreen('preferencias')`)

- [ ] **Passo 1: Adicionar chamada de renderRolesPrefs() em goScreen()**

Localizar (linha ~1362):
```javascript
  if(name==='preferencias'){renderPalette();renderProdutos();renderUsersPrefs();renderTipoAtividades();renderRedmineConfig();
```

Substituir por:
```javascript
  if(name==='preferencias'){renderPalette();renderProdutos();renderRolesPrefs();renderUsersPrefs();renderTipoAtividades();renderRedmineConfig();
```

- [ ] **Passo 2: Implementar renderRolesPrefs() após renderUsersPrefs()**

Após o fechamento de `renderUsersPrefs()`, adicionar:

```javascript
async function renderRolesPrefs(){
  var sec=document.getElementById('pref-section-roles');
  if(!sec)return;
  if(!can('preferencias_admin')){sec.style.display='none';return;}
  sec.style.display='';

  var PERM_LABELS={
    'menus.boletim':'Boletim','menus.ponto':'Ponto','menus.preferencias':'Preferências',
    'acoes.os_criar':'Criar OS','acoes.os_editar':'Editar OS','acoes.os_deletar_propria':'Deletar próprias OSs',
    'acoes.boletim_editar':'Editar Boletim','acoes.agenda_editar':'Editar Agenda','acoes.preferencias_admin':'Administrar Preferências'
  };

  // Recarregar S_ROLES para ter dados frescos
  var {data:rolesData}=await sb.from('roles').select('*');
  S_ROLES=rolesData||[];
  S_ROLES.forEach(function(r){ROLE_LABELS[r.nome]=r.label||r.nome;});

  function mkCheckbox(roleId,key,checked){
    return'<label class="form-check" style="margin-bottom:4px">'+
      '<input type="checkbox" '+(checked?'checked':'')+' onchange="rolesPermToggle(\''+roleId+'\',\''+key+'\',this.checked)" style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer">'+
      '<span class="form-check-label">'+PERM_LABELS[key]+'</span>'+
    '</label>';
  }

  function mkRoleCard(r){
    var p=r.permissoes||{acoes:{},menus:{}};
    var userCount=S_USERS.filter(function(u){return u.role===r.nome}).length;
    return'<div class="card" style="margin-bottom:10px" id="roles-card-'+r.id+'">'+
      '<div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="rolesToggleCard(\''+r.id+'\')">'+
        '<span style="flex:1;font-size:13px;font-weight:500">'+escHtml(r.label||r.nome)+'</span>'+
        '<span style="font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:10px;background:var(--card2);color:var(--hint)">'+userCount+' usuário(s)</span>'+
        '<span id="roles-card-arrow-'+r.id+'" style="color:var(--hint);font-size:12px;transition:transform .2s">▼</span>'+
      '</div>'+
      '<div id="roles-card-body-'+r.id+'" style="display:none;padding-top:12px;border-top:1px solid var(--border);margin-top:12px">'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
          '<div>'+
            '<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Menus</div>'+
            mkCheckbox(r.id,'menus.boletim',!!(p.menus&&p.menus.boletim))+
            mkCheckbox(r.id,'menus.ponto',!!(p.menus&&p.menus.ponto))+
            mkCheckbox(r.id,'menus.preferencias',!!(p.menus&&p.menus.preferencias))+
          '</div>'+
          '<div>'+
            '<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Ações</div>'+
            mkCheckbox(r.id,'acoes.os_criar',!!(p.acoes&&p.acoes.os_criar))+
            mkCheckbox(r.id,'acoes.os_editar',!!(p.acoes&&p.acoes.os_editar))+
            mkCheckbox(r.id,'acoes.os_deletar_propria',!!(p.acoes&&p.acoes.os_deletar_propria))+
            mkCheckbox(r.id,'acoes.boletim_editar',!!(p.acoes&&p.acoes.boletim_editar))+
            mkCheckbox(r.id,'acoes.agenda_editar',!!(p.acoes&&p.acoes.agenda_editar))+
            mkCheckbox(r.id,'acoes.preferencias_admin',!!(p.acoes&&p.acoes.preferencias_admin))+
          '</div>'+
        '</div>'+
        '<div style="display:flex;justify-content:flex-end">'+
          '<button class="btn btn-primary btn-sm" onclick="rolesSalvar(\''+r.id+'\')">Salvar</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  sec.innerHTML=
    '<div class="pref-section-title">Roles e Permissões</div>'+
    S_ROLES.map(mkRoleCard).join('')+
    '<button class="btn btn-sm btn-ghost" onclick="rolesNovoModal()" style="margin-top:4px">+ Novo role</button>'+
    // Modal novo role
    '<div id="modal-novo-role" class="modal-overlay">'+
      '<div class="modal">'+
        '<div class="modal-title">Novo Role</div>'+
        '<div class="form-group"><label class="form-label">Nome (slug)</label><input id="new-role-nome" class="form-input" placeholder="ex: dev"></div>'+
        '<div class="form-group"><label class="form-label">Label</label><input id="new-role-label" class="form-input" placeholder="ex: Desenvolvedor"></div>'+
        '<div class="form-group"><label class="form-label">Herdar permissões de</label>'+
          '<select id="new-role-herdar" class="form-input">'+
            '<option value="">Nenhum (vazio)</option>'+
            S_ROLES.map(function(r){return'<option value="'+r.id+'">'+escHtml(r.label||r.nome)+'</option>'}).join('')+
          '</select>'+
        '</div>'+
        '<div class="modal-footer">'+
          '<button class="btn" onclick="closeModal(\'modal-novo-role\')">Cancelar</button>'+
          '<button class="btn btn-primary" onclick="rolesCriar()">Criar</button>'+
        '</div>'+
      '</div>'+
    '</div>';
}

function rolesToggleCard(id){
  var body=document.getElementById('roles-card-body-'+id);
  var arrow=document.getElementById('roles-card-arrow-'+id);
  if(!body)return;
  var open=body.style.display==='block';
  body.style.display=open?'none':'block';
  if(arrow)arrow.style.transform=open?'':'rotate(180deg)';
}

function rolesPermToggle(roleId,key,val){
  var r=S_ROLES.find(function(x){return x.id===roleId});
  if(!r)return;
  if(!r.permissoes)r.permissoes={acoes:{},menus:{}};
  var parts=key.split('.');
  if(!r.permissoes[parts[0]])r.permissoes[parts[0]]={};
  r.permissoes[parts[0]][parts[1]]=val;
}

async function rolesSalvar(roleId){
  var r=S_ROLES.find(function(x){return x.id===roleId});
  if(!r)return;
  var {error}=await sb.from('roles').update({permissoes:r.permissoes}).eq('id',roleId);
  if(error){toast('Erro ao salvar role','err');return;}
  // Recarregar CURRENT_ROLE se for o role do usuário atual
  if(CURRENT_ROLE&&CURRENT_ROLE.id===roleId)CURRENT_ROLE=r;
  toast('Permissões salvas!');
}

function rolesNovoModal(){openModal('modal-novo-role');}

async function rolesCriar(){
  var nome=document.getElementById('new-role-nome').value.trim().toLowerCase().replace(/\s+/g,'-');
  var label=document.getElementById('new-role-label').value.trim();
  var herdaId=document.getElementById('new-role-herdar').value;
  if(!nome||!label){toast('Preencha nome e label','err');return;}
  var permissoes={acoes:{},menus:{}};
  if(herdaId){
    var base=S_ROLES.find(function(r){return r.id===herdaId});
    if(base&&base.permissoes)permissoes=JSON.parse(JSON.stringify(base.permissoes));
  }
  var {error}=await sb.from('roles').insert({nome:nome,label:label,permissoes:permissoes});
  if(error){toast('Erro ao criar role','err');return;}
  closeModal('modal-novo-role');
  await renderRolesPrefs();
  toast('Role "'+label+'" criado!');
}
```

- [ ] **Passo 3: Verificar no browser como admin**

Logar como admin. Navegar para Preferências. A seção "Roles e Permissões" deve aparecer com os 6 roles listados. Clicar em um card — deve expandir com checkboxes. Alterar um checkbox e clicar Salvar — deve mostrar toast "Permissões salvas!". Clicar em "+ Novo role" — modal deve abrir.

- [ ] **Passo 4: Verificar no browser como não-admin**

Logar como usuário sem `preferencias_admin`. Navegar para Preferências. A seção "Roles e Permissões" **não deve aparecer**.

- [ ] **Passo 5: Commit**

```bash
git add index.html
git commit -m "feat: implementa renderRolesPrefs() com CRUD de permissões"
```

---

## Task 9: Atualizar renderUsersPrefs() e saveUserRole() com roles dinâmicos

**Files:**
- Modify: `index.html:1039–1100` (função `renderUsersPrefs()`)
- Modify: `index.html:1030–1037` (função `saveUserRole()`)

- [ ] **Passo 1: Atualizar select de roles em renderUsersPrefs()**

Localizar dentro de `renderUsersPrefs()` (linha ~1071–1082):
```javascript
    var roleHtml='';
    if(isAdmin()&&!isMe){
      // Admin pode mudar role de outros via select
      roleHtml='<select onchange="saveUserRole(\''+u.id+'\',this.value)" style="border:1px solid var(--border);background:var(--card2);color:var(--text);font-size:11px;padding:3px 6px;border-radius:4px;cursor:pointer">'+
        ['admin','membro','visualizador'].map(function(r){
          return'<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+ROLE_LABELS[r]+'</option>';
        }).join('')+
      '</select>';
    }else{
      var roleClass=u.role==='admin'?'role-badge-admin':u.role==='visualizador'?'role-badge-visualizador':'role-badge-membro';
      roleHtml='<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;" class="'+roleClass+'">'+ROLE_LABELS[u.role]+'</span>';
    }
```

Substituir por:
```javascript
    var roleHtml='';
    var roleNaoConfigurado=!u.role||u.role==='membro'||!S_ROLES.find(function(r){return r.nome===u.role});
    if(can('preferencias_admin')&&!isMe){
      // Admin pode mudar role via select dinâmico
      roleHtml='<select onchange="saveUserRole(\''+u.id+'\',this.value)" style="border:1px solid var(--border);background:var(--card2);color:var(--text);font-size:11px;padding:3px 6px;border-radius:4px;cursor:pointer">'+
        S_ROLES.map(function(r){
          return'<option value="'+r.nome+'"'+(u.role===r.nome?' selected':'')+'>'+escHtml(r.label||r.nome)+'</option>';
        }).join('')+
      '</select>'+
      (roleNaoConfigurado?'<span style="font-size:10px;background:var(--amber-dim);color:var(--amber-text);padding:2px 8px;border-radius:10px;margin-left:6px">Não configurado</span>':'');
    }else{
      var roleLabel=ROLE_LABELS[u.role]||u.role||'—';
      var roleColor=u.role==='admin'?'background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)':
        roleNaoConfigurado?'background:var(--amber-dim);color:var(--amber-text);border:1px solid var(--amber-text)':
        'background:rgba(124,111,247,.15);color:#7c6ff7;border:1px solid rgba(124,111,247,.3)';
      roleHtml='<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;'+roleColor+'">'+escHtml(roleLabel)+(roleNaoConfigurado?' ⚠':'')+'</span>';
    }
```

- [ ] **Passo 2: Atualizar saveUserRole() para salvar em prefs**

Localizar `saveUserRole()` (linha ~1030):
```javascript
async function saveUserRole(userId,newRole){
```

Substituir a função inteira por:
```javascript
async function saveUserRole(userId,newRole){
  var u=S_USERS.find(function(x){return x.id===userId});if(!u)return;
  var {data:prof}=await sb.from('profiles').select('prefs').eq('id',userId).single();
  var prefs=Object.assign({},(prof&&prof.prefs)||{});
  prefs.role=newRole;
  var {error}=await sb.from('profiles').update({prefs:prefs}).eq('id',userId);
  if(error){toast('Erro ao salvar role','err');return;}
  u.role=newRole;
  renderUsersPrefs();
  toast('Role atualizado!');
}
```

- [ ] **Passo 3: Atualizar badge do role do usuário logado no topo de renderUsersPrefs()**

Localizar (linha ~1041–1049):
```javascript
  var myRole=currentUserRole();
  var badge=document.getElementById('pref-role-badge');
  if(badge){
    badge.textContent=ROLE_LABELS[myRole]||myRole;
    badge.className='';
    badge.style.cssText='font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;';
    if(myRole==='admin')badge.style.cssText+='background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)';
    else if(myRole==='membro')badge.style.cssText+='background:rgba(99,102,241,.15);color:#6366f1;border:1px solid rgba(99,102,241,.3)';
    else badge.style.cssText+='background:rgba(107,114,128,.15);color:#9ca3af;border:1px solid rgba(107,114,128,.2)';
  }
```

Substituir por:
```javascript
  var myRole=currentUserRole();
  var badge=document.getElementById('pref-role-badge');
  if(badge){
    badge.textContent=ROLE_LABELS[myRole]||myRole;
    badge.style.cssText='font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;';
    if(myRole==='admin')badge.style.cssText+='background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)';
    else badge.style.cssText+='background:rgba(124,111,247,.15);color:#7c6ff7;border:1px solid rgba(124,111,247,.3)';
  }
```

- [ ] **Passo 4: Verificar no browser como admin**

Navegar para Preferências → Usuários. O select de cada usuário deve listar todos os roles da tabela (gerente, superintendente, pm, documentacao, admin, visualizador). Usuários sem role atribuído (ou com role `membro` legado) devem mostrar badge âmbar "Não configurado". Alterar o role de um usuário → deve salvar e exibir toast.

- [ ] **Passo 5: Commit**

```bash
git add index.html
git commit -m "feat: roles dinâmicos em renderUsersPrefs() e saveUserRole()"
```

---

## Checklist Final de Verificação

Após todas as tasks:

- [ ] Login como **admin**: todos os menus visíveis, todos os botões disponíveis
- [ ] Login como **visualizador**: sem menus Boletim/Ponto/Preferências, sem botões de edição no Kanban, Boletim read-only, Agenda sem clique nas pills
- [ ] Login como **pm**: menus Boletim e Ponto visíveis, "+ Nova OS" aparece, Deletar OS só nas próprias
- [ ] Visitor: comportamento inalterado (applyVisitorMode() existente)
- [ ] Preferências → Roles: admin vê e edita, não-admin não vê
- [ ] Preferências → Usuários: select dinâmico com roles da tabela, badge âmbar para não configurados
- [ ] Criar novo role via "+ Novo role" funciona e aparece na lista
- [ ] Herdar permissões de role existente ao criar novo funciona

---

## Supabase — Passos Externos (antes de deploy)

Executar no painel do Supabase (SQL Editor) antes de testar em produção:

```sql
-- Adicionar rows admin e visualizador na tabela roles (se não existirem)
INSERT INTO roles (nome, label, permissoes)
VALUES
  ('admin', 'Administrador', '{"acoes":{"os_criar":true,"os_editar":true,"os_deletar_propria":true,"boletim_editar":true,"agenda_editar":true,"preferencias_admin":true},"menus":{"boletim":true,"ponto":true,"preferencias":true}}'),
  ('visualizador', 'Visualizador', '{"acoes":{},"menus":{}}')
ON CONFLICT (nome) DO NOTHING;
```
