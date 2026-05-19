# Daily Flow System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o sistema de fluxo diário completo no VersionSuite: alertas via sino, Peso Inteligente, Planejamento do Dia, Foco/Timer, Resumo do Dia, Nova Agenda e Exportação Redmine.

**Architecture:** Todo o código vai no arquivo único `index.html` (HTML + CSS + JS inline), seguindo o padrão do projeto. Não há framework de testes automatizados — cada tarefa inclui verificação manual no browser. Os dados são persistidos em `localStorage` por chaves `vs_*` por usuário/dispositivo.

**Tech Stack:** HTML/CSS/JS vanilla, Supabase (auth/dados compartilhados), localStorage (dados de fluxo diário), `setInterval` (alertas), timestamps ISO8601 (timer resistente a refresh).

**Spec:** `docs/superpowers/specs/2026-05-18-daily-flow-system-design.md`

---

## Mapa de arquivos

| Arquivo | O que muda |
|---------|-----------|
| `index.html` (L662–699) | Adicionar seção "Fluxo Diário" na aba Pessoal de Preferências (horários + carga + WIP limit) |
| `index.html` (L360–371) | Adicionar pill de foco e sino na topbar |
| `index.html` (L913–955) | Modal de OS: remover checklist Entregas, adicionar slider de estimativa |
| `index.html` (L2004–2067) | `openNovaOS`, `openEditOS`, `salvarOS`: adaptar para campo `estimatedHours` |
| `index.html` (L1580–1584) | Função `osSize`: reescrever baseada em horas (não mais em entregas) |
| `index.html` (L1921–1962) | `renderKanban`: exibir badge de porte + horas, verificar WIP limit |
| `index.html` (L4422–4428) | `moveOS`: interceptar para verificar WIP limit ao mover para andamento |
| `index.html` (L4449–4466) | `salvarPonto`: disparar modal Resumo do Dia quando 4ª marcação for salva |
| `index.html` (após L1593) | Novas variáveis de estado de foco (`_focusState`) |
| `index.html` (após L5200) | Lógica de inicialização: verificar plano do dia pendente + alerta de volta |
| `index.html` (CSS, L1–220) | Estilos novos: sino, pill de foco, slider, modais de plano/resumo/export |
| `index.html` (HTML, final) | Novos modais: `#modal-dayplan`, `#modal-dayresume`, `#modal-dayresume-add`, `#modal-wip`, `#modal-export-redmine`, `#modal-agenda-event` |

---

## FASE 1 — Alertas + Peso Inteligente + Planejamento do Dia

---

### Task 1: Configuração de horários nas Preferências

**Arquivos:**
- Modify: `index.html` — aba `pref-tab-pessoal` (L677–690) e novos helpers de localStorage

**Contexto:** A aba "Pessoal" de Preferências está em `<div id="pref-tab-pessoal">` (L677). Já tem seções "Aparência" e "Cor de destaque". Vamos adicionar uma seção "Fluxo Diário" ao final.

- [ ] **Step 1: Adicionar CSS para o toggle-row**

Antes do `</style>` (L220), inserir:

```css
.pref-flow-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)}
.pref-flow-row:last-child{border-bottom:none}
.pref-flow-label{font-size:13px;font-weight:500}
.pref-flow-sub{font-size:11px;color:var(--muted);margin-top:2px}
.pref-time-input{width:70px;padding:5px 8px;font-family:var(--mono);font-size:13px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--card2);color:var(--text);text-align:center}
```

- [ ] **Step 2: Adicionar seção "Fluxo Diário" na aba Pessoal**

Após o fechamento da div de "Cor de destaque" (antes de `</div>` que fecha `pref-tab-pessoal`), inserir:

```html
<div class="pref-section">
  <div class="pref-section-title">Fluxo Diário</div>
  <div class="pref-flow-row">
    <div><div class="pref-flow-label">Entrada</div><div class="pref-flow-sub">Hora de início do expediente</div></div>
    <input class="pref-time-input" id="pref-hora-entrada" type="time" value="08:00" onchange="saveSchedule()">
  </div>
  <div class="pref-flow-row">
    <div><div class="pref-flow-label">Almoço</div><div class="pref-flow-sub">Saída para o almoço</div></div>
    <input class="pref-time-input" id="pref-hora-almoco" type="time" value="12:00" onchange="saveSchedule()">
  </div>
  <div class="pref-flow-row">
    <div><div class="pref-flow-label">Retorno</div><div class="pref-flow-sub">Hora prevista de retorno</div></div>
    <input class="pref-time-input" id="pref-hora-retorno" type="time" value="13:00" onchange="saveSchedule()">
  </div>
  <div class="pref-flow-row">
    <div><div class="pref-flow-label">Saída</div><div class="pref-flow-sub">Fim do expediente</div></div>
    <input class="pref-time-input" id="pref-hora-saida" type="time" value="17:00" onchange="saveSchedule()">
  </div>
  <div class="pref-flow-row">
    <div><div class="pref-flow-label">Carga diária (h)</div><div class="pref-flow-sub">Horas de trabalho esperadas por dia</div></div>
    <input class="pref-time-input" id="pref-carga-diaria" type="number" min="1" max="24" value="8" style="width:60px" onchange="saveSchedule()">
  </div>
  <div class="pref-flow-row">
    <div><div class="pref-flow-label">WIP Limit</div><div class="pref-flow-sub">Máx. de OSs em andamento ao mesmo tempo</div></div>
    <input class="pref-time-input" id="pref-wip-limit" type="number" min="1" max="10" value="3" style="width:60px" onchange="saveSchedule()">
  </div>
</div>
```

- [ ] **Step 3: Adicionar funções de leitura/escrita de schedule**

Após a função `saveTipoAtividades` (L4541 aprox.), inserir:

```js
// ── SCHEDULE (vs_schedule) ────────────────────────────────────────────────────
function getSchedule(){
  try{return JSON.parse(localStorage.getItem('vs_schedule'))||{}}catch(e){return{}}
}
function saveSchedule(){
  var s={
    entrada:document.getElementById('pref-hora-entrada').value||'08:00',
    almoco:document.getElementById('pref-hora-almoco').value||'12:00',
    retorno:document.getElementById('pref-hora-retorno').value||'13:00',
    saida:document.getElementById('pref-hora-saida').value||'17:00',
    cargaDiaria:parseFloat(document.getElementById('pref-carga-diaria').value)||8,
    wipLimit:parseInt(document.getElementById('pref-wip-limit').value)||3
  };
  localStorage.setItem('vs_schedule',JSON.stringify(s));
}
function loadSchedulePrefs(){
  var s=getSchedule();
  var el=function(id){return document.getElementById(id)};
  if(el('pref-hora-entrada'))el('pref-hora-entrada').value=s.entrada||'08:00';
  if(el('pref-hora-almoco'))el('pref-hora-almoco').value=s.almoco||'12:00';
  if(el('pref-hora-retorno'))el('pref-hora-retorno').value=s.retorno||'13:00';
  if(el('pref-hora-saida'))el('pref-hora-saida').value=s.saida||'17:00';
  if(el('pref-carga-diaria'))el('pref-carga-diaria').value=s.cargaDiaria||8;
  if(el('pref-wip-limit'))el('pref-wip-limit').value=s.wipLimit||3;
}
```

- [ ] **Step 4: Chamar `loadSchedulePrefs` ao abrir a aba Pessoal**

Na função `goPrefsTab` (buscar por `goPrefsTab` no arquivo), no bloco de `pessoal`, adicionar chamada:

```js
// dentro do if(name==='pessoal') ou equivalente
loadSchedulePrefs();
```

- [ ] **Step 5: Verificar no browser**

Abrir Preferências → aba Pessoal. Confirmar que a seção "Fluxo Diário" aparece com 6 campos. Alterar um horário, fechar e reabrir — deve manter o valor.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: configuração de horários e WIP limit nas preferências pessoais [skip netlify]"
```

---

### Task 2: Sino de notificações na topbar

**Arquivos:**
- Modify: `index.html` — topbar HTML (L360–371) e novo CSS + JS

**Contexto:** A topbar está em L360–371. O user-badge com logout está à direita. Vamos inserir o sino entre `topbar-actions` e `user-badge`.

- [ ] **Step 1: Adicionar CSS do sino**

Antes do `</style>`, inserir:

```css
/* ── SINO ── */
@keyframes bell-ring{0%{transform:rotate(0)}10%{transform:rotate(15deg)}20%{transform:rotate(-12deg)}30%{transform:rotate(10deg)}40%{transform:rotate(-8deg)}50%{transform:rotate(5deg)}70%{transform:rotate(-2deg)}100%{transform:rotate(0)}}
.bell-wrap{position:relative;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:8px;transition:background .15s}
.bell-wrap:hover{background:var(--card2)}
.bell-icon{font-size:16px;display:inline-block;color:var(--muted);transform-origin:top center}
.bell-icon.ringing{animation:bell-ring .9s ease infinite}
.bell-badge{position:absolute;top:2px;right:2px;min-width:14px;height:14px;padding:0 3px;background:#f59e0b;border-radius:7px;border:1.5px solid var(--bg);font-size:9px;font-weight:700;color:#fff;display:flex;align-items:center;justify-content:center;line-height:1}
/* dropdown */
.bell-dropdown{position:absolute;top:calc(100% + 8px);right:0;width:320px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);z-index:500;overflow:hidden;font-family:var(--font)}
.bell-dd-header{padding:10px 14px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.bell-dd-item{padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;line-height:1.5;color:var(--text)}
.bell-dd-item:last-child{border-bottom:none}
.bell-dd-time{font-size:10px;color:var(--hint);margin-top:2px}
.bell-dd-empty{padding:20px 14px;font-size:12px;color:var(--hint);text-align:center}
```

- [ ] **Step 2: Inserir sino na topbar HTML**

Localizar a linha da topbar (L362–363):
```html
<div class="topbar-actions" id="topbar-actions"></div>
```

Após essa div e antes do `user-badge`, inserir:

```html
<div style="position:relative" id="bell-container">
  <div class="bell-wrap" onclick="toggleBellDropdown()">
    <span class="bell-icon" id="bell-icon">🔔</span>
    <div id="bell-badge" style="display:none" class="bell-badge">0</div>
  </div>
  <div class="bell-dropdown" id="bell-dropdown" style="display:none">
    <div class="bell-dd-header">
      <span>Notificações</span>
      <span style="cursor:pointer;font-size:10px;color:var(--accent)" onclick="markAllAlertsRead()">Marcar todas lidas</span>
    </div>
    <div id="bell-dd-body"></div>
  </div>
</div>
```

- [ ] **Step 3: Adicionar JS do sino**

Após as funções de schedule (Task 1), inserir:

```js
// ── ALERTAS / SINO (vs_alerts_YYYY-MM-DD) ────────────────────────────────────
var _alertsKey=function(){return'vs_alerts_'+new Date().toISOString().slice(0,10)};
function getAlerts(){try{return JSON.parse(localStorage.getItem(_alertsKey()))||[]}catch(e){return[]}}
function saveAlerts(arr){localStorage.setItem(_alertsKey(),JSON.stringify(arr))}

function toggleBellDropdown(){
  var dd=document.getElementById('bell-dropdown');
  if(dd.style.display==='none'){
    dd.style.display='block';
    renderBellDropdown();
    markAllAlertsRead();
  }else{
    dd.style.display='none';
  }
}

function renderBellDropdown(){
  var alerts=getAlerts();
  var body=document.getElementById('bell-dd-body');
  if(!body)return;
  if(alerts.length===0){body.innerHTML='<div class="bell-dd-empty">Nenhuma notificação hoje.</div>';return}
  body.innerHTML=alerts.slice().reverse().map(function(a){
    return'<div class="bell-dd-item"><div>'+a.message+'</div><div class="bell-dd-time">'+a.firedAt.slice(11,16)+'</div></div>';
  }).join('');
}

function markAllAlertsRead(){
  var alerts=getAlerts();
  var now=new Date().toISOString();
  alerts=alerts.map(function(a){return Object.assign({},a,{readAt:a.readAt||now})});
  saveAlerts(alerts);
  updateBellUI();
}

function updateBellUI(){
  var alerts=getAlerts();
  var unread=alerts.filter(function(a){return!a.readAt}).length;
  var icon=document.getElementById('bell-icon');
  var badge=document.getElementById('bell-badge');
  if(!icon||!badge)return;
  if(unread>0){
    icon.classList.add('ringing');
    badge.style.display='flex';
    badge.textContent=unread>9?'9+':unread;
  }else{
    icon.classList.remove('ringing');
    badge.style.display='none';
  }
}

function fireAlert(type,message){
  var alerts=getAlerts();
  if(alerts.some(function(a){return a.type===type}))return; // já disparou hoje
  alerts.push({type:type,message:message,firedAt:new Date().toISOString(),readAt:null});
  saveAlerts(alerts);
  updateBellUI();
}
```

- [ ] **Step 4: Fechar dropdown ao clicar fora**

No evento `onclick` do `document` (buscar `document.addEventListener` no arquivo, ou adicionar um), registrar:

```js
document.addEventListener('click',function(e){
  var bc=document.getElementById('bell-container');
  if(bc&&!bc.contains(e.target)){
    var dd=document.getElementById('bell-dropdown');
    if(dd)dd.style.display='none';
  }
});
```

- [ ] **Step 5: Verificar no browser**

Abrir o app. O sino deve aparecer na topbar, cinza e estático. Chamar `fireAlert('teste','Mensagem de teste')` no console. Confirmar que o sino começa a animar e o badge aparece. Clicar no sino para abrir o dropdown. Clicar em "Marcar todas lidas" — badge deve sumir e sino parar.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: sino de notificações na topbar com dropdown e animação [skip netlify]"
```

---

### Task 3: Disparador de alertas temporais (setInterval)

**Arquivos:**
- Modify: `index.html` — lógica de inicialização (próximo ao bloco de startup, L5179+)

**Contexto:** Os alertas devem ser verificados a cada 60 segundos. O retorno é detectado quando o usuário está de volta após uma pausa (última atividade registrada há >30min e agora está ativo).

- [ ] **Step 1: Adicionar função de verificação de alertas**

Após `fireAlert` (Task 2), inserir:

```js
var _lastActivityAt=Date.now();
function touchActivity(){_lastActivityAt=Date.now()}

function checkAlerts(){
  var s=getSchedule();
  var now=new Date();
  var hhmm=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');

  // Início do expediente
  if(hhmm===s.entrada){
    fireAlert('inicio','Bom dia! Hora de planejar seu dia — que tal começar pelo planejamento?');
    // Se não há plano do dia, abrir modal de planejamento
    var planKey='vs_dayplan_'+now.toISOString().slice(0,10);
    var plan=null;try{plan=JSON.parse(localStorage.getItem(planKey))}catch(e){}
    if(!plan||!plan.confirmedAt)setTimeout(openDayPlanModal,500);
  }

  // Almoço
  if(hhmm===s.almoco){
    fireAlert('almoco','Hora do almoço! Não esqueça de registrar o ponto antes de sair.');
  }

  // Retorno — detectado por atividade após pausa longa
  var pausaMin=(Date.now()-_lastActivityAt)/60000;
  if(pausaMin<2)touchActivity(); // usuário ativo agora: atualizar lastActivity
  if(hhmm>=s.retorno&&pausaMin>30){
    fireAlert('retorno','Bem-vindo de volta! Reveja o planejamento — o que ainda falta para hoje?');
    _lastActivityAt=Date.now();
  }

  // Fim do expediente (15 min antes)
  var saidaMin=toMin(s.saida||'17:00');
  var nowMin=now.getHours()*60+now.getMinutes();
  if(nowMin===saidaMin-15){
    fireAlert('fim','Expediente quase no fim. Hora de fechar as OSs do dia e apropriar as horas.');
  }

  // Hora extra (30 min após saída)
  if(nowMin===saidaMin+30){
    fireAlert('extra','Ainda por aqui? Você é muito dedicado! Não esqueça de registrar tudo antes de sair.');
  }

  updateBellUI();
}
```

Note: `toMin` já existe no arquivo (buscar por `function toMin` — converte `"HH:MM"` em minutos).

- [ ] **Step 2: Registrar o intervalo na inicialização**

No bloco de startup (próximo ao final do `<script>`, onde o app inicializa), adicionar:

```js
setInterval(checkAlerts, 60000);
updateBellUI(); // atualizar badge ao carregar
```

- [ ] **Step 3: Verificar no browser (via console)**

Para testar sem esperar a hora certa, chamar:
```js
// simular horário de almoço
var s=getSchedule(); s.almoco=new Date().getHours().toString().padStart(2,'0')+':'+new Date().getMinutes().toString().padStart(2,'0'); localStorage.setItem('vs_schedule',JSON.stringify(s));
checkAlerts();
```
Confirmar que o alerta de almoço aparece no sino. Reload da página: badge deve persistir.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: verificação automática de alertas a cada 60s [skip netlify]"
```

---

### Task 4: Peso Inteligente — slider de estimativa na OS

**Arquivos:**
- Modify: `index.html` — modal de OS (L913–955), `openNovaOS`, `openEditOS`, `salvarOS`, `osSize`

**Contexto:** O modal de OS (`#modal-os`) tem um bloco "Entregas aplicáveis" (L940–949) que deve ser removido e substituído pelo slider de estimativa. O campo `estimatedHours` será adicionado ao objeto OS (sem quebrar OSs existentes — `os.estimatedHours || 0`).

- [ ] **Step 1: Adicionar CSS do slider**

Antes de `</style>`, inserir:

```css
/* ── PESO INTELIGENTE ── */
.peso-slider-wrap{display:flex;flex-direction:column;gap:10px}
.peso-slider{-webkit-appearance:none;width:100%;height:4px;background:var(--border2);border-radius:2px;outline:none;cursor:pointer}
.peso-slider::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--accent);cursor:pointer;border:2px solid var(--bg)}
.peso-markers{display:flex;justify-content:space-between;font-size:10px;color:var(--hint);font-family:var(--mono)}
.peso-badge-epico{background:rgba(167,139,250,.15);color:#a78bfa;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600}
.peso-badge-grande{background:rgba(245,158,11,.15);color:#f59e0b;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600}
.peso-badge-normal{background:rgba(96,165,250,.15);color:#60a5fa;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600}
.peso-badge-rapida{background:rgba(16,185,129,.15);color:#10b981;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600}
```

- [ ] **Step 2: Substituir bloco "Entregas aplicáveis" pelo slider**

Localizar e remover (L940–949):
```html
<!-- Entregas em 2 colunas -->
<div class="form-group">
  <label class="form-label" style="margin-bottom:6px">Entregas aplicáveis</label>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
    <label class="form-check"><input type="checkbox" id="e-novidade" checked><span class="form-check-label">Novidade de versão</span><span class="form-check-hint">Boletim</span></label>
    <label class="form-check"><input type="checkbox" id="e-help"><span class="form-check-label">Help (Zendesk)</span><span class="form-check-hint">Artigo</span></label>
    <label class="form-check"><input type="checkbox" id="e-tutorial"><span class="form-check-label">Tutorial</span><span class="form-check-hint">Vídeo</span></label>
    <label class="form-check"><input type="checkbox" id="e-evidencia" checked><span class="form-check-label">Evidência</span><span class="form-check-hint">Documento</span></label>
  </div>
</div>
```

Substituir por:
```html
<!-- Peso Inteligente -->
<div class="form-group">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
    <label class="form-label" style="margin:0">Estimativa de esforço</label>
    <span id="os-peso-badge" class="peso-badge-normal">Normal</span>
  </div>
  <div class="peso-slider-wrap">
    <div style="display:flex;align-items:center;gap:10px">
      <input type="range" class="peso-slider" id="os-horas-slider" min="1" max="24" step="0.5" value="4" oninput="onPesoSliderChange(this.value)">
      <input type="number" id="os-horas-input" min="0.5" step="0.5" value="4" style="width:70px;padding:5px 8px;font-family:var(--mono);font-size:13px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--card2);color:var(--text);text-align:center" oninput="onPesoInputChange(this.value)">
      <span style="font-size:12px;color:var(--muted)">h</span>
    </div>
    <div class="peso-markers"><span>1h</span><span>2h</span><span>6h</span><span>14h</span><span>24h</span></div>
  </div>
  <div style="font-size:11px;color:var(--hint);margin-top:6px" id="os-velocity-hint"></div>
</div>
```

- [ ] **Step 3: Adicionar funções de controle do slider**

Após `saveSchedule` (Task 1), inserir:

```js
// ── PESO INTELIGENTE ─────────────────────────────────────────────────────────
function getVelocityFactor(){return parseFloat(localStorage.getItem('vs_velocity_factor'))||1.0}

function osPorteFromHours(h){
  if(h<=2)return{key:'rapida',label:'Rápida',cls:'peso-badge-rapida'};
  if(h<=6)return{key:'normal',label:'Normal',cls:'peso-badge-normal'};
  if(h<=14)return{key:'grande',label:'Grande',cls:'peso-badge-grande'};
  return{key:'epico',label:'Épico',cls:'peso-badge-epico'};
}

function updatePesoBadge(h){
  var p=osPorteFromHours(parseFloat(h)||0);
  var el=document.getElementById('os-peso-badge');
  if(!el)return;
  el.textContent=p.label;
  el.className=p.cls;
}

function onPesoSliderChange(v){
  document.getElementById('os-horas-input').value=v;
  updatePesoBadge(v);
}

function onPesoInputChange(v){
  var n=parseFloat(v)||0;
  if(n<=24)document.getElementById('os-horas-slider').value=Math.min(n,24);
  updatePesoBadge(n);
}

function setPesoValue(h){
  var n=parseFloat(h)||2;
  document.getElementById('os-horas-slider').value=Math.min(n,24);
  document.getElementById('os-horas-input').value=n;
  updatePesoBadge(n);
  // Dica de velocidade
  var vf=getVelocityFactor();
  var hint=document.getElementById('os-velocity-hint');
  if(hint&&vf!==1.0){
    var dir=vf>1?'tende a superestimar':'tende a subestimar';
    hint.textContent='Seu fator de velocidade: '+vf.toFixed(2)+' (você '+dir+')';
  }else if(hint){hint.textContent=''}
}
```

- [ ] **Step 4: Atualizar `openNovaOS` para usar estimativa**

Localizar `openNovaOS` (L2004). Remover as linhas que setam checkboxes `e-novidade`, `e-help`, `e-tutorial`, `e-evidencia`. Adicionar após `populateAtribSel`:

```js
// sugestão baseada em velocity
var vf=getVelocityFactor();
setPesoValue(Math.round((4/vf)*2)/2); // default 4h ajustado pelo fator
```

- [ ] **Step 5: Atualizar `openEditOS` para usar estimativa**

Localizar `openEditOS` (L2017). Remover as 4 linhas de checkboxes. Adicionar:

```js
setPesoValue(os.estimatedHours||4);
```

- [ ] **Step 6: Atualizar `salvarOS` para salvar `estimatedHours`**

Localizar `salvarOS` (L2037). Remover bloco de `entregas:{}`. No objeto `data`, adicionar:

```js
estimatedHours: parseFloat(document.getElementById('os-horas-input').value)||2,
```

Manter `entregas: old ? old.entregas : {}` para não quebrar dados existentes.

- [ ] **Step 7: Reescrever `osSize` baseado em horas**

Localizar a função `osSize` (L1580–1584, atual baseada em entregas). Substituir por:

```js
function osSize(os){
  var h=os.estimatedHours||0;
  if(h<=2)return{label:'R',title:'Rápida (≤2h)',color:'var(--green-text)'};
  if(h<=6)return{label:'N',title:'Normal (≤6h)',color:'var(--accent)'};
  if(h<=14)return{label:'G',title:'Grande (≤14h)',color:'#f59e0b'};
  return{label:'E',title:'Épico (>14h)',color:'#a78bfa'};
}
```

- [ ] **Step 8: Verificar no browser**

Abrir "Nova OS". Confirmar que o slider aparece no lugar do checklist. Mover o slider — badge deve atualizar em tempo real. Digitar 30 no campo numérico — slider deve pinnar em 24h mas badge deve mostrar "Épico". Salvar e reabrir — valor deve ser mantido. No Kanban, card deve mostrar badge do porte correto.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat: Peso Inteligente — slider de estimativa de horas substitui checklist de entregas [skip netlify]"
```

---

### Task 5: Cálculo de velocity factor + Modal de Planejamento do Dia

**Arquivos:**
- Modify: `index.html` — novas funções + novo modal `#modal-dayplan`

**Contexto:** O modal de planejamento abre automaticamente no login (ou via alerta de início). O velocity factor é calculado a partir de dados do `vs_dayresume_*`.

- [ ] **Step 1: Adicionar CSS do modal de planejamento**

Antes de `</style>`, inserir:

```css
/* ── PLANEJAMENTO DO DIA ── */
.dayplan-os-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}
.dayplan-os-row:last-child{border-bottom:none}
.dayplan-os-check{width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;cursor:pointer}
.dayplan-os-info{flex:1;min-width:0}
.dayplan-os-title{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dayplan-os-sub{font-size:11px;color:var(--muted);margin-top:2px}
.dayplan-h-input{width:60px;padding:4px 8px;font-family:var(--mono);font-size:13px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--card2);color:var(--text);text-align:center}
.dayplan-total{font-size:22px;font-weight:700;font-family:var(--mono);padding:0 16px}
```

- [ ] **Step 2: Adicionar HTML do modal de planejamento**

Após o último modal existente (antes de `</body>`), inserir:

```html
<!-- MODAL PLANEJAMENTO DO DIA -->
<div class="modal-overlay" id="modal-dayplan" style="z-index:400">
  <div class="modal" style="max-width:560px">
    <div id="dayplan-greeting" style="font-size:18px;font-weight:600;margin-bottom:4px"></div>
    <div id="dayplan-date" style="font-size:12px;color:var(--muted);margin-bottom:20px"></div>
    <div class="modal-title" style="margin-bottom:12px">Planejamento do dia</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:16px">Selecione as OSs que vai trabalhar hoje e ajuste as horas estimadas.</div>
    <div id="dayplan-os-list" style="max-height:320px;overflow-y:auto"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <div>
        <div style="font-size:11px;color:var(--muted)">Total planejado</div>
        <div style="display:flex;align-items:baseline;gap:6px">
          <span id="dayplan-total" class="dayplan-total" style="color:var(--accent)">0h</span>
          <span id="dayplan-total-status" style="font-size:11px;color:var(--muted)"></span>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="closeModal('modal-dayplan')">Depois</button>
        <button class="btn btn-primary" onclick="confirmDayPlan()">Começar o dia →</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Adicionar funções do planejamento**

Após `onPesoInputChange` (Task 4), inserir:

```js
// ── PLANEJAMENTO DO DIA ───────────────────────────────────────────────────────
function getDayKey(){return'vs_dayplan_'+new Date().toISOString().slice(0,10)}

function getDayPlan(){
  try{return JSON.parse(localStorage.getItem(getDayKey()))||null}catch(e){return null}
}

function openDayPlanModal(){
  var plan=getDayPlan();
  if(plan&&plan.confirmedAt)return; // já confirmado hoje
  var now=new Date();
  var dias=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  var meses=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  var greetEl=document.getElementById('dayplan-greeting');
  var dateEl=document.getElementById('dayplan-date');
  var h=now.getHours();
  var greeting=h<12?'Bom dia 👋':h<18?'Boa tarde 👋':'Boa noite 👋';
  if(greetEl)greetEl.textContent=greeting+(CURRENT_USER&&CURRENT_USER.user_metadata&&CURRENT_USER.user_metadata.full_name?', '+(CURRENT_USER.user_metadata.full_name.split(' ')[0]):'')+'!';
  if(dateEl)dateEl.textContent=dias[now.getDay()]+', '+now.getDate()+' de '+meses[now.getMonth()]+' de '+now.getFullYear();

  var vf=getVelocityFactor();
  var andamento=S.oss.filter(function(o){return o.status==='andamento'});
  // Prioridade: data de vencimento (se existir) → porte (epico > grande > normal > rapida)
  var ordemPorte={epico:0,grande:1,normal:2,rapida:3};
  andamento.sort(function(a,b){
    var pa=osPorteFromHours(a.estimatedHours||0).key;
    var pb=osPorteFromHours(b.estimatedHours||0).key;
    return(ordemPorte[pa]||2)-(ordemPorte[pb]||2);
  });

  var savedEntries=(plan&&plan.entries)||[];
  var list=document.getElementById('dayplan-os-list');
  if(!list)return;
  list.innerHTML=andamento.length===0
    ?'<div style="text-align:center;padding:24px;font-size:12px;color:var(--hint)">Nenhuma OS em andamento. Inicie uma OS no Kanban primeiro.</div>'
    :andamento.map(function(os){
      var saved=savedEntries.find(function(e){return e.osId===os.id});
      var suggestedH=saved?saved.plannedHours:Math.round(((os.estimatedHours||2)/vf)*2)/2;
      var checked=saved?true:false;
      var porte=osPorteFromHours(os.estimatedHours||0);
      return'<div class="dayplan-os-row" id="dayplan-row-'+os.id+'">'
        +'<input type="checkbox" class="dayplan-os-check" id="dayplan-chk-'+os.id+'" '+(checked?'checked':'')
        +' onchange="updateDayPlanTotal()">'
        +'<div class="dayplan-os-info">'
        +'<div class="dayplan-os-title"><span class="'+porte.cls+'" style="font-size:10px;padding:1px 7px;border-radius:10px;margin-right:6px">'+porte.label+'</span>#'+os.num+' · '+os.titulo+'</div>'
        +'<div class="dayplan-os-sub">Estimativa: '+os.estimatedHours+'h</div>'
        +'</div>'
        +'<input class="dayplan-h-input" type="number" min="0.5" step="0.5" value="'+suggestedH
        +'" id="dayplan-h-'+os.id+'" oninput="updateDayPlanTotal()">'
        +'<span style="font-size:12px;color:var(--muted)">h</span>'
        +'</div>';
    }).join('');

  updateDayPlanTotal();
  openModal('modal-dayplan');
}

function updateDayPlanTotal(){
  var total=0;
  var andamento=S.oss.filter(function(o){return o.status==='andamento'});
  andamento.forEach(function(os){
    var chk=document.getElementById('dayplan-chk-'+os.id);
    var inp=document.getElementById('dayplan-h-'+os.id);
    if(chk&&chk.checked&&inp)total+=parseFloat(inp.value)||0;
  });
  var s=getSchedule();
  var carga=s.cargaDiaria||8;
  var totalEl=document.getElementById('dayplan-total');
  var statusEl=document.getElementById('dayplan-total-status');
  if(totalEl)totalEl.textContent=total+'h';
  if(statusEl){
    if(total===0){statusEl.textContent='';totalEl.style.color='var(--muted)';}
    else if(total<=carga){statusEl.textContent='✓ dentro da carga';totalEl.style.color='var(--green-text)';}
    else if(total<=carga*1.15){statusEl.textContent='⚠ ligeiramente acima';totalEl.style.color='#f59e0b';}
    else{statusEl.textContent='✕ acima da capacidade';totalEl.style.color='var(--red-text)';}
  }
}

function confirmDayPlan(){
  var andamento=S.oss.filter(function(o){return o.status==='andamento'});
  var entries=[];
  andamento.forEach(function(os){
    var chk=document.getElementById('dayplan-chk-'+os.id);
    var inp=document.getElementById('dayplan-h-'+os.id);
    if(chk&&chk.checked){
      entries.push({osId:os.id,osTitle:'#'+os.num+' · '+os.titulo,plannedHours:parseFloat(inp.value)||0,actualHours:0,status:'pendente'});
    }
  });
  var plan={createdAt:new Date().toISOString(),confirmedAt:new Date().toISOString(),entries:entries};
  localStorage.setItem(getDayKey(),JSON.stringify(plan));
  closeModal('modal-dayplan');
  toast('Planejamento salvo — bom trabalho!');
}
```

- [ ] **Step 4: Adicionar cálculo de velocity factor**

Após `confirmDayPlan`, inserir:

```js
function recalcVelocityFactor(){
  var entries=[];
  // Coletar resumos dos últimos 30 dias
  var now=new Date();
  for(var i=0;i<30;i++){
    var d=new Date(now);d.setDate(d.getDate()-i);
    var k='vs_dayresume_'+d.toISOString().slice(0,10);
    try{
      var r=JSON.parse(localStorage.getItem(k));
      if(r&&r.confirmedAt&&Array.isArray(r.entries)){
        r.entries.forEach(function(e){
          if(e.plannedHours>0&&e.approvedHours>0)entries.push({planned:e.plannedHours,actual:e.approvedHours});
        });
      }
    }catch(ex){}
  }
  if(entries.length<5)return; // mínimo 5 OSs para calcular
  var sum=entries.reduce(function(acc,e){return acc+e.actual/e.planned},0);
  var factor=parseFloat((sum/entries.length).toFixed(2));
  localStorage.setItem('vs_velocity_factor',factor);
}
```

- [ ] **Step 5: Chamar `openDayPlanModal` na inicialização do app**

No bloco de startup (onde o app carrega dados e renderiza), após o usuário estar autenticado, adicionar:

```js
// Verificar plano do dia pendente
var _todayPlan=getDayPlan();
if(!_todayPlan||!_todayPlan.confirmedAt){
  // Abrir com pequeno delay para o app terminar de carregar
  setTimeout(openDayPlanModal,1200);
}
```

- [ ] **Step 6: Verificar no browser**

Fazer login. O modal de planejamento deve abrir automaticamente (a menos que já tenha sido confirmado hoje). Selecionar OSs e ajustar horas. O total deve atualizar em tempo real com indicador de cor. Clicar "Começar o dia" — modal deve fechar. Recarregar a página: modal não deve reabrir.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: modal de Planejamento do Dia com seleção de OSs e estimativa [skip netlify]"
```

---

## FASE 2 — Foco / Timer + Resumo do Dia

---

### Task 6: Pill de foco na topbar

**Arquivos:**
- Modify: `index.html` — topbar HTML, CSS + JS do focus state

**Contexto:** A pill vai entre o sino e o user-badge. Timer é timestamp-based (resiste a refresh).

- [ ] **Step 1: Adicionar CSS da pill de foco**

Antes de `</style>`, inserir:

```css
/* ── FOCO / TIMER ── */
@keyframes dot-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
.foco-pill{display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--border);border-radius:20px;padding:5px 12px 5px 10px;cursor:pointer;transition:border-color .15s;max-width:280px;min-width:160px;position:relative}
.foco-pill:hover{border-color:var(--accent)}
.foco-pill.foco-active{border-color:#10b981}
.foco-pill.foco-paused{border-color:#f59e0b}
.foco-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.foco-dot.active{background:#10b981;animation:dot-pulse 1.4s ease infinite}
.foco-dot.paused{background:#f59e0b}
.foco-dot.idle{background:var(--border2)}
.foco-info{flex:1;min-width:0}
.foco-os-label{font-size:11px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.foco-timer-label{font-size:11px;font-family:var(--mono);color:#10b981;font-weight:600}
.foco-timer-label.paused{color:#f59e0b}
.foco-empty-label{font-size:12px;color:var(--hint);white-space:nowrap}
/* dropdown de foco */
.foco-dropdown{position:absolute;top:calc(100% + 8px);left:0;min-width:300px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.5);z-index:500;overflow:hidden}
.foco-dd-section{padding:8px 12px;font-size:10px;font-weight:600;color:var(--hint);text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--border)}
.foco-dd-row{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;transition:background .1s}
.foco-dd-row:hover{background:var(--card2)}
.foco-dd-row.current-row{background:rgba(16,185,129,.06);border-left:2px solid #10b981}
.foco-dd-actions{display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--border)}
.foco-dd-btn{flex:1;font-size:11px;padding:6px;border-radius:6px;cursor:pointer;font-weight:500;border:1px solid var(--border2);background:none;color:var(--muted);font-family:var(--font)}
.foco-dd-btn:hover{background:var(--card2)}
.foco-dd-btn.success{color:#10b981;border-color:rgba(16,185,129,.3)}
```

- [ ] **Step 2: Inserir pill na topbar HTML**

Na topbar (L362), após o `<div class="topbar-actions" id="topbar-actions"></div>`, inserir a pill antes do bell-container:

```html
<div style="position:relative;flex:1;max-width:300px" id="foco-container">
  <div class="foco-pill" id="foco-pill" onclick="toggleFocoDropdown()">
    <div class="foco-dot idle" id="foco-dot"></div>
    <div class="foco-info">
      <div id="foco-label"><span class="foco-empty-label">▶ Nenhuma OS em foco</span></div>
    </div>
    <span style="font-size:10px;color:var(--hint)">▾</span>
  </div>
  <div class="foco-dropdown" id="foco-dropdown" style="display:none"></div>
</div>
```

- [ ] **Step 3: Adicionar variáveis de estado de foco**

Após as variáveis de estado existentes (próximo a L1593), inserir:

```js
var _focusInterval=null;
```

- [ ] **Step 4: Adicionar funções do foco**

Após `recalcVelocityFactor` (Task 5), inserir:

```js
// ── FOCO / TIMER ─────────────────────────────────────────────────────────────
function getFocusState(){try{return JSON.parse(localStorage.getItem('vs_focus_state'))||null}catch(e){return null}}
function saveFocusState(st){
  if(st)localStorage.setItem('vs_focus_state',JSON.stringify(st));
  else localStorage.removeItem('vs_focus_state');
}
function getTodayLog(){var k='vs_time_log_'+new Date().toISOString().slice(0,10);try{return JSON.parse(localStorage.getItem(k))||[]}catch(e){return[]}}
function saveTodayLog(log){localStorage.setItem('vs_time_log_'+new Date().toISOString().slice(0,10),JSON.stringify(log))}

function focusAccumulatedToday(osId){
  var log=getTodayLog();
  return log.filter(function(s){return s.osId===osId}).reduce(function(acc,s){return acc+(s.duration||0)},0);
}

function startFocus(osId){
  var st=getFocusState();
  if(st&&st.osId===osId&&!st.pausedAt)return; // já em foco nesta OS
  // Fechar sessão anterior se existir
  if(st&&!st.pausedAt)closeFocusSession(st);
  var now=Date.now();
  var accumulated=focusAccumulatedToday(osId);
  var newSt={osId:osId,startedAt:now,pausedAt:null,accumulated:accumulated};
  saveFocusState(newSt);
  updateFocusUI();
  closeFocoDropdown();
}

function pauseFocus(){
  var st=getFocusState();if(!st||st.pausedAt)return;
  closeFocusSession(st);
  var accumulated=focusAccumulatedToday(st.osId);
  var paused={osId:st.osId,startedAt:null,pausedAt:Date.now(),accumulated:accumulated};
  saveFocusState(paused);
  updateFocusUI();
  closeFocoDropdown();
}

function resumeFocus(){
  var st=getFocusState();if(!st||!st.pausedAt)return;
  var now=Date.now();
  var newSt={osId:st.osId,startedAt:now,pausedAt:null,accumulated:st.accumulated};
  saveFocusState(newSt);
  updateFocusUI();
}

function closeFocusSession(st){
  if(!st||!st.startedAt)return;
  var dur=Math.floor((Date.now()-st.startedAt)/1000);
  if(dur<10)return;
  var log=getTodayLog();
  log.push({osId:st.osId,start:st.startedAt,end:Date.now(),duration:dur});
  saveTodayLog(log);
}

function concludeOS(osId){
  var st=getFocusState();
  if(st&&st.osId===osId&&!st.pausedAt)closeFocusSession(st);
  saveFocusState(null);
  moveOS(osId,'concluido');
  updateFocusUI();
  closeFocoDropdown();
}

function formatFocusTime(seconds){
  var h=Math.floor(seconds/3600);
  var m=Math.floor((seconds%3600)/60);
  return h>0?(h+'h'+m.toString().padStart(2,'0')+'m'):(m+'m');
}

function updateFocusUI(){
  var st=getFocusState();
  var pill=document.getElementById('foco-pill');
  var dot=document.getElementById('foco-dot');
  var label=document.getElementById('foco-label');
  if(!pill||!dot||!label)return;

  if(!st){
    pill.className='foco-pill';
    dot.className='foco-dot idle';
    label.innerHTML='<span class="foco-empty-label">▶ Nenhuma OS em foco</span>';
    clearInterval(_focusInterval);_focusInterval=null;
    return;
  }
  var os=S.oss.find(function(o){return o.id===st.osId});
  var osTitle=os?('#'+os.num+' · '+os.titulo):'OS desconhecida';

  if(st.pausedAt){
    pill.className='foco-pill foco-paused';
    dot.className='foco-dot paused';
    var acc=focusAccumulatedToday(st.osId);
    label.innerHTML='<div class="foco-os-label">'+osTitle+'</div>'
      +'<div class="foco-timer-label paused">pausado · '+formatFocusTime(acc)+'</div>';
    clearInterval(_focusInterval);_focusInterval=null;
  }else{
    pill.className='foco-pill foco-active';
    dot.className='foco-dot active';
    clearInterval(_focusInterval);
    _focusInterval=setInterval(function(){
      var elapsed=Math.floor((Date.now()-st.startedAt)/1000);
      var acc=st.accumulated+elapsed;
      var timerEl=label.querySelector('.foco-timer-label');
      if(timerEl)timerEl.textContent=formatFocusTime(acc)+' nesta sessão';
    },1000);
    var initAcc=st.accumulated;
    label.innerHTML='<div class="foco-os-label">'+osTitle+'</div>'
      +'<div class="foco-timer-label">'+formatFocusTime(initAcc)+'</div>';
  }
}

function toggleFocoDropdown(){
  var dd=document.getElementById('foco-dropdown');
  if(dd.style.display==='none'){dd.style.display='block';renderFocoDropdown();}
  else{dd.style.display='none';}
}
function closeFocoDropdown(){var dd=document.getElementById('foco-dropdown');if(dd)dd.style.display='none';}

function renderFocoDropdown(){
  var st=getFocusState();
  var planKey=getDayKey();
  var plan=null;try{plan=JSON.parse(localStorage.getItem(planKey))}catch(e){}
  var planOsIds=(plan&&plan.entries)?plan.entries.map(function(e){return e.osId}):[];
  var planOss=S.oss.filter(function(o){return planOsIds.indexOf(o.id)>-1});

  var html='';
  if(st){
    var curOs=S.oss.find(function(o){return o.id===st.osId});
    var acc=focusAccumulatedToday(st.osId);
    html+='<div class="foco-dd-section">Foco atual</div>';
    html+='<div class="foco-dd-row current-row">'
      +'<div class="foco-dot '+(st.pausedAt?'paused':'active')+'"></div>'
      +'<div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(curOs?'#'+curOs.num+' · '+curOs.titulo:'—')+'</div>'
      +'<div style="font-size:10px;color:var(--muted)">'+formatFocusTime(acc)+' hoje</div></div></div>';
    var others=planOss.filter(function(o){return o.id!==st.osId});
    if(others.length){
      html+='<div class="foco-dd-section">Trocar para</div>';
      others.forEach(function(os){
        var porte=osPorteFromHours(os.estimatedHours||0);
        html+='<div class="foco-dd-row" onclick="startFocus(\''+os.id+'\')">'
          +'<div style="width:7px;height:7px;border-radius:50%;background:var(--border2);flex-shrink:0"></div>'
          +'<span class="'+porte.cls+'" style="font-size:10px;padding:1px 7px;border-radius:10px">'+porte.label+'</span>'
          +'<div style="flex:1;min-width:0;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">#'+os.num+' · '+os.titulo+'</div>'
          +'<span style="font-size:11px;font-family:var(--mono);color:var(--muted)">'+formatFocusTime(focusAccumulatedToday(os.id))+'</span></div>';
      });
    }
    html+='<div class="foco-dd-actions">'
      +(st.pausedAt
        ?'<button class="foco-dd-btn success" onclick="resumeFocus()">▶ Retomar</button>'
        :'<button class="foco-dd-btn" onclick="pauseFocus()">⏸ Pausar</button>')
      +'<button class="foco-dd-btn success" onclick="concludeOS(\''+st.osId+'\')">✓ Concluir OS</button></div>';
  }else{
    if(planOss.length){
      html+='<div class="foco-dd-section">OSs do plano de hoje</div>';
      planOss.forEach(function(os){
        var porte=osPorteFromHours(os.estimatedHours||0);
        html+='<div class="foco-dd-row" onclick="startFocus(\''+os.id+'\')">'
          +'<span class="'+porte.cls+'" style="font-size:10px;padding:1px 7px;border-radius:10px">'+porte.label+'</span>'
          +'<div style="flex:1;min-width:0;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">#'+os.num+' · '+os.titulo+'</div></div>';
      });
    }else{
      html+='<div style="padding:16px 12px;font-size:12px;color:var(--hint)">Nenhuma OS no plano de hoje. Crie um planejamento primeiro.</div>';
    }
  }
  document.getElementById('foco-dropdown').innerHTML=html;
}
```

- [ ] **Step 5: Fechar dropdown ao clicar fora**

No listener de `document.addEventListener('click',...)` já adicionado na Task 2, adicionar também:

```js
var fc=document.getElementById('foco-container');
if(fc&&!fc.contains(e.target)){closeFocoDropdown();}
```

- [ ] **Step 6: Inicializar foco no startup**

No bloco de startup, após `updateBellUI()`, adicionar:

```js
updateFocusUI();
```

- [ ] **Step 7: Verificar no browser**

Confirmar que a pill aparece na topbar com "▶ Nenhuma OS em foco". Criar um plano do dia com uma OS. Clicar na pill → dropdown deve mostrar as OSs do plano. Clicar em uma OS → pill deve mudar para verde com ponto pulsante e timer rodando. Pausar → borda âmbar, ponto fixo. Reload → timer deve continuar de onde parou.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: pill de foco na topbar com timer timestamp-based e dropdown de troca [skip netlify]"
```

---

### Task 7: WIP Limit no Kanban

**Arquivos:**
- Modify: `index.html` — função `moveOS` (L4422–4428) + novo modal `#modal-wip`

- [ ] **Step 1: Adicionar HTML do modal WIP**

Após o modal de planejamento, inserir:

```html
<!-- MODAL WIP LIMIT -->
<div class="modal-overlay" id="modal-wip" style="z-index:450">
  <div class="modal" style="max-width:440px">
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px">
      <span style="font-size:24px">⚠️</span>
      <div>
        <div style="font-size:15px;font-weight:600;margin-bottom:4px">Limite WIP atingido</div>
        <div id="wip-message" style="font-size:12px;color:var(--muted);line-height:1.5"></div>
      </div>
    </div>
    <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Em andamento agora</div>
    <div id="wip-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px"></div>
    <div style="display:flex;gap:8px">
      <button class="btn" onclick="closeModal('modal-wip')">Cancelar</button>
      <button class="btn" style="color:var(--red-text);border-color:rgba(239,68,68,.3)" id="wip-force-btn">Forçar mesmo assim</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Substituir `moveOS` para verificar WIP limit**

Localizar `moveOS` (L4422) e substituir por:

```js
function moveOS(osId,newStatus){
  var os=S.oss.find(function(o){return o.id===osId});if(!os)return;
  if(newStatus==='andamento'){
    var s=getSchedule();
    var wipLimit=s.wipLimit||3;
    var emAndamento=S.oss.filter(function(o){return o.status==='andamento'&&o.id!==osId});
    if(emAndamento.length>=wipLimit){
      showWipModal(osId,newStatus,emAndamento,wipLimit);
      return;
    }
  }
  _doMoveOS(osId,newStatus);
}

function _doMoveOS(osId,newStatus){
  var os=S.oss.find(function(o){return o.id===osId});if(!os)return;
  dbMoverOS(osId,newStatus).then(function(){
    os.status=newStatus;renderKanban();renderDash();toast('Movido: '+statusLabel(newStatus));
    sincronizarStatusRedmine(os,newStatus);
  }).catch(function(e){toast('Erro: '+e.message,'err')});
}

function showWipModal(osId,newStatus,emAndamento,wipLimit){
  var msg=document.getElementById('wip-message');
  var list=document.getElementById('wip-list');
  var forceBtn=document.getElementById('wip-force-btn');
  if(msg)msg.innerHTML='Você já tem <strong style="color:var(--red-text)">'+emAndamento.length+' OSs em andamento</strong>. Conclua uma antes de iniciar outra — ou force o movimento se for urgente.';
  if(list)list.innerHTML=emAndamento.map(function(o){
    var porte=osPorteFromHours(o.estimatedHours||0);
    return'<div style="display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--border);border-radius:7px;padding:9px 12px">'
      +'<span class="'+porte.cls+'" style="font-size:10px;padding:1px 7px;border-radius:10px">'+porte.label+'</span>'
      +'<div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">#'+o.num+' · '+o.titulo+'</div></div>'
      +'<button onclick="closeModal(\'modal-wip\');_doMoveOS(\''+o.id+'\',\'concluido\')" style="font-size:11px;padding:4px 10px;background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.3);border-radius:5px;cursor:pointer">Concluir</button>'
      +'</div>';
  }).join('');
  if(forceBtn)forceBtn.onclick=function(){closeModal('modal-wip');_doMoveOS(osId,newStatus)};
  openModal('modal-wip');
}
```

- [ ] **Step 3: Verificar no browser**

Colocar 3 OSs em andamento. Tentar mover uma 4ª para "Em andamento". O modal WIP deve aparecer listando as 3 em andamento. Clicar "Concluir" em uma → deve mover para concluído. Clicar "Forçar mesmo assim" → deve mover a OS normalmente.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: WIP limit no Kanban com modal de aviso e ação de concluir [skip netlify]"
```

---

### Task 8: Modal de Resumo do Dia

**Arquivos:**
- Modify: `index.html` — `salvarPonto`, CSS + HTML do modal `#modal-dayresume`

- [ ] **Step 1: Adicionar CSS do resumo**

Antes de `</style>`, inserir:

```css
/* ── RESUMO DO DIA ── */
.resume-stat-box{background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;text-align:center;flex:1}
.resume-stat-val{font-size:22px;font-weight:700;font-family:var(--mono);letter-spacing:-1px}
.resume-stat-lbl{font-size:10px;color:var(--muted);margin-top:3px}
.resume-os-row{background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px}
.resume-os-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px}
.resume-cell{background:var(--surface);border-radius:6px;padding:8px 10px;text-align:center}
.resume-cell-lbl{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.resume-cell-val{font-size:15px;font-weight:600;font-family:var(--mono)}
.resume-h-input{width:70px;background:var(--surface);border:1px solid var(--accent);border-radius:5px;padding:4px 6px;color:var(--text);font-size:13px;text-align:center;font-family:var(--mono);font-weight:600}
.resume-search-input{width:100%;padding:7px 10px;font-size:12px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--card2);color:var(--text)}
```

- [ ] **Step 2: Adicionar HTML do modal de resumo**

Após o modal WIP, inserir:

```html
<!-- MODAL RESUMO DO DIA -->
<div class="modal-overlay" id="modal-dayresume" style="z-index:400">
  <div class="modal" style="max-width:600px;max-height:90vh;overflow-y:auto">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:16px;font-weight:600">Resumo do dia</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px" id="resume-date-sub"></div>
      </div>
      <div id="resume-celebration" style="display:none;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.25);border-radius:8px;padding:6px 12px;text-align:center">
        <div style="font-size:18px">🎯</div>
        <div style="font-size:10px;color:#10b981;font-weight:600;margin-top:2px">Plano cumprido!</div>
      </div>
    </div>
    <!-- Stats -->
    <div style="display:flex;gap:10px;margin-bottom:20px" id="resume-stats"></div>
    <!-- OS list -->
    <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px;display:flex;justify-content:space-between">
      <span>OSs — planejado vs rastreado vs apropriar</span>
      <span style="font-size:10px;color:var(--hint);text-transform:none;letter-spacing:0">Ajuste antes de confirmar</span>
    </div>
    <div id="resume-os-list"></div>
    <!-- Adicionar OS fora do plano -->
    <div style="margin-top:12px">
      <button class="btn btn-sm btn-ghost" onclick="toggleResumeAddOS()" id="resume-add-btn">+ Adicionar OS que esqueci de rastrear</button>
      <div id="resume-add-panel" style="display:none;margin-top:8px;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Buscar OS pelo número ou título</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="resume-search-input" id="resume-add-search" placeholder="#número ou título..." oninput="searchResumeOS(this.value)">
          <input type="number" id="resume-add-h" min="0.5" step="0.5" value="1" style="width:70px;padding:6px 8px;font-family:var(--mono);font-size:13px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--surface);color:var(--text);text-align:center">
          <span style="font-size:12px;color:var(--muted)">h</span>
        </div>
        <div id="resume-add-results" style="margin-top:8px;max-height:120px;overflow-y:auto"></div>
      </div>
    </div>
    <!-- Total -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;margin-top:16px">
      <div>
        <div style="font-size:12px;color:var(--muted)">Total a apropriar</div>
        <div style="font-size:10px;color:var(--hint);margin-top:2px">Salvo e disponível para exportar ao Redmine</div>
      </div>
      <div style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--accent)" id="resume-total">0h</div>
    </div>
    <!-- Footer -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <span style="font-size:11px;color:var(--hint)">Após confirmar, a sessão do dia é encerrada.</span>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="closeModal('modal-dayresume')">Ajustar depois</button>
        <button class="btn btn-primary" onclick="confirmDayResume()">✓ Confirmar e apropriar</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Adicionar funções do resumo**

Após `recalcVelocityFactor` (Task 5), inserir:

```js
// ── RESUMO DO DIA ─────────────────────────────────────────────────────────────
var _resumeExtraEntries=[];

function getResumeKey(){return'vs_dayresume_'+new Date().toISOString().slice(0,10)}

function openDayResumeModal(){
  _resumeExtraEntries=[];
  var plan=getDayPlan();
  var planEntries=(plan&&plan.entries)||[];
  var log=getTodayLog();

  // Calcular horas rastreadas por OS
  var trackedByOs={};
  log.forEach(function(s){
    trackedByOs[s.osId]=(trackedByOs[s.osId]||0)+Math.round(s.duration/36)/100;
  });

  // OSs fora do plano com >5 min rastreados
  var planOsIds=planEntries.map(function(e){return e.osId});
  var extraOsIds=Object.keys(trackedByOs).filter(function(id){
    return planOsIds.indexOf(id)<0&&trackedByOs[id]>=5/60;
  });

  var now=new Date();
  var dias=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  var subEl=document.getElementById('resume-date-sub');
  if(subEl)subEl.textContent=dias[now.getDay()]+', '+now.getDate()+'/'+String(now.getMonth()+1).padStart(2,'0');

  // Stats
  var totalPlanned=planEntries.reduce(function(acc,e){return acc+e.plannedHours},0);
  var totalTracked=Object.values(trackedByOs).reduce(function(acc,h){return acc+h},0);
  var diff=parseFloat((totalTracked-totalPlanned).toFixed(2));
  var statsEl=document.getElementById('resume-stats');
  if(statsEl)statsEl.innerHTML=
    '<div class="resume-stat-box"><div class="resume-stat-val" style="color:var(--accent)">'+totalPlanned+'h</div><div class="resume-stat-lbl">Planejado</div></div>'
    +'<div class="resume-stat-box"><div class="resume-stat-val" style="color:'+(diff>=0?'#10b981':'#f59e0b')+'">'+totalTracked.toFixed(1)+'h</div><div class="resume-stat-lbl">Rastreado</div></div>'
    +'<div class="resume-stat-box" style="border-color:'+(diff>=0?'rgba(16,185,129,.3)':'rgba(245,158,11,.3)')+'"><div class="resume-stat-val" style="color:'+(diff>=0?'#10b981':'#f59e0b')+'">'+(diff>=0?'+':'')+diff.toFixed(1)+'h</div><div class="resume-stat-lbl">'+(diff>=0?'Acima do plano':'Abaixo do plano')+'</div></div>';

  // Celebração
  var cel=document.getElementById('resume-celebration');
  if(cel)cel.style.display=diff>=0?'block':'none';

  // Lista de OSs
  renderResumeOsList(planEntries,trackedByOs,extraOsIds);
  openModal('modal-dayresume');
}

function renderResumeOsList(planEntries,trackedByOs,extraOsIds){
  var listEl=document.getElementById('resume-os-list');if(!listEl)return;
  var html='';

  planEntries.forEach(function(entry){
    var tracked=parseFloat((trackedByOs[entry.osId]||0).toFixed(2));
    var porte=osPorteFromHours(0); // buscar no S.oss
    var os=S.oss.find(function(o){return o.id===entry.osId});
    if(os)porte=osPorteFromHours(os.estimatedHours||0);
    html+=_resumeOsRowHtml(entry.osId,entry.osTitle,entry.plannedHours,tracked,porte,false);
  });

  extraOsIds.forEach(function(osId){
    var os=S.oss.find(function(o){return o.id===osId});
    var title=os?('#'+os.num+' · '+os.titulo):osId;
    var tracked=parseFloat((trackedByOs[osId]||0).toFixed(2));
    var porte=os?osPorteFromHours(os.estimatedHours||0):{key:'normal',label:'Normal',cls:'peso-badge-normal'};
    html+=_resumeOsRowHtml(osId,title,null,tracked,porte,true);
  });

  _resumeExtraEntries.forEach(function(e){
    html+=_resumeOsRowHtml(e.osId,e.osTitle,null,e.hours,{key:'rapida',label:'Manual',cls:'peso-badge-rapida'},true);
  });

  listEl.innerHTML=html||'<div style="text-align:center;padding:20px;font-size:12px;color:var(--hint)">Nenhuma OS rastreada hoje.</div>';
  updateResumeTotal();
}

function _resumeOsRowHtml(osId,title,planned,tracked,porte,isExtra){
  return'<div class="resume-os-row">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
    +'<span class="'+porte.cls+'" style="font-size:10px;padding:1px 7px;border-radius:10px">'+porte.label+'</span>'
    +'<div style="flex:1;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+title+'</div>'
    +(isExtra?'<span style="font-size:10px;color:#f59e0b">⚡ fora do plano</span>':'')
    +'</div>'
    +'<div class="resume-os-grid">'
    +'<div class="resume-cell"><div class="resume-cell-lbl">Planejado</div><div class="resume-cell-val" style="color:var(--muted)">'+(planned!=null?planned+'h':'—')+'</div></div>'
    +'<div class="resume-cell"><div class="resume-cell-lbl">Rastreado</div><div class="resume-cell-val" style="color:'+(tracked>0?'#10b981':'var(--muted)')+'">'+tracked+'h</div></div>'
    +'<div class="resume-cell" style="border:1px solid rgba(124,111,247,.3)"><div class="resume-cell-lbl">Apropriar</div>'
    +'<input class="resume-h-input" value="'+tracked+'" data-osid="'+osId+'" oninput="updateResumeTotal()"></div>'
    +'</div></div>';
}

function updateResumeTotal(){
  var inputs=document.querySelectorAll('.resume-h-input');
  var total=0;
  inputs.forEach(function(inp){total+=parseFloat(inp.value)||0});
  var el=document.getElementById('resume-total');
  if(el)el.textContent=parseFloat(total.toFixed(2))+'h';
}

function toggleResumeAddOS(){
  var panel=document.getElementById('resume-add-panel');
  if(panel)panel.style.display=panel.style.display==='none'?'block':'none';
}

function searchResumeOS(q){
  q=q.toLowerCase().trim();
  var results=document.getElementById('resume-add-results');if(!results)return;
  if(!q){results.innerHTML='';return}
  var matches=S.oss.filter(function(o){
    return(o.num&&o.num.toLowerCase().includes(q))||(o.titulo&&o.titulo.toLowerCase().includes(q));
  }).slice(0,6);
  results.innerHTML=matches.map(function(os){
    return'<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:var(--radius);font-size:12px" onclick="addResumeOS(\''+os.id+'\',\'#'+os.num+' · '+encodeURIComponent(os.titulo)+'\')" onmouseover="this.style.background=\'var(--card)\'" onmouseout="this.style.background=\'\'"><span style="font-family:var(--mono);color:var(--muted)">#'+os.num+'</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+os.titulo+'</span></div>';
  }).join('');
}

function addResumeOS(osId,encodedTitle){
  var title=decodeURIComponent(encodedTitle);
  var h=parseFloat(document.getElementById('resume-add-h').value)||1;
  _resumeExtraEntries.push({osId:osId,osTitle:title,hours:h});
  document.getElementById('resume-add-search').value='';
  document.getElementById('resume-add-results').innerHTML='';
  document.getElementById('resume-add-panel').style.display='none';
  // Re-render
  var plan=getDayPlan();var planEntries=(plan&&plan.entries)||[];
  var log=getTodayLog();
  var trackedByOs={};
  log.forEach(function(s){trackedByOs[s.osId]=(trackedByOs[s.osId]||0)+Math.round(s.duration/36)/100});
  var planOsIds=planEntries.map(function(e){return e.osId});
  var extraOsIds=Object.keys(trackedByOs).filter(function(id){return planOsIds.indexOf(id)<0&&trackedByOs[id]>=5/60});
  renderResumeOsList(planEntries,trackedByOs,extraOsIds);
}

function confirmDayResume(){
  var inputs=document.querySelectorAll('.resume-h-input');
  var entries=[];
  inputs.forEach(function(inp){
    var osId=inp.dataset.osid;
    var h=parseFloat(inp.value)||0;
    if(h>0)entries.push({osId:osId,approvedHours:h});
  });
  var resume={confirmedAt:new Date().toISOString(),entries:entries};
  localStorage.setItem(getResumeKey(),JSON.stringify(resume));
  recalcVelocityFactor();
  saveFocusState(null);
  closeModal('modal-dayresume');
  toast('Horas apropriadas — até amanhã!');
}
```

- [ ] **Step 4: Disparar modal ao salvar 4ª marcação**

Na função `salvarPonto` (L4449), após `toast(editId?'Registro atualizado':'Ponto salvo')`, adicionar:

```js
// Se a 4ª marcação foi preenchida, abrir resumo do dia
if(ms.length===4){
  var resumeKey=getResumeKey();
  var existing=null;try{existing=JSON.parse(localStorage.getItem(resumeKey))}catch(e){}
  if(!existing||!existing.confirmedAt){setTimeout(openDayResumeModal,600);}
}
```

- [ ] **Step 5: Verificar no browser**

Registrar 4 marcações de ponto e salvar. O modal de resumo deve abrir automaticamente. Confirmar que os campos mostram as OSs do plano + rastreadas. Ajustar horas, clicar "Confirmar" — dados salvos em `vs_dayresume_*`. Reabrir o ponto: o modal não deve reaparecer.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: modal Resumo do Dia com apropriação de horas, acionado pela 4ª marcação de ponto [skip netlify]"
```

---

## FASE 3 — Nova Agenda + Exportação Redmine

---

### Task 9: Evento pontual na Agenda

**Arquivos:**
- Modify: `index.html` — seção agenda HTML (L630–651), CSS + JS + novo modal `#modal-agenda-event`

**Contexto:** A agenda atual (`#screen-agenda`) exibe períodos (publicações com datas início/fim). Vamos adicionar o segundo tipo: eventos pontuais com hora de início/fim.

- [ ] **Step 1: Adicionar CSS de evento pontual**

Antes de `</style>`, inserir:

```css
/* ── EVENTO PONTUAL ── */
.agenda-event-pill{display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;background:rgba(124,111,247,.15);border:1px solid rgba(124,111,247,.3);color:#a78bfa;margin-bottom:2px;cursor:pointer;overflow:hidden;white-space:nowrap}
.agenda-event-pill .ev-time{font-family:var(--mono);font-size:9px;opacity:.8;flex-shrink:0}
.agenda-event-pill .ev-title{overflow:hidden;text-overflow:ellipsis;flex:1}
.agenda-event-pill .ev-os-tag{font-size:9px;background:rgba(124,111,247,.2);padding:1px 5px;border-radius:4px;flex-shrink:0}
.agenda-event-no-os{font-size:9px;color:var(--hint);font-style:italic}
/* toggle Período / Evento */
.agenda-type-toggle{display:flex;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:3px;margin-bottom:16px}
.agenda-type-btn{flex:1;padding:6px;font-size:12px;border:none;border-radius:6px;cursor:pointer;background:none;color:var(--muted);font-family:var(--font);transition:all .15s}
.agenda-type-btn.active{background:var(--surface);color:var(--text);font-weight:500;box-shadow:0 1px 3px rgba(0,0,0,.3)}
/* recorrência */
.recur-days-grid{display:flex;gap:4px;flex-wrap:wrap}
.recur-day-btn{width:36px;height:36px;border-radius:50%;border:1px solid var(--border2);background:none;color:var(--muted);font-size:11px;cursor:pointer;font-family:var(--font);transition:all .15s}
.recur-day-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.recur-month-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.recur-month-btn{height:30px;border-radius:4px;border:1px solid var(--border2);background:none;color:var(--muted);font-size:11px;cursor:pointer;font-family:var(--mono);transition:all .15s}
.recur-month-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
```

- [ ] **Step 2: Adicionar botão "Novo Evento" na topbar da agenda**

Na seção `screen-agenda` (L630), na barra de actions (onde está o botão de nova publicação), adicionar:

```html
<button class="btn btn-sm btn-ghost" onclick="openNewAgendaEvent()">+ Evento pontual</button>
```

- [ ] **Step 3: Adicionar modal de evento pontual**

Após o modal de resumo do dia, inserir:

```html
<!-- MODAL AGENDA: EVENTO PONTUAL -->
<div class="modal-overlay" id="modal-agenda-event" style="z-index:400">
  <div class="modal" style="max-width:500px">
    <div class="modal-title" id="agenda-event-modal-title">Novo evento pontual</div>

    <div class="form-group">
      <label class="form-label">Título</label>
      <input class="form-input" id="aev-titulo" placeholder="Ex: Reunião de alinhamento">
    </div>

    <div class="form-row" style="gap:10px">
      <div class="form-group" style="flex:1">
        <label class="form-label">Tipo de Atividade</label>
        <select class="form-input" id="aev-atividade"></select>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">OS vinculada <span style="color:var(--hint);font-size:10px">(opcional — entra na exportação Redmine)</span></label>
      <input class="form-input" id="aev-os-search" placeholder="Buscar por #número ou título..." oninput="searchEventOS(this.value)">
      <div id="aev-os-results" style="max-height:100px;overflow-y:auto;margin-top:4px"></div>
      <div id="aev-os-selected" style="display:none;margin-top:6px;font-size:12px;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;display:flex;align-items:center;justify-content:space-between">
        <span id="aev-os-selected-label"></span>
        <span style="cursor:pointer;color:var(--muted);font-size:10px" onclick="clearEventOS()">✕ remover</span>
      </div>
    </div>

    <div class="form-row" style="gap:10px">
      <div class="form-group" style="flex:1"><label class="form-label">Data</label><input type="date" class="form-input" id="aev-data"></div>
      <div class="form-group" style="flex:0 0 100px"><label class="form-label">Início</label><input type="time" class="form-input" id="aev-inicio"></div>
      <div class="form-group" style="flex:0 0 100px"><label class="form-label">Fim</label><input type="time" class="form-input" id="aev-fim"></div>
    </div>

    <div class="form-group">
      <label class="form-label">Descrição</label>
      <textarea class="form-input" id="aev-desc" rows="2" placeholder="Pauta, link, contexto..."></textarea>
    </div>

    <div class="form-group">
      <label class="form-label">Recorrência</label>
      <select class="form-input" id="aev-recur-type" onchange="onRecurTypeChange(this.value)" style="margin-bottom:10px">
        <option value="none">Não repete</option>
        <option value="weekly">Semanal</option>
        <option value="monthly">Mensal</option>
      </select>
      <div id="aev-recur-weekly" style="display:none">
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Repetir às:</div>
        <div class="recur-days-grid">
          <button type="button" class="recur-day-btn" data-day="0" onclick="toggleRecurDay(this)">Dom</button>
          <button type="button" class="recur-day-btn" data-day="1" onclick="toggleRecurDay(this)">Seg</button>
          <button type="button" class="recur-day-btn" data-day="2" onclick="toggleRecurDay(this)">Ter</button>
          <button type="button" class="recur-day-btn" data-day="3" onclick="toggleRecurDay(this)">Qua</button>
          <button type="button" class="recur-day-btn" data-day="4" onclick="toggleRecurDay(this)">Qui</button>
          <button type="button" class="recur-day-btn" data-day="5" onclick="toggleRecurDay(this)">Sex</button>
          <button type="button" class="recur-day-btn" data-day="6" onclick="toggleRecurDay(this)">Sáb</button>
        </div>
      </div>
      <div id="aev-recur-monthly" style="display:none">
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Dia do mês:</div>
        <div class="recur-month-grid" id="aev-month-grid"></div>
      </div>
    </div>

    <div id="aev-error" style="display:none;font-size:12px;color:var(--red-text);padding:8px 12px;background:var(--red-dim);border-radius:8px"></div>

    <div class="modal-footer">
      <button class="btn" onclick="closeModal('modal-agenda-event')">Cancelar</button>
      <button class="btn btn-primary" onclick="salvarAgendaEvent()">Salvar</button>
    </div>
  </div>
</div>

<!-- MODAL EDITAR OCORRÊNCIA RECORRENTE -->
<div class="modal-overlay" id="modal-recur-edit" style="z-index:500">
  <div class="modal" style="max-width:380px">
    <div class="modal-title">Editar evento recorrente</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:16px">Este é um evento recorrente. Como deseja editar?</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn" id="recur-edit-single">Só este</button>
      <button class="btn" id="recur-edit-forward">Este e os próximos</button>
      <button class="btn" id="recur-edit-all">Todos</button>
    </div>
    <div class="modal-footer" style="justify-content:flex-end">
      <button class="btn" onclick="closeModal('modal-recur-edit')">Cancelar</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Adicionar funções de evento pontual**

Após `confirmDayResume`, inserir:

```js
// ── AGENDA: EVENTOS PONTUAIS (vs_agenda_events) ───────────────────────────────
function getAgendaEvents(){try{return JSON.parse(localStorage.getItem('vs_agenda_events'))||[]}catch(e){return[]}}
function saveAgendaEvents(evs){localStorage.setItem('vs_agenda_events',JSON.stringify(evs))}

var _aevEditId=null;
var _aevSelectedOs=null;

function openNewAgendaEvent(){
  _aevEditId=null;_aevSelectedOs=null;
  document.getElementById('agenda-event-modal-title').textContent='Novo evento pontual';
  ['aev-titulo','aev-desc','aev-os-search'].forEach(function(id){var el=document.getElementById(id);if(el)el.value=''});
  document.getElementById('aev-os-results').innerHTML='';
  document.getElementById('aev-os-selected').style.display='none';
  document.getElementById('aev-recur-type').value='none';
  onRecurTypeChange('none');
  // Pre-fill data com hoje
  document.getElementById('aev-data').value=new Date().toISOString().slice(0,10);
  // Tipo de atividade
  populateEventAtividade();
  document.getElementById('aev-error').style.display='none';
  openModal('modal-agenda-event');
}

function populateEventAtividade(){
  var sel=document.getElementById('aev-atividade');if(!sel)return;
  var tipos=getTipoAtividades();
  sel.innerHTML='<option value="">Sem tipo</option>'+tipos.map(function(t){
    return'<option value="'+t.id+'">'+t.name+'</option>';
  }).join('');
}

function searchEventOS(q){
  q=(q||'').toLowerCase().trim();
  var res=document.getElementById('aev-os-results');if(!res)return;
  if(!q){res.innerHTML='';return}
  var matches=S.oss.filter(function(o){
    return(o.num&&o.num.toLowerCase().includes(q))||(o.titulo&&o.titulo.toLowerCase().includes(q));
  }).slice(0,5);
  res.innerHTML=matches.map(function(os){
    return'<div style="padding:5px 8px;cursor:pointer;font-size:12px;border-radius:var(--radius)" onclick="selectEventOS(\''+os.id+'\',\'#'+os.num+' · '+encodeURIComponent(os.titulo)+'\')" onmouseover="this.style.background=\'var(--card2)\'" onmouseout="this.style.background=\'\'"><span style="font-family:var(--mono);color:var(--muted)">#'+os.num+'</span> '+os.titulo+'</div>';
  }).join('');
}

function selectEventOS(osId,encodedTitle){
  var title=decodeURIComponent(encodedTitle);
  _aevSelectedOs={id:osId,title:title};
  document.getElementById('aev-os-search').value='';
  document.getElementById('aev-os-results').innerHTML='';
  document.getElementById('aev-os-selected-label').textContent=title;
  document.getElementById('aev-os-selected').style.display='flex';
}

function clearEventOS(){
  _aevSelectedOs=null;
  document.getElementById('aev-os-selected').style.display='none';
  document.getElementById('aev-os-selected-label').textContent='';
}

function onRecurTypeChange(v){
  document.getElementById('aev-recur-weekly').style.display=v==='weekly'?'block':'none';
  document.getElementById('aev-recur-monthly').style.display=v==='monthly'?'block':'none';
  if(v==='monthly'){
    var grid=document.getElementById('aev-month-grid');
    if(grid&&!grid.children.length){
      grid.innerHTML=Array.from({length:31},function(_,i){
        return'<button type="button" class="recur-month-btn" data-day="'+(i+1)+'" onclick="toggleRecurMonth(this)">'+(i+1)+'</button>';
      }).join('');
    }
  }
}

function toggleRecurDay(btn){btn.classList.toggle('active')}
function toggleRecurMonth(btn){btn.classList.toggle('active')}

function salvarAgendaEvent(){
  var titulo=(document.getElementById('aev-titulo').value||'').trim();
  var errEl=document.getElementById('aev-error');
  if(!titulo){errEl.style.display='block';errEl.textContent='Título é obrigatório.';return}
  errEl.style.display='none';

  var recurType=document.getElementById('aev-recur-type').value;
  var recurDays=[];
  if(recurType==='weekly'){
    document.querySelectorAll('.recur-day-btn.active').forEach(function(b){recurDays.push(parseInt(b.dataset.day))});
  }
  var recurDayOfMonth=null;
  if(recurType==='monthly'){
    var active=document.querySelector('.recur-month-btn.active');
    recurDayOfMonth=active?parseInt(active.dataset.day):null;
  }

  var ev={
    id:_aevEditId||uid(),
    title:titulo,
    activityTypeId:(document.getElementById('aev-atividade').value)||null,
    osId:_aevSelectedOs?_aevSelectedOs.id:null,
    osTitle:_aevSelectedOs?_aevSelectedOs.title:null,
    startDate:document.getElementById('aev-data').value,
    startTime:document.getElementById('aev-inicio').value,
    endTime:document.getElementById('aev-fim').value,
    description:document.getElementById('aev-desc').value,
    recurrence:{type:recurType,days:recurDays,dayOfMonth:recurDayOfMonth},
    exceptions:{},
    createdAt:new Date().toISOString()
  };

  var evs=getAgendaEvents();
  if(_aevEditId){
    var idx=evs.findIndex(function(e){return e.id===_aevEditId});
    if(idx>-1)evs[idx]=ev;else evs.push(ev);
  }else{evs.push(ev)}
  saveAgendaEvents(evs);
  closeModal('modal-agenda-event');
  renderAgenda(); // re-render da agenda existente
  toast('Evento salvo');
}
```

- [ ] **Step 5: Renderizar eventos na agenda existente**

Na função `renderAgenda` (buscar no arquivo), após renderizar os períodos, adicionar a lógica de eventos:

```js
// Adicionar eventos pontuais no dia
function getEventsForDate(dateStr){
  var evs=getAgendaEvents();
  var d=new Date(dateStr+'T00:00:00');
  return evs.filter(function(ev){
    if(ev.exceptions&&ev.exceptions[dateStr]===null)return false; // cancelado
    var override=ev.exceptions&&ev.exceptions[dateStr];
    var evDate=(override&&override.startDate)||ev.startDate;
    if(ev.recurrence&&ev.recurrence.type==='weekly'){
      return ev.recurrence.days.indexOf(d.getDay())>-1&&ev.startDate<=dateStr;
    }
    if(ev.recurrence&&ev.recurrence.type==='monthly'){
      return ev.recurrence.dayOfMonth===d.getDate()&&ev.startDate<=dateStr;
    }
    return evDate===dateStr;
  });
}
```

Ao construir o HTML de cada célula do grid de agenda, após os pills de período, adicionar:

```js
var events=getEventsForDate(dateStr);
var eventHtml=events.map(function(ev){
  var label=(ev.startTime||'')+' '+ev.title;
  var osTag=ev.osId?'<span class="ev-os-tag">#'+((S.oss.find(function(o){return o.id===ev.osId})||{}).num||'OS')+'</span>':'';
  return'<div class="agenda-event-pill" onclick="openEditAgendaEvent(\''+ev.id+'\',\''+dateStr+'\')" title="'+ev.title+'">'
    +'<span class="ev-time">'+(ev.startTime||'')+'</span>'
    +'<span class="ev-title">'+ev.title+'</span>'
    +osTag+'</div>';
}).join('');
```

- [ ] **Step 6: Verificar no browser**

Ir para Agenda. Botão "Evento pontual" deve aparecer. Clicar → modal abre. Preencher título, hora, selecionar OS. Salvar → evento deve aparecer no dia correto da grid. Clicar no evento → modal de edição deve abrir.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: eventos pontuais na agenda com recorrência semanal e mensal [skip netlify]"
```

---

### Task 10: Exportação Redmine (CSV + preview)

**Arquivos:**
- Modify: `index.html` — novo modal `#modal-export-redmine` + botão de exportação

- [ ] **Step 1: Adicionar CSS do modal de exportação**

Antes de `</style>`, inserir:

```css
/* ── EXPORT REDMINE ── */
.export-preview-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border);font-size:12px}
.export-preview-row:last-child{border-bottom:none}
.export-preview-row.row-os{background:rgba(16,185,129,.04)}
.export-preview-row.row-event{background:rgba(124,111,247,.04)}
.export-preview-row.row-noos{opacity:.4;text-decoration:line-through}
.export-col{font-family:var(--mono);color:var(--muted);font-size:11px;flex-shrink:0}
.export-row-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
```

- [ ] **Step 2: Adicionar botão de exportação**

Na tela de Preferências → aba Integrações → seção Redmine, e também no modal de Resumo do Dia (footer), adicionar botão:

```html
<button class="btn btn-sm" onclick="openExportRedmine()">📤 Exportar para Redmine</button>
```

- [ ] **Step 3: Adicionar modal de exportação**

Após o modal de edição de recorrência, inserir:

```html
<!-- MODAL EXPORTAÇÃO REDMINE -->
<div class="modal-overlay" id="modal-export-redmine" style="z-index:400">
  <div class="modal" style="max-width:640px;max-height:90vh;overflow-y:auto">
    <div class="modal-title">Exportação para Redmine</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <input type="date" class="form-input" id="export-data" style="width:160px">
      <button class="btn btn-sm" onclick="buildExportPreview()">Atualizar</button>
      <span style="font-size:11px;color:var(--hint);margin-left:auto">
        <span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;margin-right:4px"></span>Horas OS
        <span style="width:8px;height:8px;border-radius:50%;background:#a78bfa;display:inline-block;margin-left:10px;margin-right:4px"></span>Evento com OS
        <span style="font-size:10px;color:var(--hint);margin-left:10px">riscado = sem OS (não exportado)</span>
      </span>
    </div>
    <div id="export-preview" style="background:var(--card2);border:1px solid var(--border);border-radius:8px;overflow:hidden"></div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
      <button class="btn" onclick="closeModal('modal-export-redmine')">Fechar</button>
      <button class="btn btn-primary" onclick="downloadExportCSV()">⬇ Baixar CSV</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Adicionar funções de exportação**

Após `salvarAgendaEvent` (Task 9), inserir:

```js
// ── EXPORTAÇÃO REDMINE ────────────────────────────────────────────────────────
var _exportRows=[];

function openExportRedmine(){
  var today=new Date().toISOString().slice(0,10);
  document.getElementById('export-data').value=today;
  buildExportPreview();
  openModal('modal-export-redmine');
}

function buildExportPreview(){
  var dateStr=document.getElementById('export-data').value||new Date().toISOString().slice(0,10);
  _exportRows=[];

  // 1. Horas de OS do resumo do dia
  var resumeKey='vs_dayresume_'+dateStr;
  var resume=null;try{resume=JSON.parse(localStorage.getItem(resumeKey))}catch(e){}
  if(resume&&Array.isArray(resume.entries)){
    resume.entries.forEach(function(e){
      var os=S.oss.find(function(o){return o.id===e.osId});
      if(!os||!e.approvedHours)return;
      var tipoId=os.activityTypeId||null;
      var tipos=getTipoAtividades();
      var tipoLabel=tipoId?(tipos.find(function(t){return t.id===tipoId})||{name:''}).name:'';
      _exportRows.push({type:'os',osNum:os.num,date:dateStr,hours:e.approvedHours,activity:tipoLabel});
    });
  }

  // 2. Eventos pontuais do dia com OS vinculada
  getEventsForDate(dateStr).forEach(function(ev){
    var start=ev.startTime,end=ev.endTime;
    var dur=0;
    if(start&&end){
      dur=parseFloat(((toMin(end)-toMin(start))/60).toFixed(2));
    }
    var tipos=getTipoAtividades();
    var tipoLabel=ev.activityTypeId?(tipos.find(function(t){return t.id===ev.activityTypeId})||{name:''}).name:'';
    _exportRows.push({type:ev.osId?'event':'noos',osNum:ev.osId?(S.oss.find(function(o){return o.id===ev.osId})||{}).num||'?':null,date:dateStr,hours:dur,activity:tipoLabel,eventTitle:ev.title});
  });

  // Render preview
  var previewEl=document.getElementById('export-preview');
  if(!previewEl)return;
  if(_exportRows.length===0){
    previewEl.innerHTML='<div style="padding:20px;text-align:center;font-size:12px;color:var(--hint)">Nenhum dado para exportar nesta data.</div>';
    return;
  }
  // Header
  var html='<div class="export-preview-row" style="background:var(--surface);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.5px">'
    +'<div style="width:8px"></div>'
    +'<div style="flex:0 0 80px">OS</div>'
    +'<div style="flex:0 0 90px">Data</div>'
    +'<div style="flex:0 0 60px">Horas</div>'
    +'<div style="flex:1">Atividade</div>'
    +'</div>';
  _exportRows.forEach(function(row){
    var dotColor=row.type==='os'?'#10b981':row.type==='event'?'#a78bfa':'#4b5563';
    html+='<div class="export-preview-row row-'+row.type+'">'
      +'<div class="export-row-dot" style="background:'+dotColor+'"></div>'
      +'<div class="export-col" style="flex:0 0 80px">'+(row.osNum||'—')+'</div>'
      +'<div class="export-col" style="flex:0 0 90px">'+row.date+'</div>'
      +'<div class="export-col" style="flex:0 0 60px">'+row.hours+'h</div>'
      +'<div style="flex:1;font-size:11px;color:var(--text)">'+(row.activity||row.eventTitle||'')+'</div>'
      +'</div>';
  });
  previewEl.innerHTML=html;
}

function downloadExportCSV(){
  var exportable=_exportRows.filter(function(r){return r.type!=='noos'});
  if(!exportable.length){toast('Nenhuma linha para exportar','err');return}
  var lines=['Numero OS;Data;Tempo;Atividade'];
  exportable.forEach(function(r){
    lines.push([r.osNum||'',r.date,r.hours+'h',r.activity||''].join(';'));
  });
  var blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  a.download='redmine_horas_'+(_exportRows[0]&&_exportRows[0].date||'').replace(/-/g,'')+'.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV baixado');
}
```

- [ ] **Step 5: Verificar no browser**

Criar uma OS, fazer planejamento e confirmar resumo do dia com horas apropriadas. Adicionar um evento pontual com OS vinculada. Clicar "Exportar para Redmine". Preview deve mostrar linhas verdes (OS) e roxas (evento). Clicar "Baixar CSV" — arquivo deve fazer download com o formato correto (`Numero OS;Data;Tempo;Atividade`).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: exportação Redmine CSV com preview — OS rastreadas + eventos com OS vinculada [skip netlify]"
```

---

## Self-Review

### Cobertura do spec

| Spec | Task |
|------|------|
| vs_schedule nas preferências | Task 1 |
| Sino na topbar (3 estados, badge, dropdown) | Task 2 |
| 5 alertas temporais via setInterval | Task 3 |
| Remover Entregas Aplicáveis + slider de estimativa | Task 4 |
| osSize baseado em horas | Task 4 |
| vs_velocity_factor calculado | Task 5 |
| Modal Planejamento do Dia | Task 5 |
| Modal abre no login | Task 5 |
| Pill de foco na topbar (3 estados) | Task 6 |
| Timer timestamp-based, dropdown troca OS | Task 6 |
| WIP Limit no Kanban | Task 7 |
| Modal Resumo do Dia (4ª marcação) | Task 8 |
| OSs fora do plano auto-incluídas (>5min) | Task 8 |
| Adicionar OS manualmente no resumo | Task 8 |
| Confirmar e apropriar → recalc velocity | Task 8 |
| Evento pontual na agenda | Task 9 |
| Recorrência semanal e mensal | Task 9 |
| Exportação CSV Redmine | Task 10 |
| Preview com linhas verdes/roxas/riscadas | Task 10 |

### Consistência de tipos

- `osPorteFromHours(h)` retorna `{key, label, cls}` — usado em Tasks 4, 6, 7, 8
- `getSchedule()` retorna `{entrada, almoco, retorno, saida, cargaDiaria, wipLimit}` — usado em Tasks 1, 3, 5, 7
- `getDayPlan()` retorna `{createdAt, confirmedAt, entries:[{osId,osTitle,plannedHours,...}]}` — usado em Tasks 5, 6, 8
- `getFocusState()` retorna `{osId, startedAt, pausedAt, accumulated}` — usado em Tasks 6, 8
- `getAgendaEvents()` retorna array de `{id, title, activityTypeId, osId, osTitle, startDate, startTime, endTime, recurrence, exceptions}` — usado em Tasks 9, 10
- `toMin(hhmm)` já existe no arquivo (ex: L1616) — usado em Tasks 3, 10
- `getTipoAtividades()` já existe no arquivo (L4538) — usado em Tasks 9, 10

### Sem placeholders

Todas as tasks têm código completo, comandos exatos e verificações manuais definidas.
