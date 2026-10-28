# Redesign Menu Preferências — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar as Preferências em três abas (Pessoal / Plataforma / Admin) e mover credenciais sensíveis das integrações para fora do browser.

**Architecture:** Todas as mudanças são em `index.html` (vanilla JS inline), `redmine-proxy.js` (Node.js), e um novo `netlify/functions/zendesk.js` (Netlify Function). Sem build system, sem dependências novas.

**Tech Stack:** Vanilla JS, Netlify Functions (Node.js 18), `netlify.toml` existente.

---

## Arquivos

| Arquivo | Ação |
|---|---|
| `index.html` | Modificar — HTML das abas + reorganização de seções + JS das integrações |
| `redmine-proxy.js` | Modificar — CORS + suporte a `d.path` |
| `netlify/functions/zendesk.js` | Criar — Netlify Function para Zendesk |
| `netlify.toml` | Modificar — adicionar `functions = "netlify/functions"` |
| `redmine.env.example` | Criar — template de variáveis de ambiente |

---

## Task 1: Netlify Function para Zendesk

**Files:**
- Create: `netlify/functions/zendesk.js`
- Modify: `netlify.toml`

- [ ] **Passo 1: Criar diretório e função**

Crie o arquivo `netlify/functions/zendesk.js` com o seguinte conteúdo:

```javascript
const https = require('https');

const PATHS = {
  me:         '/api/v2/users/me.json',
  categories: '/api/v2/help_center/pt-br/categories.json',
  articles:   '/api/v2/help_center/pt-br/articles.json',
  explore:    '/api/v2/explore/export'
};

function zendeskRequest(sub, email, token, path, method, body) {
  return new Promise(function(resolve) {
    var auth = Buffer.from(email + '/token:' + token).toString('base64');
    var hostname = sub.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    var bodyStr = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: hostname,
      path: path,
      method: method || 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json',
        'Content-Length': bodyStr ? Buffer.byteLength(bodyStr) : 0
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', function(e) {
      resolve({ statusCode: 502, body: JSON.stringify({ error: e.message }) });
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

exports.handler = async function(event) {
  var sub   = process.env.ZENDESK_SUBDOMAIN;
  var email = process.env.ZENDESK_EMAIL;
  var token = process.env.ZENDESK_TOKEN;

  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (!sub || !email || !token) {
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Zendesk não configurado. Defina ZENDESK_SUBDOMAIN, ZENDESK_EMAIL e ZENDESK_TOKEN nas variáveis de ambiente do Netlify.' })
    };
  }

  var params = event.queryStringParameters || {};
  var type   = params.type || 'me';
  var path   = PATHS[type] || PATHS['me'];

  // Parâmetros extras passados como query string (ex: per_page, page)
  var extra = Object.keys(params)
    .filter(function(k) { return k !== 'type'; })
    .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');
  if (extra) path += (path.indexOf('?') > -1 ? '&' : '?') + extra;

  var body = null;
  if (event.httpMethod === 'POST' && event.body) {
    try { body = JSON.parse(event.body); } catch(e) {}
  }

  var result = await zendeskRequest(sub, email, token, path, event.httpMethod, body);

  return {
    statusCode: result.statusCode,
    headers: corsHeaders,
    body: result.body
  };
};
```

- [ ] **Passo 2: Adicionar `functions` no netlify.toml**

No arquivo `netlify.toml`, adicione a linha `functions = "netlify/functions"` na seção `[build]`:

```toml
[build]
  publish = "."
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "18"

# Só faz deploy automático da branch main
[context.production]
  branch = "main"

# Branches de feature/fix não geram deploy
[context.branch-deploy]
  command = ""

[context.deploy-preview]
  command = ""
```

- [ ] **Passo 3: Testar localmente**

Abra `http://localhost:8080` (com `py -m http.server 8080` rodando). A função Netlify não roda localmente sem `netlify dev` — isso é esperado. O teste real é em produção após o deploy. Para verificar só o arquivo: confirme que `netlify/functions/zendesk.js` tem sintaxe válida rodando `node -e "require('./netlify/functions/zendesk.js')"` — deve retornar sem erro.

- [ ] **Passo 4: Commit**

```
git add netlify/functions/zendesk.js netlify.toml
git commit -m "feat: Netlify Function para Zendesk — credenciais saem do browser [skip netlify]"
```

---

## Task 2: Atualizar frontend Zendesk (HTML + JS)

**Files:**
- Modify: `index.html` (seção Zendesk ~linha 695, funções ~linha 4465)

- [ ] **Passo 1: Substituir HTML da seção Zendesk**

Localizar a seção `pref-section-zendesk` (linha ~695) e substituir todo o conteúdo interno por:

```html
<div class="pref-section" id="pref-section-zendesk">
  <div class="pref-section-title">Integração Zendesk</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">Exibe dados da Central de Ajuda no Dashboard. Credenciais configuradas via variáveis de ambiente do Netlify.</div>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
    <span id="zendesk-status-badge" style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:var(--card2);color:var(--hint)">— não testado</span>
    <button class="btn btn-sm btn-ghost" onclick="testZendeskConexao()">🔌 Testar conexão</button>
  </div>
  <div style="font-size:11px;color:var(--hint);line-height:1.5">
    Configure no painel do Netlify → Site settings → Environment variables:<br>
    <code style="background:var(--card2);padding:1px 5px;border-radius:4px">ZENDESK_SUBDOMAIN</code>
    <code style="background:var(--card2);padding:1px 5px;border-radius:4px">ZENDESK_EMAIL</code>
    <code style="background:var(--card2);padding:1px 5px;border-radius:4px">ZENDESK_TOKEN</code>
  </div>
</div>
```

- [ ] **Passo 2: Substituir funções Zendesk no JS**

Localizar as funções `getZendeskConfig`, `saveZendeskConfig`, `saveZendeskConfigFromInputs`, `renderZendeskConfig`, `_zendeskFetch`, `testZendeskConexao` (linhas ~4465–4510) e substituir pelo bloco abaixo:

```javascript
function getZendeskStatus(){
  try{return JSON.parse(localStorage.getItem('vs_zendesk_status'))||{}}catch(e){return{}}
}
function saveZendeskStatus(s){localStorage.setItem('vs_zendesk_status',JSON.stringify(s))}
function renderZendeskConfig(){
  var s=getZendeskStatus();
  var badge=document.getElementById('zendesk-status-badge');
  if(!badge)return;
  if(s.ok===true){
    badge.textContent='conectado ✓';
    badge.style.background='rgba(62,207,142,.15)';badge.style.color='var(--green-text)';
  }else if(s.ok===false){
    badge.textContent='desconectado ✗';
    badge.style.background='rgba(239,68,68,.12)';badge.style.color='#ef4444';
  }else{
    badge.textContent='— não testado';
    badge.style.background='var(--card2)';badge.style.color='var(--hint)';
  }
}
async function _zendeskFetch(path,method,body){
  var url='/.netlify/functions/zendesk?type='+encodeURIComponent(path);
  var opts={method:method||'GET',headers:{'Content-Type':'application/json'}};
  if(body&&method!=='GET')opts.body=JSON.stringify(body);
  return fetch(url,opts);
}
async function testZendeskConexao(){
  try{
    var r=await _zendeskFetch('me','GET');
    if(!r.ok)throw new Error('HTTP '+r.status);
    var d=await r.json();
    if(d.error)throw new Error(d.error);
    saveZendeskStatus({ok:true});
    renderZendeskConfig();
    toast('Zendesk: conectado como '+(d.user&&d.user.name||'OK')+' ✓');
  }catch(e){
    saveZendeskStatus({ok:false});
    renderZendeskConfig();
    toast('Zendesk: '+e.message,'err');
  }
}
```

- [ ] **Passo 3: Atualizar `loadCentralAjuda` para usar a nova `_zendeskFetch`**

Localizar `loadCentralAjuda` (linha ~4538). Substituir todas as chamadas `_zendeskFetch(cfg, path, ...)` por `_zendeskFetch(type, method, body)` onde `type` é a chave do mapa de paths na Netlify Function.

A função inteira `loadCentralAjuda` deve ficar assim:

```javascript
async function loadCentralAjuda(){
  var banner=document.getElementById('ajuda-config-banner');
  var tabela=document.getElementById('ajuda-tabela');
  var metrics=document.getElementById('ajuda-metrics');
  if(banner)banner.style.display='none';
  if(tabela)tabela.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">Carregando...</div>';
  if(metrics)metrics.innerHTML='';
  try{
    var rc=await _zendeskFetch('categories','GET');
    if(!rc.ok)throw new Error('Categorias: HTTP '+rc.status);
    var dc=await rc.json();
    if(dc.error)throw new Error(dc.error);
    _ajudaDados.categories=dc.categories||[];
    var sel=document.getElementById('ajuda-cat-filtro');
    if(sel){
      var catAtual=sel.value;
      sel.innerHTML='<option value="todas">Todas as categorias</option>'+
        _ajudaDados.categories.map(function(c){return'<option value="'+c.id+'">'+escHtml(c.name)+'</option>'}).join('');
      if(catAtual&&catAtual!=='todas')sel.value=catAtual;
    }
    var arts=[];var page=1;
    while(true){
      var ra=await fetch('/.netlify/functions/zendesk?type=articles&per_page=100&page='+page);
      if(!ra.ok)break;
      var da=await ra.json();
      if(da.error)break;
      arts=arts.concat(da.articles||[]);
      if(!da.next_page||arts.length>=200)break;
      page++;
    }
    _ajudaDados.articles=arts;
    var endDate=new Date();var startDate=new Date();
    startDate.setDate(endDate.getDate()-_ajudaPeriodo);
    var fmt=function(d){return d.toISOString().slice(0,10)};
    var rv=await _zendeskFetch('explore','POST',{
      type:'help_center',
      attributes:{date_range:{from:fmt(startDate),to:fmt(endDate)},metrics:['article_views'],groupby:['article_id']}
    });
    if(rv.ok){
      var dv=await rv.json();
      _ajudaDados.views={};
      var rows=dv.rows||dv.data||[];
      rows.forEach(function(row){
        if(Array.isArray(row))_ajudaDados.views[String(row[0])]=row[1]||0;
        else if(row.article_id)_ajudaDados.views[String(row.article_id)]=row.article_views||row.views||0;
      });
    }else{
      _ajudaDados.views={};
      arts.forEach(function(a){_ajudaDados.views[String(a.id)]=a.vote_sum||0});
    }
    renderCentralAjuda();
  }catch(e){
    if(tabela)tabela.innerHTML='<div style="color:var(--muted);font-size:13px;padding:20px 0">Erro ao carregar: '+escHtml(e.message)+'</div>';
  }
}
```

- [ ] **Passo 4: Verificar referências antigas**

Pesquisar no `index.html` por `getZendeskConfig`, `saveZendeskConfig`, `cfg.sub`, `cfg.token`, `cfg.email`, `pref-zendesk`. Remover ou adaptar qualquer referência remanescente.

- [ ] **Passo 5: Testar no localhost**

Abrir `http://localhost:8080` → Preferências → aba Admin → seção Zendesk. Deve mostrar o badge "— não testado" e o botão "Testar conexão". O teste de conexão vai falhar em localhost (função Netlify não disponível) — isso é esperado. Confirmar que não há erros no console relativos a funções inexistentes.

- [ ] **Passo 6: Commit**

```
git add index.html
git commit -m "feat: Zendesk via Netlify Function — remove credenciais do localStorage [skip netlify]"
```

---

## Task 3: Atualizar proxy Redmine + criar .env.example

**Files:**
- Modify: `redmine-proxy.js`
- Create: `redmine.env.example`

- [ ] **Passo 1: Atualizar CORS do proxy para localhost:8080**

No `redmine-proxy.js`, linha ~27, atualizar o header `Access-Control-Allow-Origin`:

```javascript
const CORS = {
  'Access-Control-Allow-Origin': 'null, http://localhost, http://localhost:8080, https://versionsuite.netlify.app',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
```

- [ ] **Passo 2: Adicionar suporte a `d.path` no proxy**

O proxy passa a aceitar `{path, method, body}` além do `{url, method, body}` existente. Quando `d.path` é enviado, o proxy constrói a URL usando `REDMINE_URL` do ambiente.

Localizar o bloco `const d = JSON.parse(body);` (linha ~51) e substituir a lógica de construção da URL:

```javascript
const d = JSON.parse(body);

// Suporta dois modos: {url: fullUrl} (legado) ou {path: '/issues.json'} (novo)
let fullUrl;
if (d.url) {
  fullUrl = d.url;
} else if (d.path) {
  if (!ALLOWED_HOST) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Configure REDMINE_URL no ambiente para usar o modo "path".' }));
    return;
  }
  fullUrl = ALLOWED_HOST.replace(/\/+$/, '') + d.path;
} else {
  throw new Error('Forneça "url" ou "path" no body da requisição');
}
```

- [ ] **Passo 3: Criar `redmine.env.example`**

Criar arquivo `redmine.env.example` na raiz do projeto:

```
# Copie este arquivo para .env e preencha os valores
# Nunca commite o .env — ele está no .gitignore

REDMINE_URL=http://192.168.0.1/redmine
REDMINE_KEY=sua-chave-api-aqui
PORT=3001
```

- [ ] **Passo 4: Verificar .gitignore**

Confirmar que `.env` está no `.gitignore`. Se não estiver, adicionar a linha `.env`.

- [ ] **Passo 5: Commit**

```
git add redmine-proxy.js redmine.env.example .gitignore
git commit -m "fix: proxy Redmine aceita d.path + CORS localhost:8080 + .env.example [skip netlify]"
```

---

## Task 4: Atualizar frontend Redmine (HTML + JS)

**Files:**
- Modify: `index.html` (seção Redmine ~linha 719, funções ~linha 4406)

- [ ] **Passo 1: Substituir HTML da seção Redmine**

Localizar `pref-section-redmine` (linha ~719) e substituir o conteúdo interno por:

```html
<div class="pref-section" id="pref-section-redmine">
  <div class="pref-section-title">Integração Redmine</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">Configure para importar tarefas no Kanban e enviar horas registradas. Requer o proxy local rodando.</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:520px;margin-bottom:10px">
    <div class="form-group" style="margin:0">
      <label class="form-label">URL do proxy</label>
      <input class="form-input" id="pref-redmine-proxyurl" placeholder="http://localhost:3001" oninput="saveRedmineConfigFromInputs()">
    </div>
    <div class="form-group" style="margin:0">
      <label class="form-label">ID de atividade padrão</label>
      <input class="form-input" id="pref-redmine-activity" type="number" placeholder="Ex: 9" oninput="saveRedmineConfigFromInputs()">
      <div style="font-size:11px;color:var(--hint);margin-top:4px">Redmine → Administração → Enumerações → Atividades.</div>
    </div>
  </div>
  <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;font-size:13px">
    <input type="checkbox" id="pref-redmine-proxy" onchange="saveRedmineConfigFromInputs()" style="width:15px;height:15px;accent-color:var(--accent)">
    Proxy ativo
  </label>
  <button class="btn btn-sm btn-ghost" onclick="testRedmineConexao()">🔌 Testar conexão</button>
  <div style="font-size:11px;color:var(--hint);margin-top:10px;line-height:1.6">
    Para iniciar o proxy: copie <code style="background:var(--card2);padding:1px 5px;border-radius:4px">redmine.env.example</code> para <code style="background:var(--card2);padding:1px 5px;border-radius:4px">.env</code>, preencha as variáveis e rode <code style="background:var(--card2);padding:1px 5px;border-radius:4px">node redmine-proxy.js</code>.
  </div>
</div>
```

- [ ] **Passo 2: Substituir funções Redmine no JS**

Localizar as funções `getRedmineConfig`, `saveRedmineConfig`, `saveRedmineConfigFromInputs`, `_redmineUpdateButtons`, `renderRedmineConfig`, `_redmineFetch`, `testRedmineConexao` (linhas ~4406–4462) e substituir pelo bloco:

```javascript
function getRedmineConfig(){
  try{return JSON.parse(localStorage.getItem('vs_redmine_config'))||{}}catch(e){return{}}
}
function saveRedmineConfig(cfg){localStorage.setItem('vs_redmine_config',JSON.stringify(cfg))}
function saveRedmineConfigFromInputs(){
  var proxyUrl=(document.getElementById('pref-redmine-proxyurl')||{value:''}).value.trim().replace(/\/+$/,'');
  var actId=parseInt((document.getElementById('pref-redmine-activity')||{value:''}).value)||null;
  var proxy=!!((document.getElementById('pref-redmine-proxy')||{}).checked);
  saveRedmineConfig({proxyUrl:proxyUrl,actId:actId,proxy:proxy});
  _redmineUpdateButtons(!!(proxyUrl&&proxy));
}
function _redmineUpdateButtons(hasCfg){
  var btnK=document.getElementById('btn-importar-redmine');
  var btnE=document.getElementById('btn-enviar-redmine');
  if(btnK)btnK.style.display=hasCfg?'':'none';
  if(btnE)btnE.style.display=hasCfg?'':'none';
}
function renderRedmineConfig(){
  var cfg=getRedmineConfig();
  var u=document.getElementById('pref-redmine-proxyurl');
  var a=document.getElementById('pref-redmine-activity');
  var p=document.getElementById('pref-redmine-proxy');
  if(u)u.value=cfg.proxyUrl||'http://localhost:3001';
  if(a)a.value=cfg.actId||'';
  if(p)p.checked=!!(cfg.proxy);
  _redmineUpdateButtons(!!(cfg.proxyUrl&&cfg.proxy));
}
async function _redmineFetch(cfg,path,method,body){
  var proxyUrl=(cfg.proxyUrl||'http://localhost:3001').replace(/\/+$/,'');
  return fetch(proxyUrl,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:path,method:method||'GET',body:body||null})
  });
}
async function testRedmineConexao(){
  var cfg=getRedmineConfig();
  if(!cfg.proxyUrl||!cfg.proxy){toast('Ative o proxy e informe a URL','err');return}
  try{
    var r=await _redmineFetch(cfg,'/users/current.json','GET');
    if(!r.ok)throw new Error('HTTP '+r.status);
    var d=await r.json();
    toast('Conectado como '+d.user.login+' ✓');
  }catch(e){
    toast('Erro ao conectar: '+e.message+' (verifique se o proxy está rodando)','err');
  }
}
```

- [ ] **Passo 3: Atualizar linha no `load()` que checa config Redmine**

Localizar (linha ~3983):
```javascript
_redmineUpdateButtons(!!(getRedmineConfig().url&&getRedmineConfig().key));
```
Substituir por:
```javascript
_redmineUpdateButtons(!!(getRedmineConfig().proxyUrl&&getRedmineConfig().proxy));
```

- [ ] **Passo 4: Verificar referências a cfg.key, cfg.url e pref-redmine-key**

Pesquisar no `index.html` por `cfg.key`, `cfg.url`, `pref-redmine-key`, `pref-redmine-url`. Adaptar ou remover. Qualquer uso de `cfg.url` em chamadas de Redmine deve passar a enviar `path` sem o host (pois o proxy agora constrói a URL completa a partir de `REDMINE_URL`).

Localizar todas as chamadas `_redmineFetch(cfg, '/...', ...)` no código e confirmar que o segundo argumento já é apenas o path (ex: `/issues.json?...`), não uma URL completa. Essas chamadas não precisam de mudança — apenas `_redmineFetch` internamente mudou.

- [ ] **Passo 5: Testar no localhost**

Abrir `http://localhost:8080` → Preferências → aba Admin → seção Redmine. Confirmar:
- Campo "URL do proxy" aparece com placeholder `http://localhost:3001`
- Campo "Chave API" não existe mais
- Checkbox "Proxy ativo" presente
- Com proxy ativo + URL preenchida, botões de importar/enviar aparecem no Kanban e Ponto
- Sem proxy ativo, botões ficam ocultos

- [ ] **Passo 6: Commit**

```
git add index.html
git commit -m "feat: Redmine sem chave no frontend — proxy obrigatório, URL configurável [skip netlify]"
```

---

## Task 5: Abas no menu Preferências (HTML + JS)

**Files:**
- Modify: `index.html` (HTML do `screen-preferencias` ~linha 655, `goScreen` ~linha 1570)

- [ ] **Passo 1: Adicionar variável e função `goPrefsTab`**

Localizar onde as variáveis globais de navegação estão definidas (próximo de `var _prefTab` se já existir, ou antes de `goScreen`). Adicionar:

```javascript
var _prefTab='pessoal';
function goPrefsTab(nome){
  _prefTab=nome;
  ['pessoal','plataforma','admin'].forEach(function(t){
    var panel=document.getElementById('pref-tab-'+t);
    var btn=document.getElementById('pref-tab-btn-'+t);
    if(panel)panel.style.display=(t===nome)?'':'none';
    if(btn){
      btn.style.borderBottomColor=(t===nome)?'var(--accent)':'transparent';
      btn.style.color=(t===nome)?'var(--accent)':'var(--muted)';
    }
  });
}
```

- [ ] **Passo 2: Substituir HTML do `screen-preferencias`**

Substituir o conteúdo inteiro de `<div id="screen-preferencias" class="screen">` pelo bloco abaixo. Atenção: preserve o conteúdo das seções existentes — apenas reorganize em três painéis e adicione o nav de abas no topo.

```html
<div id="screen-preferencias" class="screen">

  <!-- Nav de abas -->
  <div style="display:flex;gap:0;margin-bottom:24px;border-bottom:1px solid var(--border)">
    <button id="pref-tab-btn-pessoal"
      style="padding:8px 18px;font-size:13px;cursor:pointer;background:none;border:none;border-bottom:2px solid var(--accent);color:var(--accent);font-weight:500"
      onclick="goPrefsTab('pessoal')">Pessoal</button>
    <button id="pref-tab-btn-plataforma"
      style="padding:8px 18px;font-size:13px;cursor:pointer;background:none;border:none;border-bottom:2px solid transparent;color:var(--muted)"
      onclick="goPrefsTab('plataforma')">Plataforma</button>
    <button id="pref-tab-btn-admin"
      style="padding:8px 18px;font-size:13px;cursor:pointer;background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);display:none"
      onclick="goPrefsTab('admin')">Admin</button>
  </div>

  <!-- Painel: Pessoal -->
  <div id="pref-tab-pessoal">
    <div class="pref-section">
      <div class="pref-section-title">Aparência</div>
      <div class="theme-toggle" onclick="toggleTheme()">
        <div style="flex:1"><div style="font-size:13px;font-weight:500">Modo claro</div><div style="font-size:12px;color:var(--muted)">Alterna entre dark e light mode</div></div>
        <div class="toggle-switch" id="theme-toggle-sw"><div class="toggle-knob"></div></div>
      </div>
    </div>
    <div class="pref-section">
      <div class="pref-section-title">Cor de destaque</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Aplicada em botões, cards ativos, barras e badges.</div>
      <div class="color-palette" id="color-palette"></div>
    </div>
  </div>

  <!-- Painel: Plataforma -->
  <div id="pref-tab-plataforma" style="display:none">
    <div class="pref-section">
      <div class="pref-section-title">Produtos cadastrados</div>
      <div id="produtos-list" style="display:flex;flex-direction:column;gap:6px"></div>
      <button class="btn btn-sm btn-ghost" style="margin-top:8px" onclick="addProduto()">+ Adicionar produto</button>
    </div>
    <div class="pref-section">
      <div class="pref-section-title">Tipo de Atividade</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">Tipos usados ao exportar horas para o Redmine.</div>
      <div id="tipo-atividade-list" style="display:flex;flex-direction:column;gap:6px"></div>
      <button class="btn btn-sm btn-ghost" style="margin-top:8px" onclick="addTipoAtividade()">+ Adicionar tipo</button>
    </div>
    <div class="pref-section" id="pref-section-visitor">
      <div class="pref-section-title">Acesso de Visitantes</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">Senha solicitada ao visitante no login. Se vazia, usa o padrão <code style="background:var(--card2);padding:1px 5px;border-radius:4px">visita2024</code>.</div>
      <div class="form-group" style="max-width:280px">
        <label class="form-label">Senha de acesso para visitantes</label>
        <input type="password" class="form-input" id="pref-visitor-pass" placeholder="visita2024" oninput="salvarSenhaVisitante()">
      </div>
      <div style="margin-top:20px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px">Acessos recentes</div>
        <div id="visitor-log-table" style="font-size:12px;color:var(--muted)">Nenhum acesso registrado.</div>
      </div>
    </div>
  </div>

  <!-- Painel: Admin -->
  <div id="pref-tab-admin" style="display:none">
    <!-- PERFIS DE ACESSO (renderRolesPrefs injeta aqui) -->
    <div class="pref-section" id="pref-section-roles" style="display:none"></div>

    <!-- USUÁRIOS DA PLATAFORMA -->
    <div class="pref-section" id="pref-section-users">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="pref-section-title" style="margin-bottom:0">Usuários da plataforma</div>
        <span id="pref-role-badge" style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(124,111,247,.15);color:#7c6ff7;border:1px solid rgba(124,111,247,.3)">—</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.5">
        Gerencie quem pode acessar a VersionSuite e seus níveis de permissão. Somente <strong>Admins</strong> podem alterar perfis.
      </div>
      <div id="users-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div>
      <div id="users-list-hint" style="font-size:11px;color:var(--hint)">Usuários aparecem automaticamente após o primeiro login com Google.</div>
    </div>

    <!-- INTEGRAÇÃO REDMINE -->
    <div class="pref-section" id="pref-section-redmine">
      <div class="pref-section-title">Integração Redmine</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">Configure para importar tarefas no Kanban e enviar horas registradas. Requer o proxy local rodando.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:520px;margin-bottom:10px">
        <div class="form-group" style="margin:0">
          <label class="form-label">URL do proxy</label>
          <input class="form-input" id="pref-redmine-proxyurl" placeholder="http://localhost:3001" oninput="saveRedmineConfigFromInputs()">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">ID de atividade padrão</label>
          <input class="form-input" id="pref-redmine-activity" type="number" placeholder="Ex: 9" oninput="saveRedmineConfigFromInputs()">
          <div style="font-size:11px;color:var(--hint);margin-top:4px">Redmine → Administração → Enumerações → Atividades.</div>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="pref-redmine-proxy" onchange="saveRedmineConfigFromInputs()" style="width:15px;height:15px;accent-color:var(--accent)">
        Proxy ativo
      </label>
      <button class="btn btn-sm btn-ghost" onclick="testRedmineConexao()">🔌 Testar conexão</button>
      <div style="font-size:11px;color:var(--hint);margin-top:10px;line-height:1.6">
        Para iniciar o proxy: copie <code style="background:var(--card2);padding:1px 5px;border-radius:4px">redmine.env.example</code> para <code style="background:var(--card2);padding:1px 5px;border-radius:4px">.env</code>, preencha as variáveis e rode <code style="background:var(--card2);padding:1px 5px;border-radius:4px">node redmine-proxy.js</code>.
      </div>
    </div>

    <!-- INTEGRAÇÃO ZENDESK -->
    <div class="pref-section" id="pref-section-zendesk">
      <div class="pref-section-title">Integração Zendesk</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5">Exibe dados da Central de Ajuda no Dashboard. Credenciais configuradas via variáveis de ambiente do Netlify.</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <span id="zendesk-status-badge" style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:var(--card2);color:var(--hint)">— não testado</span>
        <button class="btn btn-sm btn-ghost" onclick="testZendeskConexao()">🔌 Testar conexão</button>
      </div>
      <div style="font-size:11px;color:var(--hint);line-height:1.5">
        Configure no painel do Netlify → Site settings → Environment variables:<br>
        <code style="background:var(--card2);padding:1px 5px;border-radius:4px">ZENDESK_SUBDOMAIN</code>
        <code style="background:var(--card2);padding:1px 5px;border-radius:4px">ZENDESK_EMAIL</code>
        <code style="background:var(--card2);padding:1px 5px;border-radius:4px">ZENDESK_TOKEN</code>
      </div>
    </div>
  </div>

</div>
```

> **Nota:** As Tasks 2 e 4 já substituíram o HTML de Zendesk e Redmine com a versão nova. Neste passo, copie as versões novas dessas seções (já definidas nas Tasks anteriores) para dentro do painel Admin. Não duplique — mova.

- [ ] **Passo 3: Atualizar `goScreen('preferencias')`**

Localizar (linha ~1570):
```javascript
if(name==='preferencias'){renderPalette();renderProdutos();renderRolesPrefs();renderUsersPrefs();renderTipoAtividades();renderRedmineConfig();renderZendeskConfig();
```

Substituir por:
```javascript
if(name==='preferencias'){
  var adminTabBtn=document.getElementById('pref-tab-btn-admin');
  if(adminTabBtn)adminTabBtn.style.display=isAdmin()?'':'none';
  goPrefsTab('pessoal');
  renderPalette();renderProdutos();renderTipoAtividades();
  renderRedmineConfig();renderZendeskConfig();renderRolesPrefs();renderUsersPrefs();
```

- [ ] **Passo 4: Testar abas no localhost**

Abrir `http://localhost:8080` → Preferências. Verificar:
- Três abas visíveis para admin (Pessoal, Plataforma, Admin)
- Não-admin vê apenas Pessoal e Plataforma
- Aba Pessoal: apenas Aparência e Cor de destaque
- Aba Plataforma: Produtos, Tipo Atividade, Visitantes
- Aba Admin: Usuários, Perfis de Acesso, Redmine, Zendesk
- Clicar em cada aba alterna o conteúdo corretamente

- [ ] **Passo 5: Commit**

```
git add index.html
git commit -m "feat: abas Pessoal/Plataforma/Admin nas Preferências [skip netlify]"
```

---

## Task 6: Deploy e configuração de variáveis no Netlify

**Files:** nenhum — apenas configuração no painel Netlify

- [ ] **Passo 1: Merge e deploy**

```
git checkout main
git merge homologacao
git push
```

Aguardar deploy no Netlify (~2 min).

- [ ] **Passo 2: Configurar variáveis de ambiente Zendesk no Netlify**

No painel Netlify → Site settings → Environment variables, adicionar:
- `ZENDESK_SUBDOMAIN` = seu subdomínio (ex: `suaempresa.zendesk.com`)
- `ZENDESK_EMAIL` = e-mail do agente
- `ZENDESK_TOKEN` = token de API do Zendesk

Após salvar, disparar um novo deploy (ou aguardar o próximo push).

- [ ] **Passo 3: Testar em produção**

Acessar a URL de produção → Preferências → aba Admin → Zendesk → "Testar conexão". Badge deve mostrar "conectado ✓".

- [ ] **Passo 4: Limpar localStorage antigo dos usuários**

O `localStorage` ainda pode ter `vs_zendesk_config` com credenciais antigas. Rodar no console do browser em produção:
```javascript
localStorage.removeItem('vs_zendesk_config');
localStorage.removeItem('vs_redmine_config');
```

Ou adicionar ao `load()` uma limpeza automática (uma vez):
```javascript
// Limpeza de credenciais legadas (remover após todos os usuários migrarem)
localStorage.removeItem('vs_zendesk_config');
```

---

## Auto-revisão do plano

**Cobertura da spec:**
- ✅ Três abas (Pessoal/Plataforma/Admin) — Task 5
- ✅ Aba Admin oculta para não-admins — Task 5, Passo 3
- ✅ `goPrefsTab()` com `_prefTab` — Task 5, Passo 1
- ✅ Zendesk → Netlify Function — Tasks 1 e 2
- ✅ Variáveis de ambiente Zendesk — Task 6
- ✅ Redmine remove chave do frontend — Task 4
- ✅ Proxy aceita `d.path` — Task 3
- ✅ `redmine.env.example` — Task 3
- ✅ Status de conexão Zendesk como cache não-sensível — Task 2

**Sem placeholders:** confirmado.

**Consistência de nomes:**
- `_zendeskFetch(path, method, body)` — nova assinatura (sem `cfg` como primeiro arg)
- `getZendeskStatus()` / `saveZendeskStatus()` — substitui `getZendeskConfig()`
- `getRedmineConfig()` — mantém nome, muda shape: `{proxyUrl, actId, proxy}`
- `pref-redmine-proxyurl` — novo ID do campo URL do proxy
