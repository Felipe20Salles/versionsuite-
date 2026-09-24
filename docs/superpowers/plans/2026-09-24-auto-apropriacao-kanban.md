# Auto-apropriação de horas ao mover OS no Kanban — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a auto-apropriação de horas do timer de foco valer em qualquer caminho que tire uma OS de `'andamento'` (botões do card, dropdown de foco, checklist de entregas), tanto pra `'concluido'` quanto pra `'afazer'`, corrigindo também a perda de sessão de foco quando não há próxima OS pra assumir o foco.

**Architecture:** Uma função central `_finalizarAndamento(osId,newStatus)` encapsula "fechar a sessão de foco corrente, decidir se apropria, mover o status, transferir o foco pra próxima OS". `moveOS`, `concludeOS` e `toggleE` passam a delegar pra ela em vez de terem lógica própria e divergente. `_autoApropriar` ganha um parâmetro `newStatus` e chama `_doMoveOS` diretamente (nunca `moveOS`, pra não reentrar em `_finalizarAndamento` e apropriar em duplicidade).

**Tech Stack:** Vanilla JS embutido em `index.html` (sem framework, sem bundler, sem suíte de testes automatizada). Verificação: `node --check` nos blocos `<script>` (sintaxe) + Playwright MCP contra o app servido em `http://localhost:8080` (funcional, via `browser_evaluate` chamando as funções globais direto — é assim que as features anteriores desta sessão foram validadas, na ausência de test runner no projeto).

**Spec:** `docs/superpowers/specs/2026-09-24-auto-apropriacao-kanban-design.md`

## Global Constraints

- Tudo em `index.html`. Nenhum arquivo novo, nenhuma migração de banco.
- Limiar mínimo pra apropriar automaticamente: `APROP_MIN_SECONDS` (300s / 5min) — já existe em `index.html:6523`, não mudar o valor.
- `_autoApropriar` nunca chama `moveOS` (só `_doMoveOS`) — reentrância em `_finalizarAndamento` duplicaria a apropriação.
- `toggleE` não pode setar `os.status='concluido'` em memória antes de chamar `_finalizarAndamento` quando o fechamento vem de `'andamento'` — `_doMoveOS` (chamado de dentro de `_finalizarAndamento`/`_autoApropriar`) é o único lugar que escreve `os.status`.
- Cada task termina com `node --check` limpo nos scripts inline e, a partir da Task 3 (primeiro ponto em que há um fluxo ponta-a-ponta chamável), uma verificação funcional via Playwright contra o app local.

---

### Task 1: Generalizar `_autoApropriar` para aceitar o status de destino

**Files:**
- Modify: `index.html:7129-7182` (função `_autoApropriar`)

**Interfaces:**
- Consumes: nada de tasks anteriores (é a primeira task).
- Produces: `_autoApropriar(osId, totalSeg, newStatus)` — usada pelas Tasks 2 e 4. Continua fazendo tudo que já fazia (somar apropriação do dia, gravar entrada auto no day-resume, limpar log, toast com Desfazer, preparar `_undoAprop`), só que move pro `newStatus` recebido via `_doMoveOS` em vez de sempre `moveOS(osId,'concluido')`.

- [ ] **Step 1: Ler a função atual pra confirmar o texto exato antes de editar**

Abra `index.html` na linha 7129 e confirme que o corpo bate com:

```js
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

  // Limpa log da OS (snapshot já salvo acima)
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

  // Toast com botão Desfazer (5s)
  var el=document.getElementById('toast');
  el.innerHTML=parseFloat(horas.toFixed(2))+'h apropriadas — OS #'+osNum+'&nbsp;<button onclick="_desfazerAprop()" style="background:none;border:1px solid rgba(255,255,255,.3);color:inherit;border-radius:4px;padding:1px 8px;cursor:pointer;font-size:11px">Desfazer</button>';
  el.className='toast show';
  clearTimeout(el._t);
  el._t=setTimeout(function(){el.classList.remove('show')},5000);
}
```

Se o texto não bater exatamente (linhas podem ter deslocado), localize a função por nome e use o texto real encontrado como base do Step 2 — o que importa é a mudança descrita abaixo, não o número da linha.

- [ ] **Step 2: Editar a assinatura e a chamada de movimentação**

Trocar:
```js
function _autoApropriar(osId,totalSeg){
```
por:
```js
function _autoApropriar(osId,totalSeg,newStatus){
```

E trocar:
```js
  // Move OS
  moveOS(osId,'concluido');
```
por:
```js
  // Move OS — _doMoveOS direto, nunca moveOS: evita reentrar em
  // _finalizarAndamento (que chamaria _autoApropriar de novo e duplicaria a apropriação)
  _doMoveOS(osId,newStatus);
```

Nenhuma outra linha da função muda.

- [ ] **Step 3: Verificar sintaxe**

```bash
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const scripts=[...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
let ok=true;
scripts.forEach((s,i)=>{ try{ new Function(s); } catch(e){ ok=false; console.log('Script block',i,'ERROR:',e.message); } });
console.log(ok?'OK':'FAIL');
"
```
Esperado: `OK`. Se `FAIL`, o erro aponta o bloco `<script>` com problema de sintaxe — revise o Step 2 antes de continuar.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "refactor: _autoApropriar recebe o status de destino em vez de fixar 'concluido'"
```

---

### Task 2: Criar `_finalizarAndamento` e corrigir a perda de sessão de foco

**Files:**
- Modify: `index.html` — adicionar a função nova logo acima de `function _proxOssAndamento` (index.html:7215, ou onde ela estiver após a Task 1 — buscar pelo nome).

**Interfaces:**
- Consumes: `_autoApropriar(osId,totalSeg,newStatus)` (Task 1), `_doMoveOS(osId,newStatus)` (já existe, index.html:6094), `getFocusState()`, `closeFocusSession(st)`, `focusAccumulatedToday(osId)`, `_proxOssAndamento(excludeId)`, `startFocus(osId)`, `saveFocusState(state)`, `updateFocusUI()`, `updatePipUI()` — todas já existem no arquivo.
- Produces: `_finalizarAndamento(osId, newStatus)` — usada pelas Tasks 3, 4 e 5.

- [ ] **Step 1: Adicionar a função nova**

Localizar `function _proxOssAndamento(excludeId){` (busca por nome, deve estar perto de `index.html:7215` mas pode ter deslocado) e inserir a função nova **imediatamente antes** dela:

```js
// Chamada sempre que uma OS SAI de 'andamento' pra 'concluido' ou 'afazer',
// não importa o caminho (botão do card, dropdown de foco, ou checklist de
// entregas). Fecha a sessão de foco corrente (se essa OS estava em foco,
// commitando o tempo decorrido no log ANTES de somar), decide se há tempo
// suficiente pra apropriar automaticamente, e só depois transfere o foco
// pra próxima OS em andamento.
function _finalizarAndamento(osId,newStatus){
  var st=getFocusState();
  var eraFocal=st&&st.osId===osId;
  if(eraFocal)closeFocusSession(st);

  var totalSeg=focusAccumulatedToday(osId);
  if(totalSeg>=APROP_MIN_SECONDS){
    _autoApropriar(osId,totalSeg,newStatus);
  }else{
    _doMoveOS(osId,newStatus);
  }

  if(eraFocal){
    var next=_proxOssAndamento(osId);
    if(next){startFocus(next.id);}
    else{saveFocusState(null);updateFocusUI();updatePipUI();}
  }
}
```

- [ ] **Step 2: Verificar sintaxe**

Rodar o mesmo comando `node -e "..."` do Task 1 Step 3. Esperado: `OK`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: adiciona _finalizarAndamento, ponto central pra sair de andamento"
```

---

### Task 3: `moveOS` delega pra `_finalizarAndamento`

**Files:**
- Modify: `index.html:6070-6091` (função `moveOS`)

**Interfaces:**
- Consumes: `_finalizarAndamento(osId,newStatus)` (Task 2).
- Produces: `moveOS(osId,newStatus)` com o mesmo comportamento externo de hoje pra quem chama (nenhum `onclick` no HTML muda), mas agora aciona apropriação automática ao sair de `'andamento'`.

- [ ] **Step 1: Confirmar o texto atual**

```js
function moveOS(osId,newStatus){
  var os=S.oss.find(function(o){return o.id===osId});if(!os)return;
  if(newStatus==='andamento'){
    var wip=getSchedule().wipLimit||5;
    var count=S.oss.filter(function(o){return o.status==='andamento'&&o.id!==osId;}).length;
    if(count>=wip){toast('WIP limit atingido ('+wip+'). Conclua ou mova uma OS antes.','err');return;}
    // Ao reabrir uma OS concluída, zera o timer do dia para ela
    if(os.status==='concluido'){
      saveTodayLog(getTodayLog().filter(function(s){return s.osId!==osId}));
    }
    if(!getFocusState())setTimeout(function(){startFocus(osId);},80);
  }
  // Se a OS focal sai de "andamento", transfere foco para próxima em andamento
  if(newStatus!=='andamento'){
    var st=getFocusState();
    if(st&&st.osId===osId){
      var next=_proxOssAndamento(osId);
      if(next){startFocus(next.id);}
      else{saveFocusState(null);updateFocusUI();updatePipUI();}
    }
  }
  _doMoveOS(osId,newStatus);
}
```

- [ ] **Step 2: Substituir pelo corpo novo**

```js
function moveOS(osId,newStatus){
  var os=S.oss.find(function(o){return o.id===osId});if(!os)return;
  if(newStatus==='andamento'){
    var wip=getSchedule().wipLimit||5;
    var count=S.oss.filter(function(o){return o.status==='andamento'&&o.id!==osId;}).length;
    if(count>=wip){toast('WIP limit atingido ('+wip+'). Conclua ou mova uma OS antes.','err');return;}
    // Ao reabrir uma OS concluída, zera o timer do dia para ela
    if(os.status==='concluido'){
      saveTodayLog(getTodayLog().filter(function(s){return s.osId!==osId}));
    }
    if(!getFocusState())setTimeout(function(){startFocus(osId);},80);
    _doMoveOS(osId,newStatus);
    return;
  }
  // Saindo de 'andamento' pra 'concluido' ou 'afazer': fecha a sessão de
  // foco corretamente e tenta auto-apropriar o tempo rastreado antes de mover.
  if(os.status==='andamento'&&(newStatus==='concluido'||newStatus==='afazer')){
    _finalizarAndamento(osId,newStatus);
    return;
  }
  _doMoveOS(osId,newStatus);
}
```

Note: a checagem de WIP limit e o "reabrir zera log" continuam idênticos — só o `_doMoveOS` final desse ramo virou um `return` explícito pra não cair no código de baixo.

- [ ] **Step 3: Verificar sintaxe**

Rodar o comando `node -e "..."` de sempre. Esperado: `OK`.

- [ ] **Step 4: Verificação funcional — servir o app e validar via Playwright**

```bash
python -m http.server 8080 >/tmp/httpserver-task3.log 2>&1 &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/index.html
```
Esperado: `200`.

Navegar (`mcp__plugin_playwright_playwright__browser_navigate`) para `http://localhost:8080/index.html`, depois rodar via `mcp__plugin_playwright_playwright__browser_evaluate`:

```js
() => {
  // Estado mínimo pra exercitar moveOS sem precisar login
  S.versoes=[{id:'v1',nome:'V1',ativa:true}];
  S.versaoK='v1';
  S.oss=[{id:'osX',num:'99',titulo:'OS de teste',status:'andamento',versaoId:'v1',atribuicao:'',estimatedHours:2}];
  S.pontos=[];
  saveFocusState(null);
  saveTodayLog([]);
  // Simula 6 minutos de foco já registrados hoje pra essa OS (>=5min = limiar)
  saveTodayLog([{osId:'osX',start:Date.now()-360000,end:Date.now(),duration:360}]);
  moveOS('osX','concluido');
  var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
  return {
    statusFinal: S.oss[0].status,
    apropriacoes: ponto?ponto.apropriacoes:null,
    logRestante: getTodayLog()
  };
}
```

Esperado: `statusFinal:'concluido'`, `apropriacoes` com uma entrada `{osId:'osX',horas:0.1}` (6min=0.1h), `logRestante` vazio (log da OS limpo). Se `apropriacoes` vier `null`/vazio, o `_finalizarAndamento` não está sendo chamado — revise o Step 2.

Encerrar o servidor depois:
```bash
pkill -f "python -m http.server 8080" 2>/dev/null
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: moveOS aciona auto-apropriacao ao sair de andamento"
```

---

### Task 4: `concludeOS` vira um atalho fino

**Files:**
- Modify: `index.html:7111-7127` (função `concludeOS`)

**Interfaces:**
- Consumes: `moveOS(osId,newStatus)` (Task 3, já delega pra `_finalizarAndamento`).
- Produces: `concludeOS(osId)` com o mesmo efeito externo de hoje (chamado pelo botão "✓ Concluir OS" do dropdown de foco, index.html:7408 — esse `onclick` não muda).

- [ ] **Step 1: Confirmar o texto atual**

```js
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
  // Auto-switch: próxima OS em andamento do usuário atual
  var nxt=_proxOssAndamento(osId);
  if(nxt)startFocus(nxt.id);
  updateFocusUI();
  renderKanban();
  closeFocoDropdown();
}
```

- [ ] **Step 2: Substituir pelo corpo novo**

```js
function concludeOS(osId){
  moveOS(osId,'concluido');
  updateFocusUI();
  renderKanban();
  closeFocoDropdown();
}
```

`moveOS` agora cobre fechar a sessão, decidir a apropriação e trocar de foco pra próxima OS (via `_finalizarAndamento`) — `concludeOS` só precisa redesenhar a UI do foco/kanban e fechar o dropdown, que são efeitos colaterais de tela específicos desse botão.

- [ ] **Step 3: Verificar sintaxe**

Rodar o `node -e "..."` de sempre. Esperado: `OK`.

- [ ] **Step 4: Verificação funcional**

Repetir o servidor local (Task 3 Step 4, mesmo comando pra subir na porta 8080) e no navegador:

```js
() => {
  S.versoes=[{id:'v1',nome:'V1',ativa:true}];
  S.versaoK='v1';
  S.oss=[{id:'osY',num:'100',titulo:'OS foco',status:'andamento',versaoId:'v1',atribuicao:'',estimatedHours:2}];
  S.pontos=[];
  saveTodayLog([]);
  startFocus('osY');
  // Simula que a sessão já rodou 6 minutos
  var st=getFocusState();st.startedAt=Date.now()-360000;saveFocusState(st);
  concludeOS('osY');
  var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
  return {statusFinal:S.oss[0].status, apropriacoes:ponto?ponto.apropriacoes:null};
}
```

Esperado: `statusFinal:'concluido'`, `apropriacoes` com ~0.1h pra `osY`. Encerrar o servidor (`pkill -f "python -m http.server 8080"`).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "refactor: concludeOS delega para moveOS/_finalizarAndamento"
```

---

### Task 5: `toggleE` roteia pelo mesmo caminho ao fechar a OS

**Files:**
- Modify: `index.html:6103-6114` (função `toggleE`)

**Interfaces:**
- Consumes: `_finalizarAndamento(osId,newStatus)` (Task 2).
- Produces: `toggleE(osId,key)` com o mesmo efeito externo de hoje pra quem chama (nenhum `onclick` de checkbox de entrega muda), mas fechar a OS via última entrega marcada agora também apropria.

- [ ] **Step 1: Confirmar o texto atual**

```js
function toggleE(osId,key){
  var os=S.oss.find(function(o){return o.id===osId});
  if(!os||!os.entregas||!os.entregas[key]||!os.entregas[key].aplicavel)return;
  os.entregas[key].feito=!os.entregas[key].feito;
  if(os.entregas[key].feito&&os.status==='afazer')os.status='andamento';
  if(Object.values(os.entregas).filter(function(e){return e.aplicavel}).every(function(e){return e.feito}))os.status='concluido';
  dbToggleEntrega(osId,os.entregas).then(function(){
    return dbMoverOS(osId,os.status);
  }).then(function(){
    renderKanban();renderDash();
  }).catch(function(e){toast('Erro: '+e.message,'err')});
}
```

- [ ] **Step 2: Substituir pelo corpo novo**

```js
function toggleE(osId,key){
  var os=S.oss.find(function(o){return o.id===osId});
  if(!os||!os.entregas||!os.entregas[key]||!os.entregas[key].aplicavel)return;
  os.entregas[key].feito=!os.entregas[key].feito;
  var statusAnterior=os.status;
  if(os.entregas[key].feito&&os.status==='afazer')os.status='andamento';
  var fechaAgora=Object.values(os.entregas).filter(function(e){return e.aplicavel}).every(function(e){return e.feito});

  dbToggleEntrega(osId,os.entregas).then(function(){
    // Fechando a partir de 'andamento': não persiste o status aqui —
    // _finalizarAndamento cuida de mover (e possivelmente apropriar) depois.
    if(fechaAgora&&statusAnterior==='andamento')return;
    os.status=fechaAgora?'concluido':os.status;
    return dbMoverOS(osId,os.status);
  }).then(function(){
    if(fechaAgora&&statusAnterior==='andamento'){
      _finalizarAndamento(osId,'concluido');
      renderDash();
    }else{
      renderKanban();renderDash();
    }
  }).catch(function(e){toast('Erro: '+e.message,'err')});
}
```

`_finalizarAndamento` chama `_doMoveOS`/`_autoApropriar` internamente, que já disparam `renderKanban()` — por isso o ramo `fechaAgora` só precisa completar com `renderDash()`.

- [ ] **Step 3: Verificar sintaxe**

Rodar o `node -e "..."` de sempre. Esperado: `OK`.

- [ ] **Step 4: Verificação funcional**

Subir o servidor local de novo (mesmo comando das tasks anteriores) e no navegador:

```js
() => {
  S.versoes=[{id:'v1',nome:'V1',ativa:true}];
  S.versaoK='v1';
  S.oss=[{id:'osZ',num:'101',titulo:'OS entregas',status:'andamento',versaoId:'v1',atribuicao:'',estimatedHours:2,
    entregas:{a:{aplicavel:true,feito:false}}}];
  S.pontos=[];
  saveTodayLog([]);
  saveTodayLog([{osId:'osZ',start:Date.now()-360000,end:Date.now(),duration:360}]);
  // Stub das chamadas de rede — sem backend disponível no teste local
  window.dbToggleEntrega=function(){return Promise.resolve()};
  window.dbMoverOS=function(){return Promise.resolve()};
  return toggleE('osZ','a').then(function(){
    var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
    return {statusFinal:S.oss[0].status, apropriacoes:ponto?ponto.apropriacoes:null};
  });
}
```

Esperado: `statusFinal:'concluido'`, `apropriacoes` com ~0.1h pra `osZ`. Se o projeto não tiver `dbToggleEntrega`/`dbMoverOS` como globais (podem estar em outro escopo), ajuste o stub pra sobrescrever a referência correta antes de chamar `toggleE`. Encerrar o servidor (`pkill -f "python -m http.server 8080"`).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: toggleE roteia fechamento de OS pela auto-apropriacao unificada"
```

---

### Task 6: Roteiro completo de validação manual (spec, seção "Testes manuais")

**Files:** nenhum arquivo novo — só execução e observação.

**Interfaces:**
- Consumes: tudo das Tasks 1-5, já commitado.
- Produces: confirmação de que os 6 cenários da spec passam encadeados (não isolados por mock, como nas tasks anteriores) antes de considerar o trabalho pronto.

- [ ] **Step 1: Subir o servidor local**

```bash
python -m http.server 8080 >/tmp/httpserver-task6.log 2>&1 &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/index.html
```
Esperado: `200`.

- [ ] **Step 2: Entrar como visitante e preparar estado de teste**

Login como visitante (nome livre, senha `visita2024` — é a senha padrão hardcoded em `getVisitorPass`/`localStorage.getItem('vs_visitor_pass')||'visita2024'`) via `browser_navigate` + `browser_fill_form` + `browser_click`, igual feito nas sessões anteriores deste mesmo plano de trabalho. Depois, via `browser_evaluate`:

```js
() => {
  S.versoes=[{id:'v1',nome:'V1',ativa:true}];
  S.versaoK='v1';
  S.oss=[{id:'os1',num:'201',titulo:'Cenario 1',status:'andamento',versaoId:'v1',atribuicao:'',estimatedHours:2}];
  S.pontos=[];
  saveFocusState(null);
  saveTodayLog([]);
  return 'ok';
}
```

- [ ] **Step 3: Cenário 1 — concluir pelo card com ≥5min rastreados**

```js
() => {
  saveTodayLog([{osId:'os1',start:Date.now()-360000,end:Date.now(),duration:360}]);
  moveOS('os1','concluido');
  var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
  return {status:S.oss[0].status, aprop:ponto&&ponto.apropriacoes};
}
```
Esperado: `status:'concluido'`, `aprop` com ~0.1h. Confere item 1 da spec.

- [ ] **Step 4: Cenário 2 — voltar pra 'a fazer' com ≥5min rastreados**

```js
() => {
  S.oss[0].status='andamento';
  S.pontos=[];
  saveTodayLog([{osId:'os1',start:Date.now()-360000,end:Date.now(),duration:360}]);
  moveOS('os1','afazer');
  var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
  return {status:S.oss[0].status, aprop:ponto&&ponto.apropriacoes};
}
```
Esperado: `status:'afazer'`, `aprop` com ~0.1h. Confere item 2.

- [ ] **Step 5: Cenário 3 — única OS em foco, sem próxima, concluindo pelo card**

```js
() => {
  S.oss[0].status='andamento';
  S.pontos=[];
  saveTodayLog([]);
  startFocus('os1');
  var st=getFocusState();st.startedAt=Date.now()-360000;saveFocusState(st);
  moveOS('os1','concluido');
  var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
  return {status:S.oss[0].status, aprop:ponto&&ponto.apropriacoes, focusState:getFocusState()};
}
```
Esperado: `status:'concluido'`, `aprop` com ~0.1h (a sessão ao vivo foi commitada, não perdida), `focusState:null` (não há próxima OS em andamento). Confere item 3 (fix do bug de `saveFocusState(null)`).

- [ ] **Step 6: Cenário 4 — fechar via checklist de entregas**

```js
() => {
  S.oss=[{id:'os1',num:'201',titulo:'Cenario 1',status:'andamento',versaoId:'v1',atribuicao:'',estimatedHours:2,
    entregas:{a:{aplicavel:true,feito:false}}}];
  S.pontos=[];
  saveTodayLog([{osId:'os1',start:Date.now()-360000,end:Date.now(),duration:360}]);
  window.dbToggleEntrega=function(){return Promise.resolve()};
  window.dbMoverOS=function(){return Promise.resolve()};
  return toggleE('os1','a').then(function(){
    var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
    return {status:S.oss[0].status, aprop:ponto&&ponto.apropriacoes};
  });
}
```
Esperado: `status:'concluido'`, `aprop` com ~0.1h. Confere item 4.

- [ ] **Step 7: Cenário 5 — reabrir e concluir de novo no mesmo dia soma, não duplica**

```js
() => {
  S.oss=[{id:'os1',num:'201',titulo:'Cenario 1',status:'andamento',versaoId:'v1',atribuicao:'',estimatedHours:2}];
  S.pontos=[];
  saveTodayLog([{osId:'os1',start:Date.now()-360000,end:Date.now(),duration:360}]);
  moveOS('os1','concluido'); // primeira apropriação: ~0.1h
  moveOS('os1','andamento'); // reabre
  saveTodayLog([{osId:'os1',start:Date.now()-360000,end:Date.now(),duration:360}]); // mais 6min
  moveOS('os1','concluido'); // segunda apropriação, mesmo dia
  var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
  return {qtdEntradas:ponto.apropriacoes.length, horas:ponto.apropriacoes[0].horas};
}
```
Esperado: `qtdEntradas:1` (mesma entrada por `osId` no dia, não duas linhas), `horas` somando as duas rodadas (~0.2h). Confere item 5.

- [ ] **Step 8: Cenário 6 — abaixo do limiar não apropria**

```js
() => {
  S.oss=[{id:'os1',num:'201',titulo:'Cenario 1',status:'andamento',versaoId:'v1',atribuicao:'',estimatedHours:2}];
  S.pontos=[];
  saveTodayLog([{osId:'os1',start:Date.now()-60000,end:Date.now(),duration:60}]); // só 1min
  moveOS('os1','concluido');
  var ponto=S.pontos.find(function(p){return p.data===new Date().toISOString().slice(0,10)});
  return {status:S.oss[0].status, temPonto:!!ponto};
}
```
Esperado: `status:'concluido'`, `temPonto:false` (nenhuma apropriação criada — 1min fica abaixo do limiar de 5min). Confere item 6.

- [ ] **Step 9: Encerrar o servidor**

```bash
pkill -f "python -m http.server 8080" 2>/dev/null
```

- [ ] **Step 10: Reportar ao usuário**

Resumir os 6 cenários e seus resultados numa mensagem curta pro usuário, sem necessidade de commit adicional (nenhum código mudou nesta task, só validação).

---

## Self-Review Notes

- **Cobertura da spec:** seções 1-5 da spec → Tasks 1-5 uma a uma; seção "Testes manuais" → Task 6 (roteiro completo, encadeado, em vez de estados isolados). Decisões de design (gatilho unificado, mesmo limiar, mesmo toast, soma por dia) são todas exercitadas pelos cenários 1, 2, 5 e 6.
- **Fora de escopo confirmado:** sessão atravessando meia-noite não tem task — é explicitamente "fora de escopo" na spec, comportamento pré-existente de `getTodayLog`/`closeFocusSession` não tocado por nenhuma task deste plano.
- **Consistência de tipos/nomes:** `_finalizarAndamento(osId,newStatus)` (Task 2) é chamada com a mesma assinatura nas Tasks 3, 4 (indiretamente via `moveOS`) e 5. `_autoApropriar(osId,totalSeg,newStatus)` (Task 1) é chamada só de dentro de `_finalizarAndamento` (Task 2) — nenhuma outra task chama `_autoApropriar` diretamente.
