# Backlog de Projetos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o módulo "Projetos" do VersionSuite: backlog de ideias pontuadas (Valor ÷ Esforço), aprovação, e acompanhamento de projetos por um fluxo de etapas configurável, alimentado pelas OSs vinculadas.

**Architecture:** As regras puras (pontuação, transições automáticas, tempo por papel, regra C de horas) ficam num arquivo novo `projetos-core.js`, carregado pelo `index.html` como `window.ProjCore` e testado no Node com `node --test`. Os dados ficam em 5 tabelas novas no Supabase, mais 2 colunas em `oss` e 2 funções `security definer` que devolvem horas agregadas. A tela segue o padrão vanilla JS do `index.html`: estado global `PJ` e funções `pj*`/`proj*`.

**Tech Stack:** HTML/CSS/JS vanilla (ES5, `var`/`function`), Supabase (Postgres + RLS + supabase-js v2), Node 24 (`node:test`) para os testes das regras, Netlify (deploy de `main`, `publish = "."`).

**Spec:** `docs/superpowers/specs/2026-10-14-backlog-projetos-design.md`

## Global Constraints

- O app é um arquivo só (`index.html`), ES5 com `var` e `function`. Não use arrow functions, `let`/`const` nem classes no código novo do `index.html` ou do `projetos-core.js`, para combinar com o código ao redor.
- Toda tabela nova tem `workspace_id` e RLS por `is_workspace_member(workspace_id)`. Escrita no fluxo só com `is_workspace_admin(workspace_id)`.
- As migrations são **idempotentes** (`if not exists`, `drop policy if exists` antes de `create policy`), porque o usuário as roda em lote no SQL Editor.
- **O MCP do Supabase NÃO tem acesso ao banco do VersionSuite** (`lexgxlurnqbdytzzxkmv`; o MCP só vê outro projeto). O usuário roda as migrations e as queries de verificação no SQL Editor e cola o resultado.
- **Ordem de deploy:** as migrations têm de estar aplicadas em produção **antes** do push do `index.html` novo. `dbSalvarOS` passa a gravar `projeto_id`, e sem a coluna todo salvamento de OS falha.
- Teste com login real só na **porta 8080** (memória `feedback_test_port_8080`). Pergunte ao usuário como ele sobe o servidor.
- Status do projeto (valores gravados): `ideia, avaliacao, aprovada, recusada, execucao, pausada, concluida, cancelada`.
- Status da OS (já existentes): `afazer, andamento, concluido`.
- Fator de esforço: P = 1, M = 3, G = 7, GG = 15. Faixas de horas: ≤20 P, ≤80 M, ≤200 G, acima GG.
- Permissão nova: `acoes.gerir_projetos`. Menu novo: `menus.projetos`. O admin sempre tem as duas (`can()`/`canMenu()` já devolvem true para admin).
- Commits direto em `main` (padrão do repo), **sem push** até a Task 14.
- Desvios do spec, decididos ao planejar: `tipos_atividade` é `text[]` e não `int[]`, porque o `activityTypeId` da apropriação vem como string do `<select>`. `projeto_etapa_config` ganhou `workspace_id`, para a RLS ficar no mesmo padrão. Entrou uma segunda função, `projetos_horas_totais`, para o quadro mostrar as horas de todos os cartões com uma chamada só.

## Review Focus

1. **Editar uma OS pelo modal apaga `paiRedmine`, `tipoRedmine` e (agora) `projetoId`**: o `salvarOS()` atual monta o objeto do zero. Quem edita uma OS espera que o vínculo continue. Coberto na Task 7, Step 4, mais o roteiro manual.
2. **Mudança de etapa às 22h (horário local)**: em UTC, o evento cai no dia seguinte. A hora apropriada naquele dia deve contar para a etapa do **dia local**. Coberto na Task 3 (`etapaNaData` usa a data local).
3. **Id de atividade como número × string**: a etapa guarda `'9'`, e a apropriação pode trazer `9`. A hora deve cair na etapa certa. Coberto na Task 4.
4. **Duas trocas de etapa no mesmo dia**: a hora daquele dia (sem tipo de atividade) vai para a **última** etapa do dia. Coberto na Task 3.
5. **Projeto pausado com OS em andamento**: o status **não** muda sozinho, só aparece um aviso. Coberto na Task 2 (`proximoStatusAuto('pausada', ...)` devolve `null`) e no cartão (Task 10).

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `projetos-core.js` | criar | Regras puras: prioridade, ordenação, transições automáticas, vínculo pelo pai do Redmine, intervalos de etapa, tempo por papel, regra C. Sem DOM e sem Supabase. |
| `tests/projetos-core.test.js` | criar | Testes `node:test` das regras. |
| `supabase/migrations/2026-10-14_01_projetos.sql` | criar | Tabelas, colunas em `oss`, RLS, fluxo padrão (seed) e `create_workspace` com o seed. |
| `supabase/migrations/2026-10-14_02_projetos_horas.sql` | criar | Funções `projeto_horas_agregadas` e `projetos_horas_totais`. |
| `index.html` | modificar | CSS, menu, tela, modal de ideia, painel lateral, integração com a OS, editor do fluxo, permissões. |

---

### Task 1: Núcleo, parte 1: prioridade e ordenação do backlog

**Files:**
- Create: `projetos-core.js`
- Test: `tests/projetos-core.test.js`

**Interfaces:**
- Produces: `ProjCore.FATOR`, `ProjCore.tamanhoPorHoras(h) → 'P'|'M'|'G'|'GG'|null`, `ProjCore.horasEsforco(projeto, configs) → {horas:number|null, origem:'etapas'|'total'|'tamanho'|null}`, `ProjCore.calcPrioridade(projeto, configs) → {valor, horas, tamanho, fator, prioridade}`, `ProjCore.compararBacklog(a, b) → number`.
- `projeto` é uma linha de `projetos` (snake_case: `nota_impacto`, `nota_urgencia`, `nota_alinhamento`, `esforco_total_h`, `esforco_tamanho`, `legal`, `prioridade`, `criado_em`). `configs` é uma lista de linhas de `projeto_etapa_config` (`horas_estimadas`).

- [ ] **Step 1: Escrever os testes que falham**

`tests/projetos-core.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../projetos-core.js');

test('tamanhoPorHoras: faixas', () => {
  assert.equal(C.tamanhoPorHoras(0), null);
  assert.equal(C.tamanhoPorHoras(null), null);
  assert.equal(C.tamanhoPorHoras(20), 'P');
  assert.equal(C.tamanhoPorHoras(20.5), 'M');
  assert.equal(C.tamanhoPorHoras(80), 'M');
  assert.equal(C.tamanhoPorHoras(200), 'G');
  assert.equal(C.tamanhoPorHoras(201), 'GG');
});

test('horasEsforco: etapas > total > tamanho', () => {
  const p = { esforco_total_h: 30, esforco_tamanho: 'GG' };
  assert.deepEqual(C.horasEsforco(p, [{ horas_estimadas: 15 }, { horas_estimadas: '35' }]), { horas: 50, origem: 'etapas' });
  assert.deepEqual(C.horasEsforco(p, [{ horas_estimadas: 0 }]), { horas: 30, origem: 'total' });
  assert.deepEqual(C.horasEsforco({ esforco_tamanho: 'G' }, []), { horas: null, origem: 'tamanho' });
  assert.deepEqual(C.horasEsforco({}, []), { horas: null, origem: null });
});

test('calcPrioridade: valor ÷ fator com 1 casa', () => {
  const p = { nota_impacto: 5, nota_urgencia: 4, nota_alinhamento: 3, esforco_total_h: 50 };
  assert.deepEqual(C.calcPrioridade(p, []), { valor: 12, horas: 50, tamanho: 'M', fator: 3, prioridade: 4 });
  const q = { nota_impacto: 2, nota_urgencia: 2, nota_alinhamento: 1, esforco_tamanho: 'G' };
  assert.equal(C.calcPrioridade(q, []).prioridade, 0.7);
});

test('calcPrioridade: nula sem as 3 notas ou sem esforço', () => {
  assert.equal(C.calcPrioridade({ nota_impacto: 5, nota_urgencia: 5, esforco_total_h: 10 }, []).prioridade, null);
  assert.equal(C.calcPrioridade({ nota_impacto: 5, nota_urgencia: 5, nota_alinhamento: 5 }, []).prioridade, null);
  assert.equal(C.calcPrioridade({ nota_impacto: 5, nota_urgencia: 5, nota_alinhamento: 5 }, []).valor, 15);
});

test('compararBacklog: legal primeiro, depois prioridade, nulas no fim, empate por criação', () => {
  const itens = [
    { id: 'a', prioridade: 2, criado_em: '2026-01-02' },
    { id: 'b', prioridade: null, criado_em: '2026-01-01' },
    { id: 'c', prioridade: 0.5, legal: true, criado_em: '2026-01-03' },
    { id: 'd', prioridade: 5, criado_em: '2026-01-04' },
    { id: 'e', prioridade: 2, criado_em: '2026-01-01' },
  ];
  assert.deepEqual(itens.sort(C.compararBacklog).map(x => x.id), ['c', 'd', 'e', 'a', 'b']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL com `Cannot find module '../projetos-core.js'`

- [ ] **Step 3: Implementar**

`projetos-core.js`:
```js
// projetos-core.js — regras puras do Backlog de Projetos (sem DOM, sem Supabase).
// No browser vira window.ProjCore; no Node é carregado por require() nos testes.
(function(root){
  var FATOR={P:1,M:3,G:7,GG:15};

  function num(v){var n=parseFloat(v);return isNaN(n)?null:n}

  function tamanhoPorHoras(h){
    h=num(h);if(h===null||h<=0)return null;
    if(h<=20)return'P';if(h<=80)return'M';if(h<=200)return'G';return'GG';
  }

  // Ordem de preferência: soma das horas por etapa > total livre > só o tamanho
  function horasEsforco(p,configs){
    var soma=(configs||[]).reduce(function(a,c){return a+(num(c.horas_estimadas)||0)},0);
    if(soma>0)return{horas:soma,origem:'etapas'};
    var tot=num(p.esforco_total_h);
    if(tot!==null&&tot>0)return{horas:tot,origem:'total'};
    return{horas:null,origem:p.esforco_tamanho?'tamanho':null};
  }

  function calcPrioridade(p,configs){
    var notas=[p.nota_impacto,p.nota_urgencia,p.nota_alinhamento].map(num);
    var completas=notas.every(function(n){return n!==null&&n>=1&&n<=5});
    var valor=completas?notas[0]+notas[1]+notas[2]:null;
    var esf=horasEsforco(p,configs);
    var tamanho=esf.horas!==null?tamanhoPorHoras(esf.horas):(FATOR[p.esforco_tamanho]?p.esforco_tamanho:null);
    var fator=tamanho?FATOR[tamanho]:null;
    var prioridade=(valor!==null&&fator)?Math.round(valor/fator*10)/10:null;
    return{valor:valor,horas:esf.horas,tamanho:tamanho,fator:fator,prioridade:prioridade};
  }

  // Legal sempre no topo; depois prioridade (desc), sem nota no fim; empate pela criação
  function compararBacklog(a,b){
    if(!!a.legal!==!!b.legal)return a.legal?-1:1;
    var pa=a.prioridade==null?null:+a.prioridade,pb=b.prioridade==null?null:+b.prioridade;
    if(pa===null&&pb!==null)return 1;
    if(pb===null&&pa!==null)return -1;
    if(pa!==pb)return pb-pa;
    return String(a.criado_em||'').localeCompare(String(b.criado_em||''));
  }

  var api={
    FATOR:FATOR,tamanhoPorHoras:tamanhoPorHoras,horasEsforco:horasEsforco,
    calcPrioridade:calcPrioridade,compararBacklog:compararBacklog
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ProjCore=api;
})(typeof window!=='undefined'?window:this);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add projetos-core.js tests/projetos-core.test.js
git commit -m "feat(projetos): nucleo de prioridade e ordenacao do backlog"
```

---

### Task 2: Núcleo, parte 2: status automático e vínculo com a OS

**Files:**
- Modify: `projetos-core.js`
- Test: `tests/projetos-core.test.js`

**Interfaces:**
- Consumes: o módulo da Task 1.
- Produces:
  - `ProjCore.ACEITA_OS` (array) e `ProjCore.aceitaOS(status) → bool`
  - `ProjCore.primeiraEtapa(etapas, configs) → etapaId|null`. `etapas` são linhas de `projeto_etapas` (`id, ordem, ativo`); `configs` são as do projeto (`etapa_id, pulada`).
  - `ProjCore.gatilhosDaOS(antes, depois) → string[]`. `antes`/`depois` = `{projetoId, status}`, e `antes` pode ser `{}`. Gatilhos: `'os_vinculada'`, `'os_andamento'`, `'os_reaberta'`.
  - `ProjCore.proximoStatusAuto(statusProjeto, gatilho) → novoStatus|null`
  - `ProjCore.vinculoPorPai(os, projetos) → projetoId|null`. `os` = `{projetoId, projetoDesvinculado, paiRedmine}`; `projetos` = linhas de `projetos`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar ao fim de `tests/projetos-core.test.js`)

```js
test('aceitaOS', () => {
  ['aprovada', 'execucao', 'pausada', 'concluida'].forEach(s => assert.equal(C.aceitaOS(s), true));
  ['ideia', 'avaliacao', 'recusada', 'cancelada'].forEach(s => assert.equal(C.aceitaOS(s), false));
});

test('primeiraEtapa: menor ordem, ativa e não pulada', () => {
  const etapas = [
    { id: 'e3', ordem: 3 }, { id: 'e1', ordem: 1, ativo: false }, { id: 'e2', ordem: 2 }, { id: 'e4', ordem: 4 },
  ];
  assert.equal(C.primeiraEtapa(etapas, []), 'e2');
  assert.equal(C.primeiraEtapa(etapas, [{ etapa_id: 'e2', pulada: true }]), 'e3');
  assert.equal(C.primeiraEtapa([], []), null);
});

test('gatilhosDaOS', () => {
  assert.deepEqual(C.gatilhosDaOS({}, { projetoId: null, status: 'andamento' }), []);
  assert.deepEqual(C.gatilhosDaOS({}, { projetoId: 'p', status: 'afazer' }), ['os_vinculada']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'x', status: 'andamento' }, { projetoId: 'p', status: 'andamento' }), ['os_vinculada', 'os_andamento']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'p', status: 'afazer' }, { projetoId: 'p', status: 'andamento' }), ['os_andamento']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'p', status: 'concluido' }, { projetoId: 'p', status: 'afazer' }), ['os_reaberta']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'p', status: 'concluido' }, { projetoId: 'p', status: 'andamento' }), ['os_andamento', 'os_reaberta']);
  assert.deepEqual(C.gatilhosDaOS({ projetoId: 'p', status: 'andamento' }, { projetoId: 'p', status: 'concluido' }), []);
});

test('proximoStatusAuto', () => {
  assert.equal(C.proximoStatusAuto('aprovada', 'os_andamento'), 'execucao');
  assert.equal(C.proximoStatusAuto('aprovada', 'os_vinculada'), null);
  assert.equal(C.proximoStatusAuto('concluida', 'os_vinculada'), 'execucao');
  assert.equal(C.proximoStatusAuto('concluida', 'os_reaberta'), 'execucao');
  assert.equal(C.proximoStatusAuto('concluida', 'os_andamento'), null);
  // Pausada nunca sai sozinha da pausa
  assert.equal(C.proximoStatusAuto('pausada', 'os_andamento'), null);
  assert.equal(C.proximoStatusAuto('pausada', 'os_reaberta'), null);
  assert.equal(C.proximoStatusAuto('execucao', 'os_andamento'), null);
});

test('vinculoPorPai', () => {
  const projetos = [
    { id: 'p1', pai_redmine: '500', status: 'cancelada' },
    { id: 'p2', pai_redmine: '500', status: 'execucao' },
    { id: 'p3', pai_redmine: '600', status: 'ideia' },
  ];
  assert.equal(C.vinculoPorPai({ paiRedmine: '500' }, projetos), 'p2');
  assert.equal(C.vinculoPorPai({ paiRedmine: 500 }, projetos), 'p2');
  assert.equal(C.vinculoPorPai({ paiRedmine: '600' }, projetos), null);
  assert.equal(C.vinculoPorPai({ paiRedmine: '500', projetoId: 'px' }, projetos), null);
  assert.equal(C.vinculoPorPai({ paiRedmine: '500', projetoDesvinculado: true }, projetos), null);
  assert.equal(C.vinculoPorPai({ paiRedmine: '' }, projetos), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL com `C.aceitaOS is not a function`

- [ ] **Step 3: Implementar** (em `projetos-core.js`, antes de `var api=`)

```js
  var ACEITA_OS=['aprovada','execucao','pausada','concluida'];
  function aceitaOS(status){return ACEITA_OS.indexOf(status)>-1}

  function primeiraEtapa(etapas,configs){
    var puladas={};
    (configs||[]).forEach(function(c){if(c.pulada)puladas[c.etapa_id]=true});
    var ativas=(etapas||[]).filter(function(e){return e.ativo!==false&&!puladas[e.id]})
      .sort(function(a,b){return a.ordem-b.ordem});
    return ativas.length?ativas[0].id:null;
  }

  // Que mudanças na OS podem mexer no status do projeto dela
  function gatilhosDaOS(antes,depois){
    var g=[];
    if(!depois||!depois.projetoId)return g;
    var a=antes||{};
    if(a.projetoId!==depois.projetoId){
      g.push('os_vinculada');
      if(depois.status==='andamento')g.push('os_andamento');
      return g;
    }
    if(a.status!=='andamento'&&depois.status==='andamento')g.push('os_andamento');
    if(a.status==='concluido'&&depois.status!=='concluido')g.push('os_reaberta');
    return g;
  }

  function proximoStatusAuto(status,gatilho){
    if(status==='aprovada'&&gatilho==='os_andamento')return'execucao';
    if(status==='concluida'&&(gatilho==='os_vinculada'||gatilho==='os_reaberta'))return'execucao';
    return null;
  }

  // O pai do Redmine só vincula OS sem projeto e que não foi desvinculada à mão
  function vinculoPorPai(os,projetos){
    if(!os||os.projetoId||os.projetoDesvinculado||!os.paiRedmine)return null;
    var pai=String(os.paiRedmine);
    var p=(projetos||[]).find(function(x){return x.pai_redmine&&String(x.pai_redmine)===pai&&aceitaOS(x.status)});
    return p?p.id:null;
  }
```
E acrescentar ao objeto `api`:
```js
    ACEITA_OS:ACEITA_OS,aceitaOS:aceitaOS,primeiraEtapa:primeiraEtapa,
    gatilhosDaOS:gatilhosDaOS,proximoStatusAuto:proximoStatusAuto,vinculoPorPai:vinculoPorPai,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add projetos-core.js tests/projetos-core.test.js
git commit -m "feat(projetos): regras de status automatico e vinculo pelo pai do Redmine"
```

---

### Task 3: Núcleo, parte 3: intervalos de etapa e tempo por papel

**Files:**
- Modify: `projetos-core.js`
- Test: `tests/projetos-core.test.js`

**Interfaces:**
- Consumes: os módulos das Tasks 1 e 2.
- Produces:
  - `ProjCore.intervalosEtapa(eventos) → [{etapaId, papelId, inicio, fim|null, retorno:bool}]`. `eventos` são linhas de `projeto_eventos` (`tipo, de, para, papel_id, criado_em`).
  - `ProjCore.tempoPorPapel(eventos, agoraISO?) → {dias:{papelId:number}, retornos:number}`. Dias com 1 casa.
  - `ProjCore.diasNaEtapaAtual(eventos, agoraISO?) → int|null`
  - `ProjCore.dataLocal(ts) → 'YYYY-MM-DD'` (fuso local)
  - `ProjCore.etapaNaData(intervalos, dataISO) → etapaId|null`
- Regra: um intervalo abre num evento `etapa` ou `retorno` (com `para` = id da etapa) e fecha no próximo evento desses ou num evento `status` com `para` em `concluida`, `cancelada` ou `recusada`. Pausa não fecha o intervalo.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar)

```js
// Timestamps com fuso explícito -03:00 para não depender do fuso da máquina nos cálculos de dias
const ev = (tipo, para, papel, quando, de) => ({ tipo, para, papel_id: papel, criado_em: quando, de: de || null });

test('intervalosEtapa e tempoPorPapel com retorno e conclusão', () => {
  const eventos = [
    ev('status', 'execucao', null, '2026-01-01T12:00:00-03:00', 'aprovada'),
    ev('etapa', 'esp', 'analista', '2026-01-01T12:00:00-03:00'),
    ev('etapa', 'dev', 'dev', '2026-01-03T12:00:00-03:00'),
    ev('etapa', 'val', 'testador', '2026-01-08T12:00:00-03:00'),
    ev('retorno', 'dev', 'dev', '2026-01-09T12:00:00-03:00'),
    ev('status', 'concluida', null, '2026-01-11T12:00:00-03:00', 'execucao'),
  ];
  const ints = C.intervalosEtapa(eventos);
  assert.equal(ints.length, 4);
  assert.equal(ints[3].retorno, true);
  assert.equal(ints[3].fim, '2026-01-11T12:00:00-03:00');
  const t = C.tempoPorPapel(eventos, '2026-02-01T12:00:00-03:00');
  assert.deepEqual(t, { dias: { analista: 2, dev: 7, testador: 1 }, retornos: 1 });
});

test('tempoPorPapel: etapa atual conta até agora; pausa não fecha', () => {
  const eventos = [
    ev('etapa', 'esp', 'cliente', '2026-01-01T12:00:00-03:00'),
    ev('status', 'pausada', null, '2026-01-02T12:00:00-03:00', 'execucao'),
  ];
  assert.deepEqual(C.tempoPorPapel(eventos, '2026-01-04T00:00:00-03:00'), { dias: { cliente: 2.5 }, retornos: 0 });
  assert.equal(C.diasNaEtapaAtual(eventos, '2026-01-04T00:00:00-03:00'), 2);
  assert.equal(C.diasNaEtapaAtual([], '2026-01-04T00:00:00-03:00'), null);
});

test('etapaNaData: dia local e última etapa do dia vence', () => {
  // 22h em -03:00 = 01h UTC do dia seguinte; deve contar no dia local 05
  const eventos = [
    ev('etapa', 'esp', 'a', '2026-01-01T09:00:00-03:00'),
    ev('etapa', 'dev', 'd', '2026-01-05T22:00:00-03:00'),
    ev('etapa', 'val', 't', '2026-01-07T09:00:00-03:00'),
    ev('etapa', 'imp', 'a', '2026-01-07T15:00:00-03:00'),
  ];
  const ints = C.intervalosEtapa(eventos);
  const local = ts => C.dataLocal(ts);
  // Usa as datas locais calculadas pelo próprio módulo, para o teste valer em qualquer fuso
  assert.equal(C.etapaNaData(ints, local('2026-01-03T12:00:00-03:00')), 'esp');
  assert.equal(C.etapaNaData(ints, local('2026-01-05T22:00:00-03:00')), 'dev');
  assert.equal(C.etapaNaData(ints, local('2026-01-07T15:00:00-03:00')), 'imp');
  assert.equal(C.etapaNaData(ints, '2025-12-31'), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL com `C.intervalosEtapa is not a function`

- [ ] **Step 3: Implementar** (antes de `var api=`)

```js
  var FECHA_ETAPA=['concluida','cancelada','recusada'];
  var DIA_MS=86400000;

  function porData(a,b){return new Date(a.criado_em)-new Date(b.criado_em)}

  function intervalosEtapa(eventos){
    var out=[],aberto=null;
    (eventos||[]).slice().sort(porData).forEach(function(e){
      if(e.tipo==='etapa'||e.tipo==='retorno'){
        if(aberto)aberto.fim=e.criado_em;
        aberto={etapaId:e.para,papelId:e.papel_id||null,inicio:e.criado_em,fim:null,retorno:e.tipo==='retorno'};
        out.push(aberto);
      }else if(e.tipo==='status'&&FECHA_ETAPA.indexOf(e.para)>-1&&aberto){
        aberto.fim=e.criado_em;aberto=null;
      }
    });
    return out;
  }

  function tempoPorPapel(eventos,agora){
    var fimPadrao=agora||new Date().toISOString();
    var ints=intervalosEtapa(eventos),dias={};
    ints.forEach(function(i){
      if(!i.papelId)return;
      var ms=new Date(i.fim||fimPadrao)-new Date(i.inicio);
      dias[i.papelId]=(dias[i.papelId]||0)+Math.max(0,ms)/DIA_MS;
    });
    Object.keys(dias).forEach(function(k){dias[k]=Math.round(dias[k]*10)/10});
    return{dias:dias,retornos:ints.filter(function(i){return i.retorno}).length};
  }

  function diasNaEtapaAtual(eventos,agora){
    var ints=intervalosEtapa(eventos);
    var ult=ints[ints.length-1];
    if(!ult||ult.fim)return null;
    return Math.floor((new Date(agora||new Date().toISOString())-new Date(ult.inicio))/DIA_MS);
  }

  function dataLocal(ts){return new Date(ts).toLocaleDateString('sv')}

  // Etapa em que o projeto estava num dia (data local); se mudou no mesmo dia, vale a última
  function etapaNaData(intervalos,dataISO){
    var achou=null;
    (intervalos||[]).forEach(function(i){
      var ini=dataLocal(i.inicio),fim=i.fim?dataLocal(i.fim):null;
      if(ini<=dataISO&&(fim===null||fim>=dataISO))achou=i.etapaId;
    });
    return achou;
  }
```
Acrescentar ao `api`:
```js
    intervalosEtapa:intervalosEtapa,tempoPorPapel:tempoPorPapel,diasNaEtapaAtual:diasNaEtapaAtual,
    dataLocal:dataLocal,etapaNaData:etapaNaData,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS (13 testes)

- [ ] **Step 5: Commit**

```bash
git add projetos-core.js tests/projetos-core.test.js
git commit -m "feat(projetos): intervalos de etapa e tempo por papel"
```

---

### Task 4: Núcleo, parte 4: horas realizadas por etapa (regra C)

**Files:**
- Modify: `projetos-core.js`
- Test: `tests/projetos-core.test.js`

**Interfaces:**
- Consumes: `intervalosEtapa`, `etapaNaData` (Task 3).
- Produces: `ProjCore.horasPorEtapa(linhas, eventos, etapas) → {porEtapa:{etapaId:horas}, semEtapa:number, total:number}`, com 2 casas. `linhas` vem da RPC `projeto_horas_agregadas`: `[{data:'YYYY-MM-DD', activity_type_id:string|null, horas:number|string}]`. `etapas` são linhas de `projeto_etapas` (`id, ativo, tipos_atividade: string[]`).

- [ ] **Step 1: Escrever os testes que falham** (acrescentar)

```js
test('horasPorEtapa: tipo de atividade > data > sem etapa', () => {
  const etapas = [
    { id: 'esp', tipos_atividade: ['9'] },
    { id: 'dev', tipos_atividade: ['10'] },
    { id: 'old', ativo: false, tipos_atividade: ['11'] },
  ];
  const eventos = [
    ev('etapa', 'esp', 'a', '2026-01-05T12:00:00-03:00'),
    ev('etapa', 'dev', 'd', '2026-01-10T12:00:00-03:00'),
  ];
  const linhas = [
    { data: '2026-01-12', activity_type_id: '9', horas: 2 },   // tipo ligado a esp, mesmo estando em dev
    { data: '2026-01-06', activity_type_id: 10, horas: '3' },  // número × string
    { data: '2026-01-06', activity_type_id: null, horas: 1.5 },// sem tipo → pela data → esp
    { data: '2026-01-11', activity_type_id: '77', horas: 1 },  // tipo não ligado → pela data → dev
    { data: '2026-01-11', activity_type_id: '11', horas: 1 },  // tipo de etapa desativada → pela data → dev
    { data: '2026-01-01', activity_type_id: null, horas: 4 },  // antes da 1ª etapa → sem etapa
  ];
  assert.deepEqual(C.horasPorEtapa(linhas, eventos, etapas), {
    porEtapa: { esp: 3.5, dev: 5 }, semEtapa: 4, total: 12.5,
  });
});

test('horasPorEtapa: vazio', () => {
  assert.deepEqual(C.horasPorEtapa([], [], []), { porEtapa: {}, semEtapa: 0, total: 0 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL com `C.horasPorEtapa is not a function`

- [ ] **Step 3: Implementar** (antes de `var api=`)

```js
  function r2(n){return Math.round(n*100)/100}

  // Regra C: tipo de atividade ligado a uma etapa ativa; senão, a etapa do dia; senão, "sem etapa"
  function horasPorEtapa(linhas,eventos,etapas){
    var mapa={};
    (etapas||[]).forEach(function(e){
      if(e.ativo===false)return;
      (e.tipos_atividade||[]).forEach(function(t){mapa[String(t)]=e.id});
    });
    var ints=intervalosEtapa(eventos),por={},sem=0,total=0;
    (linhas||[]).forEach(function(l){
      var h=num(l.horas)||0;if(!h)return;
      total+=h;
      var et=(l.activity_type_id!=null&&mapa[String(l.activity_type_id)])||etapaNaData(ints,String(l.data).slice(0,10));
      if(et)por[et]=(por[et]||0)+h;else sem+=h;
    });
    Object.keys(por).forEach(function(k){por[k]=r2(por[k])});
    return{porEtapa:por,semEtapa:r2(sem),total:r2(total)};
  }
```
Acrescentar ao `api`: `horasPorEtapa:horasPorEtapa,`

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS (15 testes)

- [ ] **Step 5: Commit**

```bash
git add projetos-core.js tests/projetos-core.test.js
git commit -m "feat(projetos): horas realizadas por etapa (regra C)"
```

---

### Task 5: Migration de tabelas, RLS e fluxo padrão

**Files:**
- Create: `supabase/migrations/2026-10-14_01_projetos.sql`

**Interfaces:**
- Produces: as tabelas `projeto_papeis`, `projeto_etapas`, `projetos`, `projeto_etapa_config` e `projeto_eventos`; as colunas `oss.projeto_id` e `oss.projeto_desvinculado`; a função `seed_projeto_fluxo(uuid)`; e `create_workspace` passando a chamar o seed. Os nomes de coluna são os usados pelas Tasks 7 a 13.

- [ ] **Step 1: Pré-checagem (o usuário roda no SQL Editor e cola o resultado)**

```sql
select table_name, column_name, data_type
from information_schema.columns
where (table_name = 'pontos' and column_name in ('data','apropriacoes'))
   or (table_name = 'oss' and column_name in ('id','workspace_id','projeto_id'));
```
Esperado: `pontos.apropriacoes = jsonb`, `pontos.data = date` (ou `text`), `oss.id = uuid`, e nenhuma linha `oss.projeto_id`. Se `apropriacoes` for `json`, troque `jsonb_array_elements` por `json_array_elements` na Task 6. Se `data` for `text`, o `::date` da Task 6 continua valendo.

- [ ] **Step 2: Escrever a migration**

`supabase/migrations/2026-10-14_01_projetos.sql`:
```sql
-- 2026-10-14_01_projetos.sql
-- Backlog de Projetos: tabelas, colunas novas em oss, RLS e fluxo padrão por workspace.
-- Idempotente (padrão do projeto): pode ser reaplicada inteira no SQL Editor.
-- Rodar como postgres (dono das tabelas). Spec: docs/superpowers/specs/2026-10-14-backlog-projetos-design.md

create table if not exists projeto_papeis (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  nome text not null,
  externo boolean not null default false,
  ordem int not null default 0
);

create table if not exists projeto_etapas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  papel_id uuid references projeto_papeis(id) on delete set null,
  tipos_atividade text[] not null default '{}',
  ativo boolean not null default true
);

create table if not exists projetos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  titulo text not null,
  descricao text,
  status text not null default 'ideia'
    check (status in ('ideia','avaliacao','aprovada','recusada','execucao','pausada','concluida','cancelada')),
  etapa_id uuid references projeto_etapas(id) on delete set null,
  nota_impacto smallint check (nota_impacto between 1 and 5),
  nota_urgencia smallint check (nota_urgencia between 1 and 5),
  nota_alinhamento smallint check (nota_alinhamento between 1 and 5),
  legal boolean not null default false,
  esforco_total_h numeric check (esforco_total_h >= 0),
  esforco_tamanho text check (esforco_tamanho in ('P','M','G','GG')),
  prioridade numeric,
  data_alvo date,
  pai_redmine text,
  sugerido_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists projetos_ws_idx on projetos(workspace_id);

create table if not exists projeto_etapa_config (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  projeto_id uuid not null references projetos(id) on delete cascade,
  etapa_id uuid not null references projeto_etapas(id) on delete cascade,
  horas_estimadas numeric not null default 0 check (horas_estimadas >= 0),
  pulada boolean not null default false,
  responsavel_user_id uuid references auth.users(id) on delete set null,
  responsavel_nome text,
  primary key (projeto_id, etapa_id)
);

create table if not exists projeto_eventos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  projeto_id uuid not null references projetos(id) on delete cascade,
  tipo text not null check (tipo in ('status','etapa','retorno','comentario','vinculo_os')),
  de text,
  para text,
  papel_id uuid references projeto_papeis(id) on delete set null,
  comentario text,
  autor_id uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists projeto_eventos_proj_idx on projeto_eventos(projeto_id, criado_em);

alter table oss add column if not exists projeto_id uuid references projetos(id) on delete set null;
alter table oss add column if not exists projeto_desvinculado boolean not null default false;
create index if not exists oss_projeto_idx on oss(projeto_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table projeto_papeis enable row level security;
alter table projeto_etapas enable row level security;
alter table projetos enable row level security;
alter table projeto_etapa_config enable row level security;
alter table projeto_eventos enable row level security;

-- Fluxo (papéis e etapas): todos leem, só admin escreve
drop policy if exists projeto_papeis_select on projeto_papeis;
create policy projeto_papeis_select on projeto_papeis for select using (is_workspace_member(workspace_id));
drop policy if exists projeto_papeis_write on projeto_papeis;
create policy projeto_papeis_write on projeto_papeis for all
  using (is_workspace_admin(workspace_id)) with check (is_workspace_admin(workspace_id));

drop policy if exists projeto_etapas_select on projeto_etapas;
create policy projeto_etapas_select on projeto_etapas for select using (is_workspace_member(workspace_id));
drop policy if exists projeto_etapas_write on projeto_etapas;
create policy projeto_etapas_write on projeto_etapas for all
  using (is_workspace_admin(workspace_id)) with check (is_workspace_admin(workspace_id));

-- Projetos: membros leem, criam ideias (como autores) e atualizam; ninguém apaga.
-- A diferença entre autor da ideia e gerir_projetos é checada no client com can(), como no resto do app.
drop policy if exists projetos_select on projetos;
create policy projetos_select on projetos for select using (is_workspace_member(workspace_id));
drop policy if exists projetos_insert on projetos;
create policy projetos_insert on projetos for insert
  with check (is_workspace_member(workspace_id) and sugerido_por = auth.uid() and status = 'ideia');
drop policy if exists projetos_update on projetos;
create policy projetos_update on projetos for update
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

drop policy if exists projeto_etapa_config_rw on projeto_etapa_config;
create policy projeto_etapa_config_rw on projeto_etapa_config for all
  using (is_workspace_member(workspace_id))
  with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from projetos p where p.id = projeto_id and p.workspace_id = projeto_etapa_config.workspace_id)
  );

-- Eventos: só leitura e inserção (histórico imutável)
drop policy if exists projeto_eventos_select on projeto_eventos;
create policy projeto_eventos_select on projeto_eventos for select using (is_workspace_member(workspace_id));
drop policy if exists projeto_eventos_insert on projeto_eventos;
create policy projeto_eventos_insert on projeto_eventos for insert
  with check (
    is_workspace_member(workspace_id) and autor_id = auth.uid()
    and exists (select 1 from projetos p where p.id = projeto_id and p.workspace_id = projeto_eventos.workspace_id)
  );

-- ── Fluxo padrão ─────────────────────────────────────────────────────────────
create or replace function seed_projeto_fluxo(ws_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p_analista uuid; p_cliente uuid; p_dev uuid; p_testador uuid;
begin
  if exists (select 1 from projeto_etapas where workspace_id = ws_id) then return; end if;
  insert into projeto_papeis (workspace_id, nome, externo, ordem) values (ws_id, 'Analista', false, 1) returning id into p_analista;
  insert into projeto_papeis (workspace_id, nome, externo, ordem) values (ws_id, 'Cliente', true, 2) returning id into p_cliente;
  insert into projeto_papeis (workspace_id, nome, externo, ordem) values (ws_id, 'Desenvolvedor', false, 3) returning id into p_dev;
  insert into projeto_papeis (workspace_id, nome, externo, ordem) values (ws_id, 'Testador', false, 4) returning id into p_testador;
  insert into projeto_etapas (workspace_id, nome, ordem, papel_id) values
    (ws_id, 'Especificação', 1, p_analista),
    (ws_id, 'Aprovação da especificação', 2, p_cliente),
    (ws_id, 'Desenvolvimento', 3, p_dev),
    (ws_id, 'Validação', 4, p_testador),
    (ws_id, 'Implantação', 5, p_analista);
end;
$$;
revoke execute on function seed_projeto_fluxo(uuid) from public;

select seed_projeto_fluxo(id) from workspaces;

-- create_workspace (2026-08-20_03) passa a criar o fluxo padrão junto
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

  perform seed_projeto_fluxo(new_ws_id);

  return new_ws_id;
end;
$$;

revoke execute on function create_workspace(text, text) from public;
grant execute on function create_workspace(text, text) to authenticated;
```

- [ ] **Step 3: Commit do arquivo e entrega ao usuário**

```bash
git add supabase/migrations/2026-10-14_01_projetos.sql
git commit -m "feat(projetos): migration de tabelas, RLS e fluxo padrao"
```
Peça ao usuário para rodar o arquivo inteiro no SQL Editor de produção.

- [ ] **Step 4: Verificar (o usuário roda e cola o resultado)**

```sql
select w.nome, count(e.*) as etapas, count(distinct e.papel_id) as papeis
from workspaces w left join projeto_etapas e on e.workspace_id = w.id group by w.nome;
select tablename, policyname, cmd from pg_policies where tablename like 'projet%' order by 1, 2;
select column_name, data_type from information_schema.columns where table_name = 'oss' and column_name like 'projeto%';
```
Esperado: 5 etapas e 3 papéis distintos por workspace (Analista se repete); 10 policies (papeis 2, etapas 2, projetos 3, config 1, eventos 2); 2 colunas em `oss`. Rodar a migration de novo não deve dar erro, nem duplicar o fluxo.

---

### Task 6: Migration das funções de horas agregadas

**Files:**
- Create: `supabase/migrations/2026-10-14_02_projetos_horas.sql`

**Interfaces:**
- Produces:
  - RPC `projeto_horas_agregadas(p_projeto_id uuid) → table(data date, activity_type_id text, horas numeric)`, consumida pela Task 11 com `ProjCore.horasPorEtapa`.
  - RPC `projetos_horas_totais(p_workspace_id uuid) → table(projeto_id uuid, horas numeric)`, consumida pela Task 7 (`PJ.horasTot`).
  - As duas devolvem vazio para quem não é membro e nunca devolvem usuário nem marcações.

- [ ] **Step 1: Escrever a migration**

```sql
-- 2026-10-14_02_projetos_horas.sql
-- Horas apropriadas das OSs de projetos, somadas entre TODAS as pessoas do workspace,
-- sem expor de quem é cada hora (o client só carrega o próprio ponto).
-- Uma apropriação com detalhamento por atividade vira uma linha por atividade;
-- sem detalhamento, vira uma linha com activity_type_id nulo.

create or replace function projeto_horas_agregadas(p_projeto_id uuid)
returns table(data date, activity_type_id text, horas numeric)
language sql security definer set search_path = public, pg_temp stable as $$
  with proj as (
    select workspace_id from projetos where id = p_projeto_id and is_workspace_member(workspace_id)
  ),
  ap as (
    select p.data::date as data, a
    from pontos p
    join proj on proj.workspace_id = p.workspace_id
    cross join lateral jsonb_array_elements(coalesce(p.apropriacoes, '[]'::jsonb)) a
    where (a->>'osId') in (select o.id::text from oss o where o.projeto_id = p_projeto_id)
  ),
  linhas as (
    select ap.data, b->>'activityTypeId' as activity_type_id, (b->>'horas')::numeric as horas
    from ap cross join lateral jsonb_array_elements(ap.a->'breakdown') b
    where jsonb_typeof(ap.a->'breakdown') = 'array'
    union all
    select ap.data, null, (ap.a->>'horas')::numeric
    from ap
    where coalesce(jsonb_typeof(ap.a->'breakdown'), 'null') <> 'array'
       or jsonb_array_length(ap.a->'breakdown') = 0
  )
  select l.data, l.activity_type_id, sum(l.horas) from linhas l group by 1, 2 order by 1
$$;
revoke execute on function projeto_horas_agregadas(uuid) from public;
grant execute on function projeto_horas_agregadas(uuid) to authenticated;

create or replace function projetos_horas_totais(p_workspace_id uuid)
returns table(projeto_id uuid, horas numeric)
language sql security definer set search_path = public, pg_temp stable as $$
  select o.projeto_id, sum((a->>'horas')::numeric)
  from pontos p
  cross join lateral jsonb_array_elements(coalesce(p.apropriacoes, '[]'::jsonb)) a
  join oss o on o.id::text = a->>'osId'
  where is_workspace_member(p_workspace_id)
    and p.workspace_id = p_workspace_id
    and o.workspace_id = p_workspace_id
    and o.projeto_id is not null
  group by o.projeto_id
$$;
revoke execute on function projetos_horas_totais(uuid) from public;
grant execute on function projetos_horas_totais(uuid) to authenticated;
```

- [ ] **Step 2: Commit e entrega ao usuário**

```bash
git add supabase/migrations/2026-10-14_02_projetos_horas.sql
git commit -m "feat(projetos): funcoes de horas agregadas por projeto"
```
O usuário roda o arquivo no SQL Editor.

- [ ] **Step 3: Verificar o caso "não membro" (o usuário roda no SQL Editor)**

```sql
select * from projetos_horas_totais((select id from workspaces limit 1));
```
Esperado: **0 linhas**. No SQL Editor, `auth.uid()` é nulo, então quem chama não é membro. O caso de membro é verificado pelo console do app na Task 14.

---

### Task 7: Camada de dados no `index.html` e correção do `salvarOS`

**Files:**
- Modify: `index.html`: `<head>` (script), `load()` (~5804-5813), `dbSalvarOS`/`dbMoverOS` (~5890-5905), `salvarOS` (~3247-3273), e uma seção nova `// ── PROJETOS: dados` logo antes de `// ── OPERAÇÕES SUPABASE` (~5864).

**Interfaces:**
- Consumes: `ProjCore.*` (Tasks 1 a 4), as tabelas da Task 5 e a RPC `projetos_horas_totais` da Task 6.
- Produces (usadas pelas Tasks 8 a 13):
  - `PJ = {projetos, etapas, papeis, configs, eventos, horasTot:{projetoId:horas}, ok:bool}`
  - `PJ_STATUS` (rótulos)
  - `projCarregar()`
  - `projById(id)`, `projEtapa(id)`, `projPapel(id)`, `projConfigs(pid)`, `projEventos(pid)`, `projEtapasAtivas()`
  - `projEvento(pid, tipo, de, para, comentario, papelId) → Promise<row>`
  - `projSalvar(p, campos) → Promise<p>`
  - `projMudarStatus(p, novo, comentario) → Promise`
  - `projMoverEtapa(p, etapaId) → Promise`
  - `projAtualizarPrioridade(p) → Promise`
  - `_projNotificarOS(osId, mud)`, chamado por `dbMoverOS`/`dbSalvarOS`
  - `projRegistrarVinculo(os, antigoId, novoId, motivo) → Promise`
  - Na OS: `os.projetoId`, `os.projetoDesvinculado`

- [ ] **Step 1: Carregar o núcleo.** No `<head>`, logo após a linha 9 (`<script src=".../supabase-js@2">`):

```html
<script src="projetos-core.js"></script>
```

- [ ] **Step 2: Mapear os campos novos da OS no `load()`.** No `S.oss=(oss||[]).map(...)` (~5807), acrescente depois de `paiRedmine:o.pai_redmine||''`:

```js
      ,projetoId:o.projeto_id||null,projetoDesvinculado:!!o.projeto_desvinculado
```
E logo depois do `map` das OSs:
```js
    _osDb={};S.oss.forEach(function(o){_osDb[o.id]={status:o.status,projetoId:o.projetoId}});
    await projCarregar();
```

- [ ] **Step 3: Gravar os campos novos e notificar.** Substitua `dbSalvarOS` e `dbMoverOS`:

```js
async function dbSalvarOS(os){
  var {data,error}=await sb.from('oss').upsert({
    id:os.id,workspace_id:CURRENT_WORKSPACE_ID,versao_id:os.versaoId,num:os.num,titulo:os.titulo,
    produto:os.produto,status:os.status,obs:os.obs||'',link:os.link||'',
    atribuicao:os.atribuicao||'',estimated_hours:os.estimatedHours||0,entregas:os.entregas,created_by:CURRENT_USER.id,
    tipo_redmine:os.tipoRedmine||'',pai_redmine:os.paiRedmine||'',
    projeto_id:os.projetoId||null,projeto_desvinculado:!!os.projetoDesvinculado
  }).select().single();
  if(error)throw error;
  _projNotificarOS(data.id,{status:os.status,projetoId:os.projetoId||null,num:os.num});
  return data;
}
```
```js
async function dbMoverOS(id,novoStatus){
  await sb.from('oss').update({status:novoStatus}).eq('id',id);
  _projNotificarOS(id,{status:novoStatus});
}
```

- [ ] **Step 4: Corrigir o `salvarOS` para não perder campos.** Em `salvarOS()` (~3255), no objeto `data`, depois de `entregas:old?old.entregas:{}`, acrescente:

```js
    ,tipoRedmine:old?old.tipoRedmine||'':'',paiRedmine:old?old.paiRedmine||'':''
    ,projetoId:old?old.projetoId||null:null,projetoDesvinculado:old?!!old.projetoDesvinculado:false
```
(A Task 12 troca `projetoId` pelo valor do select do modal.)

- [ ] **Step 5: Seção de dados.** Insira antes de `// ── OPERAÇÕES SUPABASE`:

```js
// ── PROJETOS: dados ─────────────────────────────────────────────────────────
// Regras puras em projetos-core.js (window.ProjCore). Aqui só estado + Supabase.
var PJ={projetos:[],etapas:[],papeis:[],configs:[],eventos:[],horasTot:{},ok:false};
var PJ_STATUS={ideia:'Ideia',avaliacao:'Em avaliação',aprovada:'Aprovada',recusada:'Recusada',execucao:'Em execução',pausada:'Pausada',concluida:'Concluída',cancelada:'Cancelada'};
var _osDb={}; // último {status,projetoId} gravado de cada OS, para detectar transições

async function projCarregar(){
  try{
    var ws=CURRENT_WORKSPACE_ID;
    var r=await Promise.all([
      sb.from('projetos').select('*').eq('workspace_id',ws),
      sb.from('projeto_etapas').select('*').eq('workspace_id',ws).order('ordem'),
      sb.from('projeto_papeis').select('*').eq('workspace_id',ws).order('ordem'),
      sb.from('projeto_etapa_config').select('*').eq('workspace_id',ws),
      sb.from('projeto_eventos').select('*').eq('workspace_id',ws).order('criado_em'),
      sb.rpc('projetos_horas_totais',{p_workspace_id:ws})
    ]);
    for(var i=0;i<r.length;i++)if(r[i].error)throw r[i].error;
    PJ.projetos=r[0].data||[];PJ.etapas=r[1].data||[];PJ.papeis=r[2].data||[];
    PJ.configs=r[3].data||[];PJ.eventos=r[4].data||[];
    PJ.horasTot={};(r[5].data||[]).forEach(function(x){PJ.horasTot[x.projeto_id]=parseFloat(x.horas)||0});
    PJ.ok=true;
  }catch(e){console.warn('Projetos indisponíveis:',e&&e.message);PJ.ok=false}
}
function projById(id){return PJ.projetos.find(function(p){return p.id===id})||null}
function projEtapa(id){return PJ.etapas.find(function(e){return e.id===id})||null}
function projPapel(id){return PJ.papeis.find(function(x){return x.id===id})||null}
function projConfigs(pid){return PJ.configs.filter(function(c){return c.projeto_id===pid})}
function projEventos(pid){return PJ.eventos.filter(function(e){return e.projeto_id===pid})}
function projEtapasAtivas(){return PJ.etapas.filter(function(e){return e.ativo!==false}).sort(function(a,b){return a.ordem-b.ordem})}

async function projEvento(pid,tipo,de,para,comentario,papelId){
  var row={workspace_id:CURRENT_WORKSPACE_ID,projeto_id:pid,tipo:tipo,
    de:de==null?null:String(de),para:para==null?null:String(para),
    papel_id:papelId||null,comentario:comentario||null,autor_id:CURRENT_USER.id};
  var {data,error}=await sb.from('projeto_eventos').insert(row).select().single();
  if(error)throw error;
  PJ.eventos.push(data);return data;
}
async function projSalvar(p,campos){
  campos.atualizado_em=new Date().toISOString();
  var {data,error}=await sb.from('projetos').update(campos).eq('id',p.id).select().single();
  if(error)throw error;
  Object.assign(p,data);return p;
}
async function projAtualizarPrioridade(p){
  var pr=ProjCore.calcPrioridade(p,projConfigs(p.id)).prioridade;
  if(pr!==(p.prioridade==null?null:+p.prioridade))await projSalvar(p,{prioridade:pr});
}
// Muda o status e grava o histórico; ao entrar em execução, entra (ou reentra) numa etapa
async function projMudarStatus(p,novo,comentario){
  var de=p.status,campos={status:novo},entrar=null;
  if(novo==='execucao'&&!p.etapa_id){entrar=ProjCore.primeiraEtapa(PJ.etapas,projConfigs(p.id));campos.etapa_id=entrar}
  else if(novo==='execucao'&&de==='concluida')entrar=p.etapa_id;
  await projSalvar(p,campos);
  await projEvento(p.id,'status',de,novo,comentario);
  if(entrar){var et=projEtapa(entrar);await projEvento(p.id,'etapa',null,entrar,null,et&&et.papel_id)}
}
async function projMoverEtapa(p,etapaId){
  if(!etapaId||p.etapa_id===etapaId)return;
  var deId=p.etapa_id,de=projEtapa(deId),para=projEtapa(etapaId);
  var tipo=(de&&para&&para.ordem<de.ordem)?'retorno':'etapa';
  await projSalvar(p,{etapa_id:etapaId});
  await projEvento(p.id,tipo,deId,etapaId,null,para&&para.papel_id);
}
var PJ_GATILHO_LABEL={os_vinculada:'OS vinculada',os_andamento:'OS em andamento',os_reaberta:'OS reaberta'};
async function projAposMudancaOS(antes,depois){
  if(!PJ.ok||!depois||!depois.projetoId)return;
  var p=projById(depois.projetoId);if(!p)return;
  var gs=ProjCore.gatilhosDaOS(antes,depois);
  for(var i=0;i<gs.length;i++){
    var novo=ProjCore.proximoStatusAuto(p.status,gs[i]);
    if(!novo)continue;
    try{
      await projMudarStatus(p,novo,'Automático: '+PJ_GATILHO_LABEL[gs[i]]+(depois.num?' (OS '+depois.num+')':''));
      toast('Projeto "'+p.titulo+'" → '+PJ_STATUS[novo]);
      if(typeof renderProjetos==='function'&&document.getElementById('screen-projetos').classList.contains('active'))renderProjetos();
    }catch(e){console.warn('Status automático do projeto falhou:',e)}
    return;
  }
}
function _projNotificarOS(id,mud){
  var antes=_osDb[id]||{};
  var os=S.oss.find(function(o){return o.id===id})||{};
  var depois={
    status:mud.status!==undefined?mud.status:antes.status,
    projetoId:('projetoId' in mud)?mud.projetoId:(antes.projetoId!==undefined?antes.projetoId:(os.projetoId||null)),
    num:mud.num||os.num
  };
  _osDb[id]={status:depois.status,projetoId:depois.projetoId};
  projAposMudancaOS(antes,depois);
}
// Histórico de vínculo nos dois projetos envolvidos
async function projRegistrarVinculo(os,antigoId,novoId,motivo){
  if(antigoId===novoId)return;
  try{
    if(antigoId&&projById(antigoId))await projEvento(antigoId,'vinculo_os','os:'+os.num,null,motivo||null);
    if(novoId&&projById(novoId))await projEvento(novoId,'vinculo_os',null,'os:'+os.num,motivo||null);
  }catch(e){console.warn('Evento de vínculo falhou:',e)}
}
```

- [ ] **Step 6: Verificar no navegador** (porta 8080, com as migrations aplicadas)

No console: `PJ.ok` → `true`; `PJ.etapas.length` → `5`. Edite uma OS que veio do Redmine com pai, mude só o título e salve. Depois rode `S.oss.find(o=>o.num==='<num>').paiRedmine`: o pai continua lá (antes da correção virava `''`). Rode também `node --test tests/` → PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(projetos): camada de dados e status automatico; salvarOS preserva pai do Redmine"
```

---

### Task 8: Menu, permissões e esqueleto da tela

**Files:**
- Modify: `index.html`: CSS (após o bloco `/* KANBAN */`, ~101), sidebar (~530), `applyMenuPermissions` (~1615), `openGerenciarRole` (~2295), `PERM_LABELS` (~2176), `goScreen` (~2722), e uma tela nova antes de `<!-- DASHBOARD -->`/`screen-dashboard` (~588).

**Interfaces:**
- Consumes: `PJ`, `PJ_STATUS` (Task 7).
- Produces: `renderProjetos()`, `pjTab(nome)`, `_pjTab`. Containers `#pj-tab-backlog` e `#pj-tab-quadro`, preenchidos por `renderPjBacklog()` (Task 9) e `renderPjQuadro()` (Task 10). Classes CSS `pj-*`.

- [ ] **Step 1: CSS.** Depois da linha `.empty-col{...}` (~102):

```css
/* PROJETOS */
.pj-tab{background:none;border:none;border-bottom:2px solid transparent;padding:8px 14px;font-size:13px;color:var(--muted);cursor:pointer;font-family:var(--font)}
.pj-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.pj-row{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);margin-bottom:8px;cursor:pointer}
.pj-row:hover{border-color:var(--accent)}
.pj-prio{font-family:var(--mono);font-size:18px;font-weight:600;min-width:46px;text-align:center}
.pj-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;align-items:flex-start}
.pj-col{flex:0 0 240px;min-width:240px}
.pj-col.drop{outline:2px dashed var(--accent);outline-offset:4px;border-radius:var(--radius-lg)}
.pj-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:10px 12px;cursor:pointer}
.pj-card:hover{border-color:var(--accent)}
.pj-bar{height:4px;background:var(--card2);border-radius:2px;overflow:hidden;margin:6px 0}
.pj-bar>div{height:100%;background:var(--green)}
.pj-drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,100vw);background:var(--surface);border-left:1px solid var(--border2);z-index:250;overflow-y:auto;padding:20px 22px;transform:translateX(100%);transition:transform .2s}
.pj-drawer.open{transform:none}
.pj-sec{margin-top:18px}
.pj-sec-title{font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}
.pj-badge-legal{background:var(--amber-dim);color:var(--amber-text)}
.pj-badge-st{background:var(--card2);color:var(--muted)}
.pj-tbl{width:100%;border-collapse:collapse;font-size:12px}
.pj-tbl td,.pj-tbl th{padding:5px 4px;border-bottom:1px solid var(--border);text-align:left;vertical-align:middle}
.pj-tbl th{font-size:10px;color:var(--hint);font-weight:500;text-transform:uppercase}
```

- [ ] **Step 2: Sidebar.** Antes de `<div class="nav-section">` + `<div class="nav-label">Versão atual</div>` (~531):

```html
      <div class="nav-section" id="nav-sec-estrategico" style="display:none">
        <div class="nav-label">Estratégico</div>
        <div id="nav-projetos" class="nav-item" onclick="goScreen('projetos')">
          <svg class="nav-icon" viewBox="0 0 16 16"><path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z"/></svg>Projetos
        </div>
      </div>
```

- [ ] **Step 3: Permissão do menu.** No fim de `applyMenuPermissions()`, antes do `}`:

```js
  var navSecEst=document.getElementById('nav-sec-estrategico');
  if(navSecEst)navSecEst.style.display=(!isVisitor&&canMenu('projetos'))?'':'none';
```

- [ ] **Step 4: Checkboxes nos perfis.** Em `openGerenciarRole`, depois de `mkChk('menus.preferencias',...)`:

```js
      mkChk('menus.projetos','Projetos',!!(p.menus&&p.menus.projetos))+
```
Depois de `mkChk('acoes.dashboard_todas_equipes',...)`, acrescente `+` no fim dela e:
```js
      mkChk('acoes.gerir_projetos','Gerir projetos (pontuar, aprovar, mover etapas)',!!(p.acoes&&p.acoes.gerir_projetos))+
```
Em `PERM_LABELS` (~2176), acrescente: `'menus.projetos':'Projetos','acoes.gerir_projetos':'Gerir projetos',`

- [ ] **Step 5: Tela.** Antes de `<!-- DASHBOARD -->` (~587):

```html
      <!-- PROJETOS -->
      <div id="screen-projetos" class="screen">
        <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">
          <button id="pj-tab-btn-backlog" class="pj-tab active" onclick="pjTab('backlog')">Backlog de ideias</button>
          <button id="pj-tab-btn-quadro" class="pj-tab" onclick="pjTab('quadro')">Projetos</button>
        </div>
        <div id="pj-aviso"></div>
        <div id="pj-tab-backlog"></div>
        <div id="pj-tab-quadro" style="display:none"></div>
      </div>
```

- [ ] **Step 6: `goScreen`.** Em `telasBloqueadas` acrescente `'projetos'`. Em `titles` acrescente `projetos:'Projetos'`. Em `acts` acrescente:

```js
    projetos:(!isVisitor&&PJ.ok)?'<button class="btn btn-primary btn-sm" onclick="openPjIdeia()">+ Nova ideia</button>':'',
```
E depois de `if(name==='agenda')renderAgenda();`:
```js
  if(name==='projetos')renderProjetos();
```

- [ ] **Step 7: Render da tela.** Logo depois da seção de dados da Task 7:

```js
// ── PROJETOS: tela ──────────────────────────────────────────────────────────
var _pjTab='backlog';
function pjTab(nome){
  _pjTab=nome;
  ['backlog','quadro'].forEach(function(t){
    document.getElementById('pj-tab-'+t).style.display=t===nome?'':'none';
    document.getElementById('pj-tab-btn-'+t).classList.toggle('active',t===nome);
  });
  if(nome==='backlog')renderPjBacklog();else renderPjQuadro();
}
function renderProjetos(){
  var av=document.getElementById('pj-aviso');
  if(!PJ.ok){av.innerHTML='<div class="empty-col">Módulo de projetos indisponível neste workspace (as tabelas não carregaram).</div>';return}
  av.innerHTML='';
  pjTab(_pjTab);
}
function renderPjBacklog(){document.getElementById('pj-tab-backlog').innerHTML='<div class="empty-col">Em construção</div>'}
function renderPjQuadro(){document.getElementById('pj-tab-quadro').innerHTML='<div class="empty-col">Em construção</div>'}
```
(As Tasks 9 e 10 substituem os dois stubs.)

- [ ] **Step 8: Verificar** (8080, logado como admin): a seção "Estratégico › Projetos" aparece, as duas abas alternam, e o título da topbar é "Projetos". Em Preferências › Perfis, os checkboxes novos aparecem. Com um perfil sem `menus.projetos`, a seção some.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat(projetos): menu, permissoes e esqueleto da tela"
```

---

### Task 9: Aba Backlog de ideias, modal de ideia e decisões

**Files:**
- Modify: `index.html`: um modal novo junto aos outros (depois do `modal-os`, ~1440), e na seção `PROJETOS: tela` substituir o stub `renderPjBacklog` e acrescentar as funções.

**Interfaces:**
- Consumes: `PJ`, `projById`, `projConfigs`, `projSalvar`, `projEvento`, `projMudarStatus`, `projAtualizarPrioridade`, `ProjCore.calcPrioridade`, `ProjCore.compararBacklog`, `can`, `modalConfirm`, `S_USERS`, `escHtml`, `toast`.
- Produces: `renderPjBacklog()`, `openPjIdeia(id?)`, `pjSalvarIdeia()`, `pjPodeEditarIdeia(p)`, `pjAcao(id, acao)`, `pjPedirComentario(titulo)`, `PJ_ACOES`, `PJ_ACAO_LABEL`. `pjAbrir(id)` vem da Task 11; até lá, um stub.

- [ ] **Step 1: Modal.** Depois do fechamento do `modal-os`:

```html
<!-- MODAL IDEIA DE PROJETO -->
<div class="modal-overlay" id="modal-pj-ideia">
  <div class="modal" style="max-width:560px">
    <div class="modal-title" id="pj-ideia-title">Nova ideia</div>
    <input type="hidden" id="pj-ideia-id">
    <div class="form-group"><label class="form-label">Título</label><input class="form-input" id="pj-ideia-titulo" placeholder="O que é a ideia, em uma linha"></div>
    <div class="form-group"><label class="form-label">Descrição</label><textarea class="form-input" id="pj-ideia-desc" rows="3" placeholder="Problema, quem ganha, contexto"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Impacto no cliente</label><select class="form-input" id="pj-nota-impacto"></select></div>
      <div class="form-group"><label class="form-label">Urgência / legal</label><select class="form-input" id="pj-nota-urgencia" onchange="pjAtualizarLegal()"></select></div>
      <div class="form-group"><label class="form-label">Alinhamento</label><select class="form-input" id="pj-nota-alinhamento"></select></div>
    </div>
    <label class="form-check"><input type="checkbox" id="pj-legal" style="width:15px;height:15px;accent-color:var(--accent)"><span class="form-check-label">Obrigação legal</span><span class="form-check-hint">exige urgência 5</span></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <div class="form-group"><label class="form-label">Esforço total (h)</label><input type="number" min="0" step="1" class="form-input" id="pj-esforco-h" placeholder="opcional"></div>
      <div class="form-group"><label class="form-label">ou só o tamanho</label><select class="form-input" id="pj-esforco-tam"><option value="">—</option><option>P</option><option>M</option><option>G</option><option>GG</option></select></div>
    </div>
    <div style="font-size:11px;color:var(--hint)">As horas por etapa são informadas no painel do projeto. Quando existem, elas valem no lugar do total.</div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal('modal-pj-ideia')">Cancelar</button>
      <button class="btn btn-primary" onclick="pjSalvarIdeia()">Salvar</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Lista do backlog.** Substitua o stub `renderPjBacklog` por:

```js
var _pjMostrarRecusadas=false;
function renderPjBacklog(){
  var el=document.getElementById('pj-tab-backlog');if(!el)return;
  var lista=PJ.projetos.filter(function(p){
    return p.status==='ideia'||p.status==='avaliacao'||(_pjMostrarRecusadas&&p.status==='recusada');
  }).sort(ProjCore.compararBacklog);
  el.innerHTML=
    '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">'+
      '<label class="form-check" style="margin:0"><input type="checkbox" '+(_pjMostrarRecusadas?'checked':'')+' onchange="_pjMostrarRecusadas=this.checked;renderPjBacklog()" style="width:15px;height:15px;accent-color:var(--accent)"><span class="form-check-label">Mostrar recusadas</span></label>'+
    '</div>'+
    (lista.map(pjLinhaBacklog).join('')||'<div class="empty-col">Nenhuma ideia ainda. Use “+ Nova ideia”.</div>');
}
function pjLinhaBacklog(p){
  var c=ProjCore.calcPrioridade(p,projConfigs(p.id));
  var autor=S_USERS.find(function(u){return u.id===p.sugerido_por});
  var notas=c.valor!==null?'I'+p.nota_impacto+' · U'+p.nota_urgencia+' · A'+p.nota_alinhamento:'sem notas';
  var esf=c.tamanho?' · esforço '+c.tamanho+(c.horas?' ('+c.horas+'h)':''):'';
  return'<div class="pj-row" onclick="pjAbrir(\''+p.id+'\')">'+
    '<div class="pj-prio" style="color:'+(c.prioridade===null?'var(--hint)':'var(--accent)')+'">'+(c.prioridade===null?'—':c.prioridade.toFixed(1))+'</div>'+
    '<div style="flex:1;min-width:0">'+
      '<div style="font-size:14px;color:var(--text);font-weight:500">'+escHtml(p.titulo)+'</div>'+
      '<div style="font-size:11px;color:var(--hint);margin-top:2px">'+escHtml(autor?autor.displayName:'—')+' · '+notas+esf+'</div>'+
    '</div>'+
    (p.legal?'<span class="badge pj-badge-legal">Legal</span>':'')+
    '<span class="badge pj-badge-st">'+PJ_STATUS[p.status]+'</span>'+
  '</div>';
}
function pjAbrir(id){openPjIdeia(id)} // substituído pelo painel na Task 11
```

- [ ] **Step 3: Abrir e salvar ideia.**

```js
function pjPodeEditarIdeia(p){
  if(!p)return true;
  return can('gerir_projetos')||(p.status==='ideia'&&p.sugerido_por===CURRENT_USER.id);
}
function pjNotasOpts(){return'<option value="">—</option>'+[1,2,3,4,5].map(function(n){return'<option>'+n+'</option>'}).join('')}
function pjAtualizarLegal(){
  var u=document.getElementById('pj-nota-urgencia').value,c=document.getElementById('pj-legal');
  c.disabled=u!=='5';if(u!=='5')c.checked=false;
}
function openPjIdeia(id){
  var p=id?projById(id):null;
  if(p&&!pjPodeEditarIdeia(p)){toast('Sem permissão para editar esta ideia','err');return}
  document.getElementById('pj-ideia-title').textContent=p?'Editar ideia':'Nova ideia';
  document.getElementById('pj-ideia-id').value=p?p.id:'';
  document.getElementById('pj-ideia-titulo').value=p?p.titulo:'';
  document.getElementById('pj-ideia-desc').value=p&&p.descricao?p.descricao:'';
  ['impacto','urgencia','alinhamento'].forEach(function(k){
    var s=document.getElementById('pj-nota-'+k);s.innerHTML=pjNotasOpts();
    s.value=p&&p['nota_'+k]!=null?String(p['nota_'+k]):'';
  });
  document.getElementById('pj-legal').checked=!!(p&&p.legal);
  document.getElementById('pj-esforco-h').value=p&&p.esforco_total_h!=null?p.esforco_total_h:'';
  document.getElementById('pj-esforco-tam').value=p&&p.esforco_tamanho?p.esforco_tamanho:'';
  pjAtualizarLegal();
  openModal('modal-pj-ideia');
}
async function pjSalvarIdeia(){
  var id=document.getElementById('pj-ideia-id').value;
  var titulo=document.getElementById('pj-ideia-titulo').value.trim();
  if(!titulo){toast('Informe o título','err');return}
  function nota(k){var x=document.getElementById('pj-nota-'+k).value;return x?parseInt(x,10):null}
  var h=parseFloat(document.getElementById('pj-esforco-h').value);
  var campos={
    titulo:titulo,descricao:document.getElementById('pj-ideia-desc').value.trim()||null,
    nota_impacto:nota('impacto'),nota_urgencia:nota('urgencia'),nota_alinhamento:nota('alinhamento'),
    legal:document.getElementById('pj-legal').checked&&nota('urgencia')===5,
    esforco_total_h:isNaN(h)||h<=0?null:h,
    esforco_tamanho:document.getElementById('pj-esforco-tam').value||null
  };
  var p=id?projById(id):null;
  campos.prioridade=ProjCore.calcPrioridade(Object.assign({},p||{},campos),p?projConfigs(p.id):[]).prioridade;
  try{
    if(!p){
      campos.workspace_id=CURRENT_WORKSPACE_ID;campos.sugerido_por=CURRENT_USER.id;campos.status='ideia';
      var r=await sb.from('projetos').insert(campos).select().single();
      if(r.error)throw r.error;
      p=r.data;PJ.projetos.push(p);
      await projEvento(p.id,'status',null,'ideia','Ideia criada');
    }else await projSalvar(p,campos);
    // Só a pontuação de quem gere projetos leva Ideia → Em avaliação; nota de quem sugeriu é sugestão
    if(p.status==='ideia'&&can('gerir_projetos')&&ProjCore.calcPrioridade(p,projConfigs(p.id)).valor!==null){
      await projMudarStatus(p,'avaliacao','Pontuada');
    }
    closeModal('modal-pj-ideia');renderProjetos();
    if(typeof _pjAberto!=='undefined'&&_pjAberto===p.id)pjAbrir(p.id);
    toast('Ideia salva');
  }catch(e){toast('Erro ao salvar ideia: '+e.message,'err')}
}
```

- [ ] **Step 4: Ações de decisão** (usadas pelo painel, Task 11).

```js
var PJ_ACOES={
  ideia:['recusar','cancelar'],avaliacao:['aprovar','recusar','cancelar'],recusada:['reabrir'],
  aprovada:['cancelar'],execucao:['pausar','concluir','cancelar'],pausada:['retomar','cancelar'],
  concluida:['cancelar'],cancelada:[]
};
var PJ_ACAO_LABEL={aprovar:'✓ Aprovar',recusar:'Recusar',reabrir:'Reabrir',pausar:'Pausar',retomar:'Retomar',concluir:'✓ Concluir',cancelar:'Cancelar projeto'};
var PJ_ACAO_STATUS={aprovar:'aprovada',recusar:'recusada',reabrir:'avaliacao',pausar:'pausada',retomar:'execucao',concluir:'concluida',cancelar:'cancelada'};
function pjPedirComentario(titulo){
  return modalConfirm(titulo,
    '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">Comentário (obrigatório)</div>'+
    '<textarea class="form-input" id="pj-coment" rows="3"></textarea>','Confirmar','btn-primary'
  ).then(function(ok){
    if(!ok)return null;
    var t=(document.getElementById('pj-coment').value||'').trim();
    if(!t){toast('O comentário é obrigatório','err');return null}
    return t;
  });
}
async function pjAcao(id,acao){
  var p=projById(id);
  if(!p||!can('gerir_projetos'))return;
  if((PJ_ACOES[p.status]||[]).indexOf(acao)===-1)return;
  var coment=null;
  if(acao==='recusar'||acao==='cancelar'){
    coment=await pjPedirComentario(acao==='recusar'?'Recusar ideia':'Cancelar projeto');
    if(coment===null)return;
  }
  try{
    await projMudarStatus(p,PJ_ACAO_STATUS[acao],coment);
    renderProjetos();if(_pjAberto===id)pjAbrir(id);
    toast(PJ_STATUS[p.status]);
  }catch(e){toast('Erro: '+e.message,'err')}
}
var _pjAberto=null;
```

- [ ] **Step 5: Verificar** (8080). Como admin: crie uma ideia sem notas; ela aparece com "—" no fim. Edite e dê as 3 notas mais 50h: o status vira "Em avaliação" e a prioridade aparece. Marque urgência 5 + Legal: a ideia sobe para o topo. Confirme também que o comentário digitado no `modalConfirm` ainda pode ser lido depois de fechar. No console: `await pjAcao('<id>','recusar')` → o comentário é pedido. Se `#pj-coment` vier vazio depois de fechar o modal, guarde o valor num `oninput` em vez de ler depois.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(projetos): backlog de ideias com pontuacao e decisoes"
```

---

### Task 10: Aba Projetos (quadro por etapa)

**Files:**
- Modify: `index.html`: substituir o stub `renderPjQuadro` na seção `PROJETOS: tela`.

**Interfaces:**
- Consumes: `PJ`, `projEtapasAtivas`, `projEtapa`, `projPapel`, `projConfigs`, `projEventos`, `projMoverEtapa`, `ProjCore.calcPrioridade`, `ProjCore.diasNaEtapaAtual`, `S.oss`, `S_USERS`, `hojeLocal`, `fmtDate`.
- Produces: `renderPjQuadro()`, `pjCard(p)`, `pjResponsavel(p, etapaId) → string`, `pjAlvo(data) → {txt, cor}|null`, `pjDragOver`, `pjDrop`. `pjResponsavel` e `pjAlvo` também são usados pela Task 11.

- [ ] **Step 1: Implementar**

```js
var _pjMostrarFechados=false;
function pjResponsavel(p,etapaId){
  var et=projEtapa(etapaId);if(!et)return'';
  var papel=projPapel(et.papel_id);
  var c=projConfigs(p.id).find(function(x){return x.etapa_id===etapaId});
  var nome='';
  if(c&&c.responsavel_user_id){
    var u=S_USERS.find(function(x){return x.id===c.responsavel_user_id});
    nome=u?u.displayName:((c.responsavel_nome||'?')+' (ex-membro)');
  }else if(c&&c.responsavel_nome)nome=c.responsavel_nome;
  return(papel?papel.nome:'')+(nome?' · '+nome:'');
}
function pjAlvo(d){
  if(!d)return null;
  var dias=Math.round((new Date(d+'T12:00:00')-new Date(hojeLocal()+'T12:00:00'))/86400000);
  var cor=dias<0?'var(--red-text)':dias<=7?'var(--amber-text)':'var(--muted)';
  return{txt:fmtDate(d)+(dias<0?' · atrasado':dias<=7?' · faltam '+dias+'d':''),cor:cor};
}
function pjCard(p){
  var oss=S.oss.filter(function(o){return o.projetoId===p.id});
  var conc=oss.filter(function(o){return o.status==='concluido'}).length;
  var est=ProjCore.calcPrioridade(p,projConfigs(p.id)).horas;
  if(!est)est=oss.reduce(function(a,o){return a+(+o.estimatedHours||0)},0);
  var apr=PJ.horasTot[p.id]||0;
  var resp=p.etapa_id?pjResponsavel(p,p.etapa_id):'';
  var dias=p.status==='execucao'||p.status==='pausada'?ProjCore.diasNaEtapaAtual(projEventos(p.id)):null;
  var alvo=pjAlvo(p.data_alvo);
  var drag=can('gerir_projetos')&&p.status==='execucao';
  var et=projEtapa(p.etapa_id);
  var avisos=[];
  if(p.status==='pausada'&&oss.some(function(o){return o.status==='andamento'}))avisos.push('OS em andamento com o projeto pausado');
  if(et&&et.ativo===false)avisos.push('Etapa desativada no fluxo: mova o projeto');
  return'<div class="pj-card" '+(drag?'draggable="true" ondragstart="event.dataTransfer.setData(\'text/plain\',\''+p.id+'\')"':'')+' onclick="pjAbrir(\''+p.id+'\')">'+
    '<div style="display:flex;justify-content:space-between;gap:6px"><div style="font-size:13px;font-weight:500;color:var(--text)">'+escHtml(p.titulo)+'</div>'+
      (p.status==='pausada'||p.status==='concluida'?'<span class="badge pj-badge-st">'+PJ_STATUS[p.status]+'</span>':'')+'</div>'+
    (resp?'<div style="font-size:11px;color:var(--muted);margin-top:4px">'+escHtml(resp)+'</div>':'')+
    (dias!==null?'<div style="font-size:11px;color:var(--hint)">há '+dias+' dia'+(dias===1?'':'s')+' nesta etapa</div>':'')+
    '<div class="pj-bar"><div style="width:'+(oss.length?Math.round(conc/oss.length*100):0)+'%"></div></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--hint)"><span>'+conc+'/'+oss.length+' OSs</span>'+
      '<span style="font-family:var(--mono)">'+apr.toFixed(1)+'h / '+(+est||0).toFixed(0)+'h</span></div>'+
    (alvo?'<div style="font-size:11px;margin-top:4px;color:'+alvo.cor+'">🎯 '+alvo.txt+'</div>':'')+
    avisos.map(function(a){return'<div style="font-size:11px;color:var(--amber-text);margin-top:4px">⚠ '+a+'</div>'}).join('')+
  '</div>';
}
function renderPjQuadro(){
  var el=document.getElementById('pj-tab-quadro');if(!el)return;
  var vis=PJ.projetos.filter(function(p){
    return p.status==='aprovada'||p.status==='execucao'||(_pjMostrarFechados&&(p.status==='pausada'||p.status==='concluida'));
  });
  var etapas=projEtapasAtivas().concat(PJ.etapas.filter(function(e){
    return e.ativo===false&&vis.some(function(p){return p.etapa_id===e.id&&p.status!=='aprovada'});
  }));
  var cols=[{id:'',nome:'Aguardando início',papel:null}].concat(etapas.map(function(e){
    return{id:e.id,nome:e.nome+(e.ativo===false?' (desativada)':''),papel:projPapel(e.papel_id)};
  }));
  var gerir=can('gerir_projetos');
  el.innerHTML=
    '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">'+
      '<label class="form-check" style="margin:0"><input type="checkbox" '+(_pjMostrarFechados?'checked':'')+' onchange="_pjMostrarFechados=this.checked;renderPjQuadro()" style="width:15px;height:15px;accent-color:var(--accent)"><span class="form-check-label">Mostrar pausados e concluídos</span></label>'+
    '</div>'+
    '<div class="pj-board">'+cols.map(function(c){
      var itens=vis.filter(function(p){return c.id===''?(p.status==='aprovada'||!p.etapa_id):(p.status!=='aprovada'&&p.etapa_id===c.id)});
      var dnd=gerir&&c.id?' data-etapa="'+c.id+'" ondragover="pjDragOver(event,this)" ondragleave="this.classList.remove(\'drop\')" ondrop="pjDrop(event,this)"':'';
      return'<div class="pj-col"'+dnd+'>'+
        '<div class="kanban-col-header"><span class="kanban-col-title">'+escHtml(c.nome)+'</span><span class="kanban-col-count">'+itens.length+'</span></div>'+
        (c.papel?'<div style="font-size:10px;color:var(--hint);margin:-6px 0 8px">'+escHtml(c.papel.nome)+'</div>':'')+
        '<div class="kanban-col-body">'+(itens.map(pjCard).join('')||'<div class="empty-col">—</div>')+'</div>'+
      '</div>';
    }).join('')+'</div>';
}
function pjDragOver(ev,col){ev.preventDefault();col.classList.add('drop')}
async function pjDrop(ev,col){
  ev.preventDefault();col.classList.remove('drop');
  var p=projById(ev.dataTransfer.getData('text/plain'));
  if(!p||p.status!=='execucao'||!can('gerir_projetos'))return;
  try{
    await projMoverEtapa(p,col.getAttribute('data-etapa'));
    renderPjQuadro();toast('Etapa: '+projEtapa(p.etapa_id).nome);
  }catch(e){toast('Erro: '+e.message,'err')}
}
```

- [ ] **Step 2: Verificar** (8080). Aprove uma ideia: ela aparece em "Aguardando início". No console, `await projMudarStatus(projById('<id>'),'execucao','teste')` → o projeto vai para "Especificação" e mostra "há 0 dias". Arraste para Desenvolvimento e depois de volta para Especificação: o 2º evento é `retorno` (`projEventos('<id>')`). Uma data-alvo vencida aparece em vermelho.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(projetos): quadro de projetos por etapa com arraste"
```

---

### Task 11: Painel de detalhe do projeto

**Files:**
- Modify: `index.html`: `<div class="pj-drawer" id="pj-drawer"></div>` logo antes de `<!-- MODAL IDEIA DE PROJETO -->`; na seção `PROJETOS: tela`, substituir o stub `pjAbrir` e acrescentar as funções.

**Interfaces:**
- Consumes: tudo das Tasks 7, 9 e 10; RPC `projeto_horas_agregadas` (Task 6); `ProjCore.horasPorEtapa`, `ProjCore.tempoPorPapel`; `S.versoes`; `S.oss`.
- Produces: `pjAbrir(id)`, `pjFechar()`, `pjSetCampo(id, campo, valor)`, `pjSetConfig(pid, etapaId, campo, valor)`, `pjComentar(id)`, `pjVincularOS(osId, projetoId)` (também usada pela Task 12), `pjPodeMexerNaOS(os)`.

- [ ] **Step 1: Drawer e render**

```js
function pjFechar(){_pjAberto=null;document.getElementById('pj-drawer').classList.remove('open')}
function pjPodeMexerNaOS(os){return can('gerir_projetos')||(os&&os.createdBy===CURRENT_USER.id)}
function pjEventoTexto(e){
  if(e.tipo==='status')return(e.de?PJ_STATUS[e.de]+' → ':'')+(PJ_STATUS[e.para]||e.para);
  if(e.tipo==='etapa'||e.tipo==='retorno'){var et=projEtapa(e.para);return(e.tipo==='retorno'?'↩ Retorno para ':'Etapa: ')+(et?et.nome:'?')}
  if(e.tipo==='vinculo_os')return e.para?'Vinculada '+e.para.replace('os:','OS '):'Desvinculada '+String(e.de||'').replace('os:','OS ');
  return'Comentário';
}
function pjAbrir(id){
  var p=projById(id);if(!p)return;
  _pjAberto=id;
  var gerir=can('gerir_projetos');
  var c=ProjCore.calcPrioridade(p,projConfigs(id));
  var acoes=gerir?(PJ_ACOES[p.status]||[]).map(function(a){
    return'<button class="btn btn-sm '+(a==='aprovar'||a==='concluir'?'btn-primary':'btn-ghost')+'" onclick="pjAcao(\''+id+'\',\''+a+'\')">'+PJ_ACAO_LABEL[a]+'</button>';
  }).join(' '):'';
  var emFluxo=['aprovada','execucao','pausada','concluida'].indexOf(p.status)>-1;
  var html=
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'+
      '<div><div style="font-size:17px;font-weight:600;color:var(--text)">'+escHtml(p.titulo)+'</div>'+
      '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="badge pj-badge-st">'+PJ_STATUS[p.status]+'</span>'+(p.legal?'<span class="badge pj-badge-legal">Legal</span>':'')+
      '<span class="badge pj-badge-st">Prioridade '+(c.prioridade===null?'—':c.prioridade.toFixed(1))+'</span></div></div>'+
      '<button class="btn btn-sm btn-ghost" onclick="pjFechar()">✕</button>'+
    '</div>'+
    '<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">'+
      (pjPodeEditarIdeia(p)?'<button class="btn btn-sm btn-ghost" onclick="openPjIdeia(\''+id+'\')">✏ Editar ideia e notas</button>':'')+acoes+
    '</div>'+
    (p.descricao?'<div style="margin-top:12px;font-size:13px;color:var(--muted);white-space:pre-wrap">'+escHtml(p.descricao)+'</div>':'')+
    '<div class="pj-sec"><div class="pj-sec-title">Dados</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<div class="form-group"><label class="form-label">Data-alvo</label><input type="date" class="form-input" value="'+(p.data_alvo||'')+'" '+(gerir?'':'disabled')+' onchange="pjSetCampo(\''+id+'\',\'data_alvo\',this.value||null)"></div>'+
        '<div class="form-group"><label class="form-label">Pai no Redmine</label><input class="form-input" value="'+escHtml(p.pai_redmine||'')+'" placeholder="nº da tarefa-pai" '+(gerir?'':'disabled')+' onchange="pjSetCampo(\''+id+'\',\'pai_redmine\',this.value.trim()||null)"></div>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--hint)">Notas: '+(c.valor!==null?'Impacto '+p.nota_impacto+' · Urgência '+p.nota_urgencia+' · Alinhamento '+p.nota_alinhamento+' (valor '+c.valor+')':'—')+
        ' · Esforço: '+(c.tamanho?c.tamanho+(c.horas?' ('+c.horas+'h)':''):'—')+'</div>'+
    '</div>'+
    '<div class="pj-sec"><div class="pj-sec-title">Fluxo do projeto</div><div id="pj-fluxo-'+id+'">'+pjFluxoHtml(p,null)+'</div></div>'+
    (emFluxo?'<div class="pj-sec"><div class="pj-sec-title">Tempo por papel</div>'+pjTempoHtml(p)+'</div>':'')+
    (emFluxo?'<div class="pj-sec"><div class="pj-sec-title">OSs vinculadas</div>'+pjOSsHtml(p)+'</div>':'')+
    '<div class="pj-sec"><div class="pj-sec-title">Linha do tempo</div>'+
      '<div style="display:flex;gap:6px;margin-bottom:10px"><input class="form-input" id="pj-novo-coment" placeholder="Comentar…"><button class="btn btn-sm" onclick="pjComentar(\''+id+'\')">Enviar</button></div>'+
      pjTimelineHtml(p)+
    '</div>';
  var dr=document.getElementById('pj-drawer');dr.innerHTML=html;dr.classList.add('open');
  if(emFluxo)pjCarregarRealizado(p);
}
```

- [ ] **Step 2: Fluxo (responsável, horas estimadas, pulada, realizado)**

```js
function pjFluxoHtml(p,real){
  var gerir=can('gerir_projetos');
  var etapas=projEtapasAtivas();
  var linhas=etapas.map(function(e){
    var c=projConfigs(p.id).find(function(x){return x.etapa_id===e.id})||{};
    var papel=projPapel(e.papel_id);
    var atual=p.etapa_id===e.id;
    var userOpts='<option value="">— usuário —</option>'+S_USERS.map(function(u){
      return'<option value="'+u.id+'"'+(c.responsavel_user_id===u.id?' selected':'')+'>'+escHtml(u.displayName)+'</option>';
    }).join('');
    var est=+c.horas_estimadas||0;
    var rea=real?(real.porEtapa[e.id]||0):null;
    var pct=rea!==null&&est>0?Math.round(rea/est*100):null;
    var resp=gerir
      ?'<select class="form-input" style="padding:3px 6px;font-size:11px" onchange="pjSetConfig(\''+p.id+'\',\''+e.id+'\',\'responsavel_user_id\',this.value||null)">'+userOpts+'</select>'+
        (c.responsavel_user_id?'':'<input class="form-input" style="padding:3px 6px;font-size:11px;margin-top:3px" placeholder="ou nome livre" value="'+escHtml(c.responsavel_nome||'')+'" onchange="pjSetConfig(\''+p.id+'\',\''+e.id+'\',\'responsavel_nome\',this.value.trim()||null)">')
      :escHtml(pjResponsavel(p,e.id).split(' · ')[1]||'—');
    return'<tr style="'+(c.pulada?'opacity:.45;':'')+(atual?'background:var(--card2);':'')+'">'+
      '<td>'+(atual?'▶ ':'')+escHtml(e.nome)+'<div style="font-size:10px;color:var(--hint)">'+escHtml(papel?papel.nome:'')+(papel&&papel.externo?' (externo)':'')+'</div></td>'+
      '<td>'+resp+'</td>'+
      '<td style="width:64px">'+(gerir?'<input type="number" min="0" step="1" class="form-input" style="padding:3px 6px;font-size:11px;width:58px" value="'+est+'" onchange="pjSetConfig(\''+p.id+'\',\''+e.id+'\',\'horas_estimadas\',parseFloat(this.value)||0)">':est+'h')+'</td>'+
      '<td style="font-family:var(--mono);white-space:nowrap">'+(rea===null?'…':rea+'h'+(pct!==null?' <span style="color:'+(pct>100?'var(--red-text)':'var(--hint)')+'">('+pct+'%)</span>':''))+'</td>'+
      '<td style="width:40px;text-align:center">'+(gerir?'<input type="checkbox" title="Pular etapa neste projeto" '+(c.pulada?'checked':'')+' onchange="pjSetConfig(\''+p.id+'\',\''+e.id+'\',\'pulada\',this.checked)" style="accent-color:var(--accent)">':(c.pulada?'pulada':''))+'</td>'+
    '</tr>';
  }).join('');
  var sem=real&&real.semEtapa?'<tr><td colspan="3" style="color:var(--hint)">Sem etapa</td><td style="font-family:var(--mono)">'+real.semEtapa+'h</td><td></td></tr>':'';
  var mover=gerir&&p.status==='execucao'?'<div style="margin-top:8px;display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted)">Mover para '+
    '<select class="form-input" style="width:auto;padding:3px 6px;font-size:12px" onchange="pjMoverPeloPainel(\''+p.id+'\',this.value)"><option value="">—</option>'+
    etapas.map(function(e){return'<option value="'+e.id+'">'+escHtml(e.nome)+'</option>'}).join('')+'</select></div>':'';
  return'<table class="pj-tbl"><tr><th>Etapa</th><th>Responsável</th><th>Estim.</th><th>Realizado</th><th>Pular</th></tr>'+linhas+sem+'</table>'+
    (real?'<div style="font-size:11px;color:var(--hint);margin-top:4px">Total apropriado: '+real.total+'h</div>':'')+mover;
}
async function pjCarregarRealizado(p){
  var r=await sb.rpc('projeto_horas_agregadas',{p_projeto_id:p.id});
  if(r.error){console.warn(r.error);return}
  var real=ProjCore.horasPorEtapa(r.data||[],projEventos(p.id),PJ.etapas);
  var box=document.getElementById('pj-fluxo-'+p.id);
  if(box&&_pjAberto===p.id)box.innerHTML=pjFluxoHtml(p,real);
}
async function pjMoverPeloPainel(id,etapaId){
  var p=projById(id);if(!p||!etapaId)return;
  try{await projMoverEtapa(p,etapaId);renderProjetos();pjAbrir(id)}catch(e){toast('Erro: '+e.message,'err')}
}
async function pjSetConfig(pid,etapaId,campo,valor){
  var atual=PJ.configs.find(function(x){return x.projeto_id===pid&&x.etapa_id===etapaId});
  var row=Object.assign({workspace_id:CURRENT_WORKSPACE_ID,projeto_id:pid,etapa_id:etapaId,horas_estimadas:0,pulada:false,responsavel_user_id:null,responsavel_nome:null},atual||{});
  row[campo]=valor;
  // Ao escolher um usuário, o nome fica guardado para aparecer como ex-membro se ele sair do workspace
  if(campo==='responsavel_user_id'){var u=S_USERS.find(function(x){return x.id===valor});row.responsavel_nome=u?u.displayName:null}
  if(campo==='responsavel_nome')row.responsavel_user_id=null;
  var r=await sb.from('projeto_etapa_config').upsert(row,{onConflict:'projeto_id,etapa_id'}).select().single();
  if(r.error){toast('Erro: '+r.error.message,'err');return}
  if(atual)Object.assign(atual,r.data);else PJ.configs.push(r.data);
  var p=projById(pid);
  if(campo==='horas_estimadas')await projAtualizarPrioridade(p);
  renderProjetos();pjAbrir(pid);
}
async function pjSetCampo(id,campo,valor){
  var p=projById(id);if(!p||!can('gerir_projetos'))return;
  var campos={};campos[campo]=valor;
  try{await projSalvar(p,campos);renderProjetos();toast('Salvo')}catch(e){toast('Erro: '+e.message,'err')}
}
```

- [ ] **Step 3: Tempo por papel, OSs, linha do tempo, comentário e vínculo**

```js
function pjTempoHtml(p){
  var t=ProjCore.tempoPorPapel(projEventos(p.id));
  var partes=Object.keys(t.dias).map(function(pid){var pp=projPapel(pid);return(pp?escHtml(pp.nome):'?')+' '+t.dias[pid]+'d'});
  return'<div style="font-size:13px;color:var(--text)">'+(partes.join(' · ')||'—')+'</div>'+
    '<div style="font-size:11px;color:var(--hint);margin-top:2px">'+t.retornos+' retorno'+(t.retornos===1?'':'s')+'</div>';
}
function pjOSsHtml(p){
  var oss=S.oss.filter(function(o){return o.projetoId===p.id});
  var porVersao={};
  oss.forEach(function(o){(porVersao[o.versaoId]=porVersao[o.versaoId]||[]).push(o)});
  var grupos=Object.keys(porVersao).map(function(vid){
    var v=S.versoes.find(function(x){return x.id===vid});
    return'<div style="font-size:11px;color:var(--hint);margin:8px 0 4px">'+escHtml(v?v.nome:'Sem versão')+'</div>'+
      porVersao[vid].map(function(o){
        return'<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0">'+
          '<span style="font-family:var(--mono);color:var(--muted)">#'+escHtml(o.num)+'</span>'+
          '<span style="flex:1;color:var(--text)">'+escHtml(o.titulo)+'</span>'+
          '<span class="badge pj-badge-st">'+statusLabel(o.status)+'</span>'+
          (pjPodeMexerNaOS(o)?'<span style="cursor:pointer;color:var(--hint)" title="Desvincular" onclick="pjVincularOS(\''+o.id+'\',null)">×</span>':'')+
        '</div>';
      }).join('');
  }).join('');
  var candidatas=ProjCore.aceitaOS(p.status)?S.oss.filter(function(o){return o.projetoId!==p.id&&pjPodeMexerNaOS(o)}):[];
  var sel=candidatas.length?'<div style="display:flex;gap:6px;margin-top:10px"><select class="form-input" id="pj-vinc-sel" style="font-size:12px"><option value="">Vincular OS…</option>'+
    candidatas.map(function(o){return'<option value="'+o.id+'">#'+escHtml(o.num)+' '+escHtml(o.titulo)+(o.projetoId?' (em outro projeto)':'')+'</option>'}).join('')+
    '</select><button class="btn btn-sm" onclick="var v=document.getElementById(\'pj-vinc-sel\').value;if(v)pjVincularOS(v,\''+p.id+'\')">Vincular</button></div>':'';
  return(grupos||'<div style="font-size:12px;color:var(--hint)">Nenhuma OS vinculada.</div>')+sel;
}
function pjTimelineHtml(p){
  return projEventos(p.id).slice().reverse().map(function(e){
    var u=S_USERS.find(function(x){return x.id===e.autor_id});
    var quando=new Date(e.criado_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
    return'<div style="border-left:2px solid var(--border2);padding:2px 0 8px 10px;font-size:12px">'+
      '<div style="color:var(--text)">'+escHtml(pjEventoTexto(e))+'</div>'+
      (e.comentario?'<div style="color:var(--muted);white-space:pre-wrap">'+escHtml(e.comentario)+'</div>':'')+
      '<div style="font-size:10px;color:var(--hint)">'+quando+(u?' · '+escHtml(u.displayName):'')+'</div>'+
    '</div>';
  }).join('')||'<div style="font-size:12px;color:var(--hint)">Sem eventos.</div>';
}
async function pjComentar(id){
  var inp=document.getElementById('pj-novo-coment');var t=(inp.value||'').trim();if(!t)return;
  try{await projEvento(id,'comentario',null,null,t);pjAbrir(id)}catch(e){toast('Erro: '+e.message,'err')}
}
// projetoId null = desvincular (marca para o pai do Redmine não revincular)
async function pjVincularOS(osId,projetoId){
  var os=S.oss.find(function(o){return o.id===osId});if(!os||!pjPodeMexerNaOS(os))return;
  if(projetoId&&!ProjCore.aceitaOS((projById(projetoId)||{}).status)){toast('Este projeto não aceita OS no status atual','err');return}
  var antigo=os.projetoId||null;
  var campos={projeto_id:projetoId,projeto_desvinculado:!projetoId&&!!antigo};
  var {error}=await sb.from('oss').update(campos).eq('id',osId);
  if(error){toast('Erro: '+error.message,'err');return}
  os.projetoId=projetoId;os.projetoDesvinculado=campos.projeto_desvinculado;
  await projRegistrarVinculo(os,antigo,projetoId,null);
  _projNotificarOS(osId,{status:os.status,projetoId:projetoId});
  renderProjetos();if(_pjAberto)pjAbrir(_pjAberto);
  if(document.getElementById('screen-kanban').classList.contains('active'))renderKanban();
}
```
Remova o stub `function pjAbrir(id){openPjIdeia(id)}` da Task 9. Adicione o drawer no HTML: `<div class="pj-drawer" id="pj-drawer"></div>`.

- [ ] **Step 4: Verificar** (8080). Abra um projeto em execução. Informe 15h em Especificação e 20h em Desenvolvimento: a prioridade recalcula e o tamanho vira M. Vincule uma OS com horas apropriadas: a coluna "Realizado" mostra as horas na etapa certa. Escolha um usuário como responsável: o cartão mostra "Papel · Nome". Escreva um comentário: ele aparece no topo da linha do tempo. Desvincule a OS: `S.oss.find(o=>o.id==='<id>').projetoDesvinculado === true`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(projetos): painel de detalhe com fluxo, horas, tempo por papel e historico"
```

---

### Task 12: Integração com a OS: modal, cartão e pai do Redmine

**Files:**
- Modify: `index.html`: `modal-os` (~1427, depois da linha "Link + Obs"), `openNovaOS`/`openEditOS` (~3217-3245), `salvarOS` (~3247), o cartão do Kanban (~3160, `badgeAtribuicao`) e a importação do Redmine (~8371-8401).

**Interfaces:**
- Consumes: `PJ`, `projById`, `ProjCore.aceitaOS`, `ProjCore.vinculoPorPai`, `projRegistrarVinculo`, `_projNotificarOS` (via `dbSalvarOS`).
- Produces: `populateProjetoSelOS(os)`, o select `#os-projeto` e o selo de projeto no cartão.

- [ ] **Step 1: Campo no modal.** Depois do bloco `<!-- Link + Obs -->`:

```html
    <div class="form-group" id="os-projeto-wrap" style="display:none">
      <label class="form-label">Projeto</label>
      <select class="form-input" id="os-projeto"></select>
      <div id="os-projeto-hint" style="font-size:11px;color:var(--hint);margin-top:4px"></div>
    </div>
```

- [ ] **Step 2: Popular o select.** Perto de `populateVersaoSelOS`:

```js
function populateProjetoSelOS(os){
  var wrap=document.getElementById('os-projeto-wrap');
  if(!PJ.ok){wrap.style.display='none';return}
  wrap.style.display='';
  var atual=os&&os.projetoId?os.projetoId:'';
  var lista=PJ.projetos.filter(function(p){return ProjCore.aceitaOS(p.status)||p.id===atual});
  document.getElementById('os-projeto').innerHTML='<option value="">(nenhum)</option>'+
    lista.map(function(p){return'<option value="'+p.id+'">'+escHtml(p.titulo)+'</option>'}).join('');
  document.getElementById('os-projeto').value=atual;
  var p=atual?projById(atual):null;
  document.getElementById('os-projeto-hint').textContent=(p&&os.paiRedmine&&String(p.pai_redmine)===String(os.paiRedmine))
    ?'Vinculado pelo pai #'+os.paiRedmine+' do Redmine':'';
}
```
Em `openNovaOS`, depois de `populateAtribSel(nomeAtual);`: `populateProjetoSelOS(null);`. Em `openEditOS`, depois de `populateAtribSel(...)`: `populateProjetoSelOS(os);`.

- [ ] **Step 3: Gravar o vínculo no `salvarOS`.** Substitua a linha de `projetoId` que a Task 7 acrescentou ao `data` por:

```js
    ,projetoId:(PJ.ok?(document.getElementById('os-projeto').value||null):(old?old.projetoId||null:null))
```
Depois do objeto `data`, antes de `dbSalvarOS(data)`:
```js
  var projAntigo=old?old.projetoId||null:null;
  // Soltar à mão marca a OS para o pai do Redmine não revincular; escolher um projeto limpa a marca
  data.projetoDesvinculado=data.projetoId?false:(projAntigo?true:(old?!!old.projetoDesvinculado:false));
```
No `.then(function(saved){`, depois de atualizar `S.oss`:
```js
    projRegistrarVinculo(data,projAntigo,data.projetoId,null);
```

- [ ] **Step 4: Selo no cartão do Kanban.** Depois de `(os.atribuicao?badgeAtribuicao(os.atribuicao):'')+`:

```js
              (os.projetoId&&projById(os.projetoId)?'<span class="badge" style="background:var(--accent-glow);color:var(--accent)" title="Projeto">◆ '+escHtml(projById(os.projetoId).titulo.slice(0,24))+'</span>':'')+
```

- [ ] **Step 5: Pai do Redmine na importação/sincronização.** Antes de `await dbSalvarOS(novaOS);` (~8384):

```js
      var pvNova=PJ.ok?ProjCore.vinculoPorPai(novaOS,PJ.projetos):null;
      if(pvNova)novaOS.projetoId=pvNova;
```
E depois de `S.oss.push(novaOS);`:
```js
      if(pvNova)await projRegistrarVinculo(novaOS,null,pvNova,'Automático pelo pai #'+novaOS.paiRedmine+' do Redmine');
```
No laço de `atualizadas`, antes de `await dbSalvarOS(S.oss[idx]);`:
```js
      var pvUpd=PJ.ok?ProjCore.vinculoPorPai(S.oss[idx],PJ.projetos):null;
      if(pvUpd)S.oss[idx].projetoId=pvUpd;
```
E depois de `await dbSalvarOS(S.oss[idx]);`:
```js
      if(pvUpd)await projRegistrarVinculo(S.oss[idx],null,pvUpd,'Automático pelo pai #'+S.oss[idx].paiRedmine+' do Redmine');
```

- [ ] **Step 6: Verificar** (8080).
  1. Vincule uma OS em "A fazer" a um projeto Aprovado pelo modal; o cartão mostra "◆ título". Mova a OS para Em andamento: aparece o toast "Projeto … → Em execução", e o projeto está na 1ª etapa.
  2. Conclua o projeto. Edite outra OS e vincule ao mesmo projeto: ele volta para Em execução.
  3. Pause o projeto e mova uma OS dele para andamento: o status **não** muda, e o cartão mostra o aviso.
  4. Ponha `pai_redmine` num projeto em execução e importe do Redmine uma OS com esse pai: ela vem vinculada. Desvincule a OS e sincronize de novo: ela **não** volta.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(projetos): campo Projeto na OS, selo no kanban e vinculo pelo pai do Redmine"
```

---

### Task 13: Editor do fluxo em Preferências › Plataforma

**Files:**
- Modify: `index.html`: um bloco novo no início de `<div id="pref-tab-plataforma">` (~1003), `goPrefsTab` (~2717) e funções novas na seção `PROJETOS: tela`.

**Interfaces:**
- Consumes: `PJ`, `projEtapa`, `getTipoAtividades()` (`[{id, name}]`), `isAdmin()`.
- Produces: `renderFluxoProjetosPrefs()`, `fluxoUpd(tabela, id, campos)`, `fluxoNovoPapel()`, `fluxoNovaEtapa()`, `fluxoMover(id, dir)`, `fluxoToggleTipo(etapaId, tipoId, on)`.

- [ ] **Step 1: HTML.** Logo depois de `<div id="pref-tab-plataforma" style="display:none">`:

```html
          <div class="pref-section" id="pref-fluxo-projetos" style="display:none"></div>
```

- [ ] **Step 2: Chamar o render.** Em `goPrefsTab`, depois de `if(nome==='plataforma')loadRedmineProdOpts().then(renderProdutos);`:

```js
  if(nome==='plataforma')renderFluxoProjetosPrefs();
```

- [ ] **Step 3: Implementar**

```js
// ── PROJETOS: editor do fluxo (admin) ───────────────────────────────────────
function renderFluxoProjetosPrefs(){
  var box=document.getElementById('pref-fluxo-projetos');if(!box)return;
  if(!PJ.ok||!isAdmin()){box.style.display='none';return}
  box.style.display='';
  var tipos=getTipoAtividades().filter(function(t){return t.id!=null});
  var papeis=PJ.papeis.slice().sort(function(a,b){return a.ordem-b.ordem});
  var etapas=PJ.etapas.slice().sort(function(a,b){return a.ordem-b.ordem});
  var htmlPapeis=papeis.map(function(pp){
    return'<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">'+
      '<input class="form-input" style="flex:1" value="'+escHtml(pp.nome)+'" onchange="fluxoUpd(\'projeto_papeis\',\''+pp.id+'\',{nome:this.value.trim()||\'Papel\'})">'+
      '<label style="font-size:12px;color:var(--muted);display:flex;gap:4px;align-items:center"><input type="checkbox" '+(pp.externo?'checked':'')+' onchange="fluxoUpd(\'projeto_papeis\',\''+pp.id+'\',{externo:this.checked})" style="accent-color:var(--accent)">externo</label>'+
    '</div>';
  }).join('');
  var htmlEtapas=etapas.map(function(e,i){
    var papelOpts=papeis.map(function(pp){return'<option value="'+pp.id+'"'+(pp.id===e.papel_id?' selected':'')+'>'+escHtml(pp.nome)+'</option>'}).join('');
    var chips=tipos.map(function(t){
      var tid=String(t.id),meu=(e.tipos_atividade||[]).indexOf(tid)>-1;
      var dono=!meu&&etapas.find(function(o){return o.id!==e.id&&o.ativo!==false&&(o.tipos_atividade||[]).indexOf(tid)>-1});
      return'<label style="font-size:11px;display:inline-flex;gap:3px;align-items:center;margin:2px 8px 2px 0;color:'+(dono?'var(--hint)':'var(--muted)')+'" title="'+(dono?'Já ligado a '+escHtml(dono.nome):'')+'">'+
        '<input type="checkbox" '+(meu?'checked':'')+(dono?' disabled':'')+' onchange="fluxoToggleTipo(\''+e.id+'\',\''+tid+'\',this.checked)" style="accent-color:var(--accent)">'+escHtml(t.name)+'</label>';
    }).join('')||'<span style="font-size:11px;color:var(--hint)">Cadastre os tipos de atividade acima para ligar às etapas.</span>';
    return'<div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;'+(e.ativo===false?'opacity:.5':'')+'">'+
      '<div style="display:flex;gap:8px;align-items:center">'+
        '<span style="font-family:var(--mono);color:var(--hint);width:18px">'+(i+1)+'</span>'+
        '<input class="form-input" style="flex:1" value="'+escHtml(e.nome)+'" onchange="fluxoUpd(\'projeto_etapas\',\''+e.id+'\',{nome:this.value.trim()||\'Etapa\'})">'+
        '<select class="form-input" style="width:150px" onchange="fluxoUpd(\'projeto_etapas\',\''+e.id+'\',{papel_id:this.value})">'+papelOpts+'</select>'+
        '<button class="btn btn-sm btn-ghost" onclick="fluxoMover(\''+e.id+'\',-1)">↑</button>'+
        '<button class="btn btn-sm btn-ghost" onclick="fluxoMover(\''+e.id+'\',1)">↓</button>'+
        '<button class="btn btn-sm btn-ghost" onclick="fluxoUpd(\'projeto_etapas\',\''+e.id+'\',{ativo:'+(e.ativo===false)+'})">'+(e.ativo===false?'Reativar':'Desativar')+'</button>'+
      '</div>'+
      '<div style="margin:6px 0 0 26px">'+chips+'</div>'+
    '</div>';
  }).join('');
  box.innerHTML=
    '<div class="pref-section-title">Fluxo de projetos</div>'+
    '<div style="font-size:12px;color:var(--hint);margin-bottom:10px">Etapas por que todo projeto passa, com o papel responsável. Os tipos de atividade ligam as horas apropriadas à etapa. Desativar não apaga o histórico.</div>'+
    '<div style="display:grid;grid-template-columns:1fr 2fr;gap:16px">'+
      '<div><div class="pj-sec-title">Papéis</div>'+htmlPapeis+'<button class="btn btn-sm btn-ghost" onclick="fluxoNovoPapel()">+ Novo papel</button></div>'+
      '<div><div class="pj-sec-title">Etapas</div>'+htmlEtapas+'<button class="btn btn-sm btn-ghost" onclick="fluxoNovaEtapa()">+ Nova etapa</button></div>'+
    '</div>';
}
async function fluxoUpd(tabela,id,campos){
  var r=await sb.from(tabela).update(campos).eq('id',id).select().single();
  if(r.error){toast('Erro: '+r.error.message,'err');return}
  var arr=tabela==='projeto_papeis'?PJ.papeis:PJ.etapas;
  var i=arr.findIndex(function(x){return x.id===id});if(i>-1)arr[i]=r.data;
  renderFluxoProjetosPrefs();
}
async function fluxoNovoPapel(){
  var ordem=PJ.papeis.reduce(function(m,x){return Math.max(m,x.ordem)},0)+1;
  var r=await sb.from('projeto_papeis').insert({workspace_id:CURRENT_WORKSPACE_ID,nome:'Novo papel',ordem:ordem}).select().single();
  if(r.error){toast('Erro: '+r.error.message,'err');return}
  PJ.papeis.push(r.data);renderFluxoProjetosPrefs();
}
async function fluxoNovaEtapa(){
  var ordem=PJ.etapas.reduce(function(m,x){return Math.max(m,x.ordem)},0)+1;
  var papel=PJ.papeis[0];
  var r=await sb.from('projeto_etapas').insert({workspace_id:CURRENT_WORKSPACE_ID,nome:'Nova etapa',ordem:ordem,papel_id:papel?papel.id:null}).select().single();
  if(r.error){toast('Erro: '+r.error.message,'err');return}
  PJ.etapas.push(r.data);renderFluxoProjetosPrefs();
}
async function fluxoMover(id,dir){
  var lista=PJ.etapas.slice().sort(function(a,b){return a.ordem-b.ordem});
  var i=lista.findIndex(function(e){return e.id===id}),j=i+dir;
  if(i<0||j<0||j>=lista.length)return;
  var a=lista[i],b=lista[j],oa=a.ordem,ob=b.ordem;
  if(oa===ob)ob=oa+dir; // ordens iguais: força a troca
  await fluxoUpd('projeto_etapas',a.id,{ordem:ob});
  await fluxoUpd('projeto_etapas',b.id,{ordem:oa});
}
function fluxoToggleTipo(etapaId,tipoId,on){
  var e=projEtapa(etapaId);if(!e)return;
  var arr=(e.tipos_atividade||[]).map(String).filter(function(t){return t!==String(tipoId)});
  if(on)arr.push(String(tipoId));
  fluxoUpd('projeto_etapas',etapaId,{tipos_atividade:arr});
}
```

- [ ] **Step 4: Verificar** (8080, admin). Em Preferências › Plataforma aparece "Fluxo de projetos" com as 5 etapas. Renomeie uma etapa e recarregue: o nome persiste. Ligue o tipo "Análise" a Especificação: em Desenvolvimento ele aparece desabilitado. Desative uma etapa: um projeto que estava nela continua no quadro, numa coluna "(desativada)" e com aviso. Com um usuário não admin, a seção não aparece (e a RLS recusa a escrita).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(projetos): editor do fluxo de etapas e papeis"
```

---

### Task 14: Verificação final e deploy

**Files:** nenhum arquivo novo, a não ser correções que a verificação apontar.

- [ ] **Step 1: Testes automáticos**

Run: `node --test tests/`
Expected: PASS (15 testes)

- [ ] **Step 2: Conferir a RPC como membro** (console do app na 8080)

```js
await sb.rpc('projetos_horas_totais',{p_workspace_id:CURRENT_WORKSPACE_ID})
await sb.from('projeto_eventos').update({comentario:'x'}).eq('id',PJ.eventos[0].id).select()
```
Esperado: a 1ª devolve as linhas `{projeto_id, horas}` dos projetos com OS apropriada. A 2ª devolve `data: []`, ou seja, nenhum evento é alterado.

- [ ] **Step 3: Roteiro manual completo** (8080, login real, com o usuário): criar ideia → pontuar (vira Em avaliação) → aprovar → vincular OS → OS em andamento (vira Em execução na 1ª etapa) → mover etapas, incluindo um retorno → conferir tempo por papel e estimado × realizado → concluir → vincular OS nova (reabre). Repetir a parte de criar ideia e editar com um perfil sem `gerir_projetos`: só cria e edita as próprias ideias em "Ideia", sem os botões de decisão.

- [ ] **Step 4: Revisão do branch inteiro** com superpowers:requesting-code-review, sobre os commits desde `83e46b5`.

- [ ] **Step 5: Push, só com confirmação explícita do usuário e só depois de confirmar que as migrations 01 e 02 estão aplicadas em produção**

```bash
git push origin main
```
Depois do deploy: lembrar o usuário de marcar `Projetos` e `Gerir projetos` nos perfis que devem ter acesso (o admin já tem).
