# Integração Redmine Kanban — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a importação de issues do Redmine no Kanban (GET) e sincronizar mudanças de coluna de volta ao Redmine (PUT), com badge de tipo no card e mapeamento de status configurável nas Preferências.

**Architecture:** Todas as mudanças são em `index.html` (vanilla JS inline). A comunicação com o Redmine passa pelo proxy local `redmine-proxy.js` via `_redmineFetch(cfg, path, method, body)`. Não há build system nem dependências novas.

**Tech Stack:** Vanilla JS, proxy Node.js local (`redmine-proxy.js`), localStorage para persistência de configuração.

---

## Arquivos

| Arquivo | Ação |
|---|---|
| `index.html` | Modificar — 4 tasks, todas neste arquivo |

---

## Task 1: Corrigir `importarDoRedmine()` — GET

**Files:**
- Modify: `index.html` — função `importarDoRedmine()` (linhas 4667–4716)

### Contexto

A função existe mas tem dois bugs:
1. `status:'backlog'` — coluna inexistente; cards somem do Kanban
2. Sem filtro por tipo — OS de Serviço e OS de Produto entram na lista

A query deve incluir `include=children` para termos acesso ao array `children` de cada issue (usado no filtro de tipo folha — mas filtramos apenas por tracker + parent, que é mais simples e confiável).

- [ ] **Passo 1: Substituir `importarDoRedmine()` inteira**

Localizar a função `importarDoRedmine` (linha ~4667) e substituir pelo bloco abaixo:

```javascript
async function importarDoRedmine(){
  var cfg=getRedmineConfig();
  if(!cfg.proxyUrl||!cfg.proxy){toast('Ative o proxy Redmine nas Preferências','err');return}
  var versao=S.versoes.find(function(v){return v.id===S.versaoK});
  if(!versao){toast('Selecione uma versão no Kanban primeiro','err');return}
  toast('Buscando tarefas no Redmine...');
  try{
    var r=await _redmineFetch(cfg,'/issues.json?assigned_to_id=me&status_id=open&limit=100&include=children','GET');
    if(!r.ok)throw new Error('HTTP '+r.status);
    var d=await r.json();
    var TIPOS_FILHOS=['Correção','Melhoria','Suporte','Demandas Internas'];
    var issues=(d.issues||[]).filter(function(iss){
      return TIPOS_FILHOS.indexOf(iss.tracker&&iss.tracker.name||'')>-1&&iss.parent;
    });
    if(!issues.length){toast('Nenhuma tarefa do tipo filho atribuída a você','err');return}
    var existingNums=S.oss.filter(function(o){return o.versaoId===S.versaoK}).map(function(o){return String(o.num)});
    var novas=issues.filter(function(iss){return existingNums.indexOf(String(iss.id))===-1});
    if(!novas.length){toast('Todas as tarefas já estão importadas nessa versão','err');return}
    var ok=await modalConfirm(
      'Importar do Redmine',
      '<div style="font-size:13px;margin-bottom:10px"><strong>'+novas.length+'</strong> tarefa(s) disponível(is) para importar:</div>'+
      '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border2);border-radius:var(--radius);padding:4px 0">'+
      novas.map(function(iss){
        return'<div style="font-size:12px;padding:6px 10px;border-bottom:1px solid var(--border2)">'+
          (iss.tracker?'<span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:rgba(59,130,246,.12);color:#3b82f6;margin-right:6px">'+escHtml(iss.tracker.name)+'</span>':'')+
          '<span style="color:var(--muted);font-family:var(--mono);margin-right:6px">#'+iss.id+'</span>'+
          escHtml(iss.subject)+
          (iss.parent?'<span style="color:var(--hint);font-size:11px;margin-left:6px">(Pai: #'+iss.parent.id+')</span>':'')+
        '</div>';
      }).join('')+
      '</div>',
      'Importar tudo','btn-primary'
    );
    if(!ok)return;
    var count=0;
    for(var i=0;i<novas.length;i++){
      var iss=novas[i];
      var novaOS={
        id:crypto.randomUUID(),versaoId:S.versaoK,
        num:String(iss.id),titulo:iss.subject||'',
        produto:iss.project?iss.project.name:'',
        atribuicao:iss.assigned_to?iss.assigned_to.name:'',
        obs:iss.description||'',status:'afazer',link:'',entregas:{},
        createdBy:CURRENT_USER.id,
        tipoRedmine:iss.tracker?iss.tracker.name:'',
        paiRedmine:iss.parent?String(iss.parent.id):''
      };
      await dbSalvarOS(novaOS);
      S.oss.push(novaOS);
      count++;
    }
    renderKanban();
    toast(count+' card(s) importado(s) do Redmine ✓');
  }catch(e){
    toast('Erro ao conectar ao Redmine: '+e.message,'err');
  }
}
```

- [ ] **Passo 2: Verificar no browser**

Com o proxy rodando e `REDMINE_URL`+`REDMINE_KEY` no `.env`:
1. Abrir `http://localhost:8080` → Kanban → selecionar uma versão
2. Clicar "🔴 Importar do Redmine"
3. Verificar que o modal lista apenas issues com tracker Melhoria/Correção/Suporte/Demandas Internas
4. Verificar que cada item mostra `[Tipo] #ID — Título (Pai: #ID_PAI)`
5. Confirmar importação → verificar que cards aparecem na coluna "A fazer"

Se o proxy não estiver rodando: deve aparecer toast "Ative o proxy Redmine nas Preferências".

- [ ] **Passo 3: Commit**

```
git add index.html
git commit -m "fix: importarDoRedmine filtra por tipo filho, corrige status afazer, exibe pai no modal [skip netlify]"
```

---

## Task 2: Badge de tipo no card + rename "OS" → "Card"

**Files:**
- Modify: `index.html` — função `renderKanban()` (linha ~1767 e ~1774), nova função `badgeTipoRedmine()`

### Contexto

No card do Kanban:
- Linha 1767: `'<div class="os-num">OS '+os.num+` → renomear "OS" para "Card"
- Linha 1774: badges de produto e atribuição → adicionar badge de `tipoRedmine` após produto
- Linha ~1791: texto `'Nenhuma OS'` → renomear para `'Nenhum card'`

- [ ] **Passo 1: Adicionar função `badgeTipoRedmine` antes de `renderKanban`**

Localizar a função `renderKanban` (linha ~1726) e inserir antes dela:

```javascript
function badgeTipoRedmine(tipo){
  var cores={
    'Melhoria':'background:rgba(59,130,246,.15);color:#3b82f6',
    'Correção':'background:rgba(239,68,68,.12);color:#ef4444',
    'Suporte':'background:rgba(245,158,11,.15);color:#f59e0b',
    'Demandas Internas':'background:rgba(124,111,247,.15);color:#7c6ff7'
  };
  var style=cores[tipo]||'background:var(--card2);color:var(--hint)';
  return'<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;'+style+'">'+escHtml(tipo)+'</span>';
}
```

- [ ] **Passo 2: Renomear "OS" → "Card" no número do card**

Localizar (linha ~1767):
```javascript
'<div class="os-num">OS '+os.num+
```

Substituir por:
```javascript
'<div class="os-num">Card '+os.num+
```

- [ ] **Passo 3: Adicionar badge de tipo na linha de badges**

Localizar (linha ~1774):
```javascript
          '<span class="badge '+(linha==='Gestão de Talentos'?'tag-gt':'tag-pag')+'">'+os.produto+'</span>'+
          (os.atribuicao?badgeAtribuicao(os.atribuicao):'')+
```

Substituir por:
```javascript
          '<span class="badge '+(linha==='Gestão de Talentos'?'tag-gt':'tag-pag')+'">'+os.produto+'</span>'+
          (os.tipoRedmine?badgeTipoRedmine(os.tipoRedmine):'')+
          (os.atribuicao?badgeAtribuicao(os.atribuicao):'')+
```

- [ ] **Passo 4: Renomear "Nenhuma OS" → "Nenhum card"**

Localizar (linha ~1791):
```javascript
:'<div class="empty-col">Nenhuma OS</div>';
```

Substituir por:
```javascript
:'<div class="empty-col">Nenhum card</div>';
```

- [ ] **Passo 5: Verificar no browser**

1. Abrir `http://localhost:8080` → Kanban
2. Cards existentes devem mostrar "Card 123" em vez de "OS 123"
3. Cards importados do Redmine devem mostrar badge colorido com o tipo (Melhoria=azul, Correção=vermelho, etc.)
4. Cards criados manualmente (sem `tipoRedmine`) não mostram o badge
5. Colunas vazias mostram "Nenhum card"

- [ ] **Passo 6: Commit**

```
git add index.html
git commit -m "feat: badge de tipo Redmine no card + renomeia OS para Card no Kanban [skip netlify]"
```

---

## Task 3: Mapeamento de status nas Preferências

**Files:**
- Modify: `index.html` — HTML de `pref-section-redmine` (linhas 731–753) + funções Redmine (~linha 4441)

- [ ] **Passo 1: Adicionar bloco de mapeamento no HTML do pref-section-redmine**

Localizar o fechamento de `pref-section-redmine` (linha ~753):
```html
  <div style="font-size:11px;color:var(--hint);margin-top:10px;line-height:1.6">
    Para iniciar o proxy: copie <code ...>redmine.env.example</code> para <code ...>.env</code>, preencha as variáveis e rode <code ...>node redmine-proxy.js</code>.
  </div>
</div>
```

Substituir pelo mesmo bloco + o novo trecho antes do `</div>` final:

```html
  <div style="font-size:11px;color:var(--hint);margin-top:10px;line-height:1.6">
    Para iniciar o proxy: copie <code style="background:var(--card2);padding:1px 5px;border-radius:4px">redmine.env.example</code> para <code style="background:var(--card2);padding:1px 5px;border-radius:4px">.env</code>, preencha as variáveis e rode <code style="background:var(--card2);padding:1px 5px;border-radius:4px">node redmine-proxy.js</code>.
  </div>
  <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
    <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px">Mapeamento de Status</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.5">Ao mover um card no Kanban, o status da issue no Redmine é atualizado automaticamente.</div>
    <button class="btn btn-sm btn-ghost" onclick="loadRedmineStatuses()" style="margin-bottom:12px">🔄 Carregar status disponíveis</button>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;max-width:400px">
      <label style="font-size:12px;color:var(--muted)">A fazer →</label>
      <select id="pref-redmine-status-afazer" class="form-input" style="font-size:12px;padding:4px 8px" onchange="saveRedmineStatusMapFromInputs()"><option value="">— selecione —</option></select>
      <label style="font-size:12px;color:var(--muted)">Em andamento →</label>
      <select id="pref-redmine-status-andamento" class="form-input" style="font-size:12px;padding:4px 8px" onchange="saveRedmineStatusMapFromInputs()"><option value="">— selecione —</option></select>
      <label style="font-size:12px;color:var(--muted)">Concluído →</label>
      <select id="pref-redmine-status-concluido" class="form-input" style="font-size:12px;padding:4px 8px" onchange="saveRedmineStatusMapFromInputs()"><option value="">— selecione —</option></select>
    </div>
  </div>
</div>
```

- [ ] **Passo 2: Adicionar funções de status map após `testRedmineConexao`**

Localizar o final de `testRedmineConexao` (linha ~4490) e inserir após ela:

```javascript
function getRedmineStatusMap(){
  try{return JSON.parse(localStorage.getItem('vs_redmine_status_map'))||{}}catch(e){return{}}
}
function saveRedmineStatusMap(map){localStorage.setItem('vs_redmine_status_map',JSON.stringify(map))}
function saveRedmineStatusMapFromInputs(){
  var map={};
  var sa=document.getElementById('pref-redmine-status-afazer');
  var san=document.getElementById('pref-redmine-status-andamento');
  var sc=document.getElementById('pref-redmine-status-concluido');
  if(sa&&sa.value)map.afazer=parseInt(sa.value);
  if(san&&san.value)map.andamento=parseInt(san.value);
  if(sc&&sc.value)map.concluido=parseInt(sc.value);
  saveRedmineStatusMap(map);
}
async function loadRedmineStatuses(){
  var cfg=getRedmineConfig();
  if(!cfg.proxyUrl||!cfg.proxy){toast('Ative o proxy Redmine primeiro','err');return}
  try{
    var r=await _redmineFetch(cfg,'/issue_statuses.json','GET');
    if(!r.ok)throw new Error('HTTP '+r.status);
    var d=await r.json();
    var statuses=d.issue_statuses||[];
    var map=getRedmineStatusMap();
    var opts='<option value="">— selecione —</option>'+
      statuses.map(function(s){return'<option value="'+s.id+'">'+escHtml(s.name)+'</option>'}).join('');
    ['afazer','andamento','concluido'].forEach(function(k){
      var sel=document.getElementById('pref-redmine-status-'+k);
      if(!sel)return;
      sel.innerHTML=opts;
      if(map[k])sel.value=String(map[k]);
    });
    toast('Status carregados ✓');
  }catch(e){
    toast('Erro ao carregar status: '+e.message,'err');
  }
}
```

- [ ] **Passo 3: Atualizar `renderRedmineConfig` para restaurar mapa salvo**

Localizar `renderRedmineConfig` (linha ~4458). Adicionar ao final da função (antes do fechamento `}`):

```javascript
  var map=getRedmineStatusMap();
  ['afazer','andamento','concluido'].forEach(function(k){
    var sel=document.getElementById('pref-redmine-status-'+k);
    if(sel&&map[k])sel.value=String(map[k]);
  });
```

A função completa deve ficar:

```javascript
function renderRedmineConfig(){
  var cfg=getRedmineConfig();
  var u=document.getElementById('pref-redmine-proxyurl');
  var a=document.getElementById('pref-redmine-activity');
  var p=document.getElementById('pref-redmine-proxy');
  if(u)u.value=cfg.proxyUrl||'http://localhost:3001';
  if(a)a.value=cfg.actId||'';
  if(p)p.checked=!!(cfg.proxy);
  _redmineUpdateButtons(!!(cfg.proxyUrl&&cfg.proxy));
  var map=getRedmineStatusMap();
  ['afazer','andamento','concluido'].forEach(function(k){
    var sel=document.getElementById('pref-redmine-status-'+k);
    if(sel&&map[k])sel.value=String(map[k]);
  });
}
```

- [ ] **Passo 4: Verificar no browser**

1. Abrir `http://localhost:8080` → Preferências → aba Admin → Redmine
2. Confirmar novo bloco "Mapeamento de Status" aparece abaixo do botão "Testar conexão"
3. Com proxy ativo: clicar "🔄 Carregar status disponíveis" → selects devem popular com os status do Redmine
4. Selecionar um status para cada coluna → recarregar a página → verificar que seleção persiste

- [ ] **Passo 5: Commit**

```
git add index.html
git commit -m "feat: mapeamento de status Redmine configurável nas Preferências [skip netlify]"
```

---

## Task 4: Sincronizar status ao mover card (PUT)

**Files:**
- Modify: `index.html` — nova função `sincronizarStatusRedmine()` + função `moveOS()` (linha ~1796)

- [ ] **Passo 1: Adicionar `sincronizarStatusRedmine` após `loadRedmineStatuses`**

Localizar o final de `loadRedmineStatuses` (inserida na Task 3) e adicionar logo após:

```javascript
async function sincronizarStatusRedmine(os,novoStatus){
  var cfg=getRedmineConfig();
  if(!cfg.proxy||!cfg.proxyUrl)return;
  if(!os.num||isNaN(parseInt(os.num)))return;
  var map=getRedmineStatusMap();
  var statusId=map[novoStatus];
  if(!statusId)return;
  try{
    var r=await _redmineFetch(cfg,'/issues/'+os.num+'.json','PUT',{issue:{status_id:statusId}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    toast('Redmine atualizado ✓');
  }catch(e){
    toast('Falha ao atualizar Redmine ✗','err');
  }
}
```

- [ ] **Passo 2: Atualizar `moveOS` para chamar sincronização**

Localizar (linha ~1796):
```javascript
function moveOS(osId,newStatus){var os=S.oss.find(function(o){return o.id===osId});if(!os)return;os.status=newStatus;save();renderKanban();renderDash();toast('Movido: '+statusLabel(newStatus))}
```

Substituir por:
```javascript
function moveOS(osId,newStatus){
  var os=S.oss.find(function(o){return o.id===osId});
  if(!os)return;
  os.status=newStatus;
  save();
  renderKanban();
  renderDash();
  toast('Movido: '+statusLabel(newStatus));
  sincronizarStatusRedmine(os,newStatus);
}
```

- [ ] **Passo 3: Verificar no browser**

Com proxy ativo e mapeamento configurado:
1. Abrir `http://localhost:8080` → Kanban
2. Mover um card importado do Redmine (com `num` numérico) para outra coluna
3. Deve aparecer toast "Movido: Em andamento" seguido de "Redmine atualizado ✓"
4. Verificar no Redmine que o status da issue mudou para o mapeado

Mover um card criado manualmente (sem `tipoRedmine`, `num` não numérico):
5. Deve aparecer só "Movido: Em andamento" — sem toast do Redmine (ignora silenciosamente)

- [ ] **Passo 4: Commit**

```
git add index.html
git commit -m "feat: sincroniza status Redmine ao mover card no Kanban [skip netlify]"
```

---

## Auto-revisão do plano

**Cobertura da spec:**
- ✅ Bug fix status:'backlog' → 'afazer' — Task 1
- ✅ Filtro por tipo filho (TIPOS_FILHOS + parent) — Task 1
- ✅ include=children na query — Task 1
- ✅ Modal exibe tipo, ID, título e pai — Task 1
- ✅ Feedback de erro claro — Task 1
- ✅ Campos tipoRedmine e paiRedmine na OS — Task 1
- ✅ Badge colorido por tipo no card — Task 2
- ✅ Rename "OS" → "Card" — Task 2
- ✅ Botão "Carregar status" nas Preferências — Task 3
- ✅ 3 selects de mapeamento por coluna — Task 3
- ✅ Persistência em vs_redmine_status_map — Task 3
- ✅ renderRedmineConfig restaura mapa salvo — Task 3
- ✅ sincronizarStatusRedmine (PUT) — Task 4
- ✅ moveOS chama sincronização — Task 4
- ✅ Condições de guarda (proxy ativo, num numérico, mapa configurado) — Task 4

**Consistência de nomes:**
- `getRedmineStatusMap()` / `saveRedmineStatusMap()` / `saveRedmineStatusMapFromInputs()` — consistentes em Tasks 3 e 4
- `sincronizarStatusRedmine(os, novoStatus)` — definida na Task 4, chamada em `moveOS` na mesma task
- `tipoRedmine` / `paiRedmine` — definidos na Task 1, consumidos na Task 2
