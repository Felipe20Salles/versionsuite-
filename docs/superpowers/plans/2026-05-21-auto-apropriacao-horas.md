# Auto-Apropriação de Horas no Foco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao mover um card para "Concluído", as horas do timer de foco daquele dia são automaticamente apropriadas, integrando-se ao fluxo do Resumo do Dia e exportação Redmine.

**Architecture:** Toda lógica vive em `index.html` (app de arquivo único). A função `concludeOS()` recebe auto-apropriação inline: calcula segundos acumulados, cria/atualiza o ponto do dia no Supabase via `dbSalvarPonto()`, grava `vs_dayresume_<hoje>` com flag `auto:true`, limpa o log da OS e exibe um toast com botão Desfazer. As funções `confirmDayResume()` e `renderResumeOsList()` são ajustadas para preservar e exibir entradas auto-apropriadas separadamente.

**Tech Stack:** Vanilla JS, Supabase JS SDK, localStorage

---

## File Map

| Arquivo | Alteração |
|---|---|
| `index.html` (global vars) | Adicionar `var APROP_MIN_SECONDS = 300` e `var _undoAprop = null` |
| `index.html` → `concludeOS()` ~linha 5510 | Inserir lógica de auto-apropriação antes do `moveOS()` |
| `index.html` → `moveOS()` ~linha 4723 | Limpar log quando OS volta para 'andamento' de 'concluido' |
| `index.html` → `renderResumeOsList()` ~linha 5104 | Badge somente leitura para entradas auto-apropriadas |
| `index.html` → `_resumeOsRowHtml()` ~linha 5127 | Novo parâmetro `isAuto` para renderizar linha somente leitura |
| `index.html` → `confirmDayResume()` ~linha 5204 | Mesclar entradas `auto:true` com as manuais |

---

### Task 1: Constante e helpers de dayresume

**Files:**
- Modify: `index.html` (global vars ~linha 1866, próximo de `var _resumeExtraEntries`)

- [ ] **Step 1: Adicionar constante e estado de undo após a declaração de `_resumeExtraEntries`**

Localizar linha 5073:
```
var _resumeExtraEntries=[];
```
Inserir logo abaixo:
```javascript
var _undoAprop=null;
var APROP_MIN_SECONDS=300;
```

- [ ] **Step 2: Adicionar helpers de dayresume logo após `getResumeKey()` (~linha 5075)**

Localizar a linha:
```
function getResumeKey(){return'vs_dayresume_'+new Date().toISOString().slice(0,10)}
```
Inserir logo abaixo:
```javascript
function getDayResume(){var k=getResumeKey();try{return JSON.parse(localStorage.getItem(k))||{entries:[]}}catch(e){return{entries:[]}}}
function saveDayResume(r){localStorage.setItem(getResumeKey(),JSON.stringify(r))}
```

- [ ] **Step 3: Verificar no browser que o app ainda carrega sem erros de console**

Abrir `index.html` no browser → F12 → Console: nenhum erro novo.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\costa\OneDrive\Documentos\GitHub\versionsuite-"
git add index.html
git commit -m "feat: constante APROP_MIN_SECONDS e helpers getDayResume/saveDayResume"
```

---

### Task 2: Auto-apropriação em `concludeOS()`

**Files:**
- Modify: `index.html` → `concludeOS()` ~linha 5510

Esta é a função existente a modificar:
```javascript
function concludeOS(osId){
  var st=getFocusState();
  if(st&&st.osId===osId&&!st.pausedAt)closeFocusSession(st);
  saveFocusState(null);
  moveOS(osId,'concluido');
  // Auto-switch: próxima OS em andamento (a fila do dia)
  var nxt=S.oss.find(function(o){return o.id!==osId&&o.status==='andamento';});
  if(nxt)startFocus(nxt.id);
  updateFocusUI();
  renderKanban();
  closeFocoDropdown();
}
```

- [ ] **Step 1: Substituir `concludeOS()` pela versão com auto-apropriação**

Substituir o corpo completo da função `concludeOS` (localizar pelo texto exato acima) pela versão abaixo:

```javascript
function concludeOS(osId){
  var st=getFocusState();
  if(st&&st.osId===osId&&!st.pausedAt)closeFocusSession(st);
  saveFocusState(null);
  var totalSeg=focusAccumulatedToday(osId);
  if(totalSeg>=APROP_MIN_SECONDS){
    _autoApropriar(osId,totalSeg);
  }else{
    moveOS(osId,'concluido');
  }
  // Auto-switch: próxima OS em andamento (a fila do dia)
  var nxt=S.oss.find(function(o){return o.id!==osId&&o.status==='andamento';});
  if(nxt)startFocus(nxt.id);
  updateFocusUI();
  renderKanban();
  closeFocoDropdown();
}
```

- [ ] **Step 2: Adicionar função `_autoApropriar()` imediatamente após `concludeOS()`**

```javascript
function _autoApropriar(osId,totalSeg){
  var horas=parseFloat((totalSeg/3600).toFixed(2));
  var hoje=new Date().toISOString().slice(0,10);
  var diaSem=DIAS_SEMANA[new Date().getDay()];
  var versaoId=S.versaoK||(S.versoes[0]&&S.versoes[0].id)||null;

  // Snapshot do log para possível undo
  var logSnap=getTodayLog().filter(function(s){return s.osId===osId});

  // Encontra ou cria ponto de hoje em S.pontos
  var ponto=S.pontos.find(function(p){return p.data===hoje});
  var isNovo=!ponto;
  if(isNovo){
    ponto={id:uid(),data:hoje,dia:diaSem,marcacoes:'',horasTrabalhadas:0,versaoId:versaoId,apropriacoes:[]};
    S.pontos.push(ponto);
  }

  // Soma horas na entrada de apropriacoes
  var aprop=ponto.apropriacoes.find(function(a){return a.osId===osId});
  if(aprop){aprop.horas=parseFloat((aprop.horas+horas).toFixed(2));}
  else{ponto.apropriacoes.push({osId:osId,horas:horas});}

  // Grava entrada auto no dayresume ANTES de limpar o log
  var dr=getDayResume();
  dr.entries=dr.entries.filter(function(e){return e.osId!==osId||!e.auto});
  dr.entries.push({osId:osId,approvedHours:horas,auto:true});
  saveDayResume(dr);

  // Limpa log da OS antes de mover (snapshot já salvo acima)
  var logFull=getTodayLog().filter(function(s){return s.osId!==osId});
  saveTodayLog(logFull);

  // Persiste ponto no Supabase
  dbSalvarPonto(ponto).then(function(saved){
    if(isNovo)ponto.id=saved.id;
  }).catch(function(e){toast('Erro ao apropriar: '+e.message,'err')});

  // Move OS
  moveOS(osId,'concluido');

  // Prepara undo state
  if(_undoAprop&&_undoAprop.timeoutId)clearTimeout(_undoAprop.timeoutId);
  var os=S.oss.find(function(o){return o.id===osId});
  var osNum=os?os.num:osId;
  var tid=setTimeout(function(){_undoAprop=null;},5000);
  _undoAprop={osId:osId,horas:horas,pontoRef:ponto,logSnapshot:logSnap,timeoutId:tid};

  // Toast com botão Desfazer
  var el=document.getElementById('toast');
  el.innerHTML=parseFloat(horas.toFixed(2))+'h apropriadas — OS #'+osNum+' &nbsp;<button onclick="_desfazerAprop()" style="background:none;border:1px solid rgba(255,255,255,.3);color:inherit;border-radius:4px;padding:1px 8px;cursor:pointer;font-size:11px">Desfazer</button>';
  el.className='toast show';
  clearTimeout(el._t);
  el._t=setTimeout(function(){el.classList.remove('show')},5000);
}
```

- [ ] **Step 3: Adicionar função `_desfazerAprop()` logo após `_autoApropriar()`**

```javascript
function _desfazerAprop(){
  if(!_undoAprop)return;
  clearTimeout(_undoAprop.timeoutId);
  var u=_undoAprop;_undoAprop=null;

  // Remove ou subtrai da entrada de apropriacoes no ponto
  var ponto=u.pontoRef;
  var idx=ponto.apropriacoes.findIndex(function(a){return a.osId===u.osId});
  if(idx>=0){
    var novasH=parseFloat((ponto.apropriacoes[idx].horas-u.horas).toFixed(2));
    if(novasH<=0)ponto.apropriacoes.splice(idx,1);
    else ponto.apropriacoes[idx].horas=novasH;
  }
  dbSalvarApropriacao(ponto.id,ponto.apropriacoes).catch(function(){});

  // Remove entrada auto do dayresume
  var dr=getDayResume();
  dr.entries=dr.entries.filter(function(e){return e.osId!==u.osId||!e.auto});
  saveDayResume(dr);

  // Restaura log
  var logFull=getTodayLog();
  logFull=logFull.concat(u.logSnapshot);
  saveTodayLog(logFull);

  // Move OS de volta para andamento e reinicia foco
  moveOS(u.osId,'andamento');
  startFocus(u.osId);

  // Fecha toast
  document.getElementById('toast').classList.remove('show');
}
```

- [ ] **Step 4: Testar no browser**

1. Abrir o app, colocar uma OS em foco por pelo menos 5 minutos simulados (ou temporariamente mudar `APROP_MIN_SECONDS=10` para testar com 10 segundos)
2. Mover card para Concluído → toast deve aparecer com "Xh apropriadas — OS #N [Desfazer]"
3. Clicar Desfazer dentro de 5s → OS volta para andamento, foco reinicia, toast fecha
4. Mover novamente para Concluído → aguardar 5s → undo não funciona mais (botão some)
5. Verificar no modal Resumo do Dia que a OS aparece

- [ ] **Step 5: Restaurar `APROP_MIN_SECONDS=300` se alterado para teste**

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: auto-apropriação ao concluir OS com toast + undo"
```

---

### Task 3: Limpar timer ao retornar OS para "Em andamento"

**Files:**
- Modify: `index.html` → `moveOS()` ~linha 4723

Função atual relevante:
```javascript
function moveOS(osId,newStatus){
  var os=S.oss.find(function(o){return o.id===osId});if(!os)return;
  if(newStatus==='andamento'){
    var wip=getSchedule().wipLimit||5;
    var count=S.oss.filter(function(o){return o.status==='andamento'&&o.id!==osId;}).length;
    if(count>=wip){toast('WIP limit atingido ('+wip+'). Conclua ou mova uma OS antes.','err');return;}
    if(!getFocusState())setTimeout(function(){startFocus(osId);},80);
  }
  // Se a OS focal sai de "andamento", transfere foco para próxima em andamento
  if(newStatus!=='andamento'){
```

- [ ] **Step 1: Inserir limpeza de log dentro do bloco `if(newStatus==='andamento')`**

Localizar o bloco `if(newStatus==='andamento'){` dentro de `moveOS` e adicionar a verificação de origem concluída:

```javascript
function moveOS(osId,newStatus){
  var os=S.oss.find(function(o){return o.id===osId});if(!os)return;
  if(newStatus==='andamento'){
    var wip=getSchedule().wipLimit||5;
    var count=S.oss.filter(function(o){return o.status==='andamento'&&o.id!==osId;}).length;
    if(count>=wip){toast('WIP limit atingido ('+wip+'). Conclua ou mova uma OS antes.','err');return;}
    // Ao reabrir uma OS concluída, zera o timer do dia para ela
    if(os.status==='concluido'){
      var logSemOs=getTodayLog().filter(function(s){return s.osId!==osId});
      saveTodayLog(logSemOs);
    }
    if(!getFocusState())setTimeout(function(){startFocus(osId);},80);
  }
```

- [ ] **Step 2: Testar no browser**

1. Concluir uma OS (com auto-apropriação ativada)
2. Arrastar de volta para "Em andamento"
3. Foco inicia do zero (0:00)
4. Concluir novamente → novo toast com horas apenas da nova sessão (não acumuladas)

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: zera timer do dia ao retornar OS de concluido para andamento"
```

---

### Task 4: Badge "Auto-apropriado" no Resumo do Dia

**Files:**
- Modify: `index.html` → `renderResumeOsList()` ~linha 5104 e `_resumeOsRowHtml()` ~linha 5127

- [ ] **Step 1: Modificar `renderResumeOsList()` para separar OSs auto-apropriadas**

Substituir a função `renderResumeOsList` atual:

```javascript
function renderResumeOsList(planEntries,trackedByOs,extraOsIds){
  var listEl=document.getElementById('resume-os-list');if(!listEl)return;
  var dr=getDayResume();
  var autoIds=(dr.entries||[]).filter(function(e){return e.auto}).map(function(e){return e.osId});
  var html='';
  planEntries.forEach(function(entry){
    var isAuto=autoIds.indexOf(entry.osId)>=0;
    var tracked=parseFloat((trackedByOs[entry.osId]||0).toFixed(2));
    var autoEntry=isAuto?(dr.entries||[]).find(function(e){return e.osId===entry.osId&&e.auto}):null;
    var displayH=isAuto?autoEntry.approvedHours:tracked;
    var os=S.oss.find(function(o){return o.id===entry.osId});
    var porte=os?osPorteFromHours(os.estimatedHours||0):{key:'normal',label:'Normal',cls:'peso-badge-normal'};
    html+=_resumeOsRowHtml(entry.osId,escHtml(entry.osTitle),entry.plannedHours,displayH,porte,false,isAuto);
  });
  extraOsIds.forEach(function(osId){
    var isAuto=autoIds.indexOf(osId)>=0;
    var os=S.oss.find(function(o){return o.id===osId});
    var title=os?('#'+escHtml(String(os.num))+' · '+escHtml(os.titulo)):osId;
    var tracked=parseFloat((trackedByOs[osId]||0).toFixed(2));
    var autoEntry=isAuto?(dr.entries||[]).find(function(e){return e.osId===osId&&e.auto}):null;
    var displayH=isAuto?autoEntry.approvedHours:tracked;
    var porte=os?osPorteFromHours(os.estimatedHours||0):{key:'normal',label:'Normal',cls:'peso-badge-normal'};
    html+=_resumeOsRowHtml(osId,title,null,displayH,porte,!isAuto,isAuto);
  });
  _resumeExtraEntries.forEach(function(e){
    html+=_resumeOsRowHtml(e.osId,escHtml(e.osTitle),null,e.hours,{key:'rapida',label:'Manual',cls:'peso-badge-rapida'},true,false);
  });
  // Auto-apropriadas que não estão no plano nem no log rastreado
  (dr.entries||[]).filter(function(e){
    return e.auto&&autoIds.indexOf(e.osId)>=0
      &&planEntries.findIndex(function(p){return p.osId===e.osId})<0
      &&extraOsIds.indexOf(e.osId)<0;
  }).forEach(function(e){
    var os=S.oss.find(function(o){return o.id===e.osId});
    var title=os?('#'+escHtml(String(os.num))+' · '+escHtml(os.titulo)):e.osId;
    var porte=os?osPorteFromHours(os.estimatedHours||0):{key:'normal',label:'Normal',cls:'peso-badge-normal'};
    html+=_resumeOsRowHtml(e.osId,title,null,e.approvedHours,porte,true,true);
  });
  listEl.innerHTML=html||'<div style="text-align:center;padding:20px;font-size:12px;color:var(--hint)">Nenhuma OS rastreada hoje.</div>';
  updateResumeTotal();
}
```

- [ ] **Step 2: Modificar `_resumeOsRowHtml()` para aceitar parâmetro `isAuto`**

Substituir a função `_resumeOsRowHtml` atual pela versão com suporte a `isAuto`:

```javascript
function _resumeOsRowHtml(osId,title,planned,tracked,porte,isExtra,isAuto){
  var apropriarCell;
  if(isAuto){
    apropriarCell='<div class="resume-cell" style="border:1px solid rgba(16,185,129,.3)">'
      +'<div class="resume-cell-lbl">Apropriar</div>'
      +'<div class="resume-cell-val" style="color:#10b981;font-size:11px">'+tracked+'h&nbsp;'
      +'<span style="background:rgba(16,185,129,.15);color:#10b981;border-radius:4px;padding:1px 5px;font-size:10px">✓ Auto</span>'
      +'</div></div>';
  }else{
    apropriarCell='<div class="resume-cell" style="border:1px solid rgba(124,111,247,.3)"><div class="resume-cell-lbl">Apropriar</div>'
      +'<input class="resume-h-input" value="'+tracked+'" data-osid="'+osId+'" oninput="updateResumeTotal()"></div>';
  }
  return'<div class="resume-os-row">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
    +'<span class="'+porte.cls+'" style="font-size:10px;padding:1px 7px;border-radius:10px">'+porte.label+'</span>'
    +'<div style="flex:1;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+title+'</div>'
    +(isExtra&&!isAuto?'<span style="font-size:10px;color:#f59e0b">⚡ fora do plano</span>':'')
    +'</div>'
    +'<div class="resume-os-grid">'
    +'<div class="resume-cell"><div class="resume-cell-lbl">Planejado</div><div class="resume-cell-val" style="color:var(--muted)">'+(planned!=null?planned+'h':'—')+'</div></div>'
    +'<div class="resume-cell"><div class="resume-cell-lbl">Rastreado</div><div class="resume-cell-val" style="color:'+(tracked>0?'#10b981':'var(--muted)')+'">'+tracked+'h</div></div>'
    +apropriarCell
    +'</div></div>';
}
```

- [ ] **Step 3: Testar no browser**

1. Concluir uma OS com ≥ 5 min de foco → aguardar 5s (undo expirar)
2. Abrir Resumo do Dia → OS concluída deve aparecer com célula "✓ Auto" em verde
3. As demais OSs devem continuar com `<input>` editável normalmente

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: Resumo do Dia exibe OSs auto-apropriadas como somente leitura"
```

---

### Task 5: `confirmDayResume()` preserva entradas auto

**Files:**
- Modify: `index.html` → `confirmDayResume()` ~linha 5204

Função atual:
```javascript
function confirmDayResume(){
  var inputs=document.querySelectorAll('.resume-h-input');
  var entries=[];
  inputs.forEach(function(inp){
    var osId=inp.dataset.osid;var h=parseFloat(inp.value)||0;
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

- [ ] **Step 1: Substituir `confirmDayResume()` pela versão que preserva entradas auto**

```javascript
function confirmDayResume(){
  // Preserva entradas auto-apropriadas já existentes
  var drExist=getDayResume();
  var autoEntries=(drExist.entries||[]).filter(function(e){return e.auto});

  // Coleta entradas manuais dos inputs (OSs não-auto)
  var inputs=document.querySelectorAll('.resume-h-input');
  var manualEntries=[];
  inputs.forEach(function(inp){
    var osId=inp.dataset.osid;var h=parseFloat(inp.value)||0;
    if(h>0)manualEntries.push({osId:osId,approvedHours:h});
  });

  // Mescla: auto primeiro, depois manuais (sem duplicar osIds que já estão no auto)
  var autoOsIds=autoEntries.map(function(e){return e.osId});
  var mergedManual=manualEntries.filter(function(e){return autoOsIds.indexOf(e.osId)<0});
  var entries=autoEntries.concat(mergedManual);

  var resume={confirmedAt:new Date().toISOString(),entries:entries};
  localStorage.setItem(getResumeKey(),JSON.stringify(resume));
  recalcVelocityFactor();
  saveFocusState(null);
  closeModal('modal-dayresume');
  toast('Horas apropriadas — até amanhã!');
}
```

- [ ] **Step 2: Testar no browser — fluxo completo**

1. Concluir uma OS com ≥ 5 min de foco, aguardar 5s
2. Abrir Resumo do Dia — OS concluída mostra "✓ Auto"
3. Adicionar horas manuais em outra OS via input
4. Clicar "Confirmar e Apropriar"
5. Verificar `localStorage.getItem('vs_dayresume_<hoje>')` no console:
   - Entrada da OS concluída deve ter `"auto":true`
   - Entrada manual deve existir sem `auto`
6. Abrir Preview de Exportação Redmine → ambas as OSs devem aparecer no payload

- [ ] **Step 3: Testar `buildExportPreview()` — sem modificação necessária**

Verificar que `buildExportPreview()` já lê `vs_dayresume_<hoje>` e inclui as horas auto no preview do Redmine. Nenhuma mudança necessária nela.

- [ ] **Step 4: Commit final**

```bash
git add index.html
git commit -m "feat: confirmDayResume preserva entradas auto-apropriadas ao confirmar"
```

---

## Critérios de aceite — checklist final

- [ ] Concluir OS com ≥ 5 min → toast "Xh apropriadas — OS #N [Desfazer]" (5 segundos)
- [ ] Concluir OS com < 5 min → nenhum toast de apropriação, fluxo normal
- [ ] Clicar Desfazer dentro de 5s → OS volta para "Em andamento", foco reinicia, log restaurado
- [ ] OS voltando para "Em andamento" (manualmente, não pelo undo) → timer zera
- [ ] Ponto criado automaticamente se não existir para hoje (`horasTrabalhadas=0`)
- [ ] Horas somadas (não substituídas) se OS já tinha apropriação no ponto do dia
- [ ] Resumo do Dia → OS auto-apropriada exibe "✓ Auto" em verde, sem input editável
- [ ] `confirmDayResume()` preserva `auto:true` no `vs_dayresume_<hoje>`
- [ ] `buildExportPreview()` inclui horas auto no payload Redmine (sem mudança de código)
