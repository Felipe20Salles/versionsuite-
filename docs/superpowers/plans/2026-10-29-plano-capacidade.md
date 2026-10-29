# Plano por capacidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o módulo "Projetos" pelo **Plano**: demandas avaliadas por 4 critérios, estimadas por papel, decididas pela diretoria e distribuídas em cascata pelas versões conforme a capacidade de cada papel, com a tela de bolhas e potes do mockup.

**Architecture:** As regras puras (prioridade, faixas, estimativa, transições, cascata, repartição por papel, agregação do realizado, Redmine, resumo plano × realizado) ficam em `projetos-core.js` (`window.ProjCore`), testadas com `node --test`. O desenho das bolhas e dos potes, com a física, fica num arquivo novo `plano-viz.js` (`window.PlanoViz`), só DOM/SVG, sem Supabase. O `index.html` guarda estado (`PJ`), Supabase, ficha, preferências e versões. O banco ganha 2 migrations: esquema/RLS/trigger/migração de dados e a função de realizado agregado.

**Tech Stack:** HTML/CSS/JS vanilla ES5 (`var`/`function`), Supabase (Postgres + RLS + supabase-js v2), Node 24 (`node:test`), Netlify (deploy de `main`).

**Spec:** `docs/superpowers/specs/2026-10-28-plano-capacidade-design.md`
**Mockup de referência (visual, física, interação):** `.superpowers/brainstorm/82-1793221540/content/plano-no-vs-v4.html` (pasta ignorada pelo git; existe na máquina). Funções a portar estão citadas por nome nas tasks.

## Global Constraints

- ES5 em `index.html`, `projetos-core.js` e `plano-viz.js`: `var`, `function`, sem arrow functions, `let`/`const`, classes ou template strings, como o código ao redor. Os testes em `tests/` podem usar sintaxe moderna (já usam).
- Testes: `node --test tests/`.
- Migrations **idempotentes** (`if not exists`, `drop policy if exists` antes de `create policy`, `create or replace`). O **usuário** roda no SQL Editor e cola o resultado: o MCP do Supabase não tem acesso ao banco do VS (`lexgxlurnqbdytzzxkmv`).
- **Ordem de deploy:** as 2 migrations aplicadas em produção **antes** de qualquer push do `index.html` novo.
- Trabalho na branch `feature/plano-capacidade`. Commit por task. **Sem push** (push em `main` = deploy no Netlify); a integração é decidida no fim com `superpowers:finishing-a-development-branch`.
- Teste com login real só na **porta 8080**. Pergunte ao usuário como ele sobe o servidor.
- O VS é genérico: nenhum texto, cor ou ícone de ramo de cliente. Tokens do `:root` do `index.html` (`--accent`, `--surface`, `--card`, `--border`, DM Sans).
- Status da demanda (valores gravados): `triagem, pauta, plano, adiada, descartada, entregue`. Rótulos: Em triagem, Em pauta, No plano, Adiada, Descartada, Entregue. Filtros em pílula usam o plural: Adiadas, Descartadas.
- Botões de decisão, com estes textos: **Incluir no plano**, **Adiar**, **Descartar**. Destaque da grade: **Alto retorno, pouco esforço**.
- Critérios padrão (nome · pergunta · opções 0–3 · peso): Facilidade de execução · Há barreiras para fazer? · Bloqueada, Difícil, Possível, Simples · 1 | Alinhamento estratégico · Contribui com os objetivos? · Nenhum, Pouco, Bastante, Total · 2 | Impacto no negócio · Quanto melhora o resultado? · Nenhum, Baixo, Médio, Alto · 2 | Alcance · Quantos são beneficiados? · Poucos, Alguns, Muitos, Todos · 3.
- Faixas padrão: prioridade 0–8 baixa, 9–16 média, 17–24 alta; esforço Pequeno até 40h, Médio até 120h, Grande acima de 120h, Sem estimativa = 0h.
- Permissões: `can('gerir_projetos')` (rótulo novo "Gerir o plano") para avaliar, decidir, ordenar, capacidade, sincronizar, entregar/reabrir. Admin edita `plano_config`. Menu continua `canMenu('projetos')`, rótulo "Plano".
- Papel `externo` (Cliente) nunca entra em estimativa nem capacidade.
- Respeitar `prefers-reduced-motion`.

## Review Focus

1. **Versão com capacidade 0 ou sem linhas em `versao_capacidade`** (versão recém-criada): o pote aparece vazio com "0 de 0h", nada quebra (sem divisão por zero na escala), e tudo passa para a próxima versão. Teste na Task 2 (`distribuirPlano` com capacidade 0) e no fixture da Task 6.
2. **Realizado maior que o estimado**: a demanda ocupa 0h de restante, nunca negativo, e continua visível na versão ativa pelo arco do realizado. Teste na Task 2.
3. **Workspace sem linha em `plano_config`** (todo workspace novo): a tela usa os critérios e faixas padrão, e o admin cria a linha ao salvar. Teste na Task 1 (`configPlano(null)`).
4. **Ids de tracker e de tipo de atividade como número × string** (`9` × `'9'`): a hora cai no papel certo. Testes na Task 3.
5. **Projetos antigos migrados** (`avaliacao` sem critérios, horas só em `esforco_total_h`): viram demandas "Em pauta" sem prioridade, na linha "Sem avaliação", com as horas no papel padrão. Verificação SQL na Task 4.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `projetos-core.js` | Modificar | Regras puras do Plano. Remove as do backlog antigo na Task 9. |
| `tests/projetos-core.test.js` | Modificar | Testes das regras. |
| `plano-viz.js` | Criar | `window.PlanoViz`: grade de bolhas, potes com líquido e física, arrastar. Sem Supabase. |
| `tests/plano-viz.html` | Criar | Página de fixture que desenha grade e potes com dados fixos, para captura de tela. |
| `supabase/migrations/2026-10-29_01_plano.sql` | Criar | Colunas, tabelas, RLS, trigger, migração de status e horas. |
| `supabase/migrations/2026-10-29_02_plano_realizado.sql` | Criar | Função `plano_realizado` e RPC `plano_marcar_sync`. |
| `index.html` | Modificar | Estado `PJ`, tela Plano, ficha, preferências, versões, OS/kanban, Apresentar. |
| `scripts/importar-planilha-2026.py` | Criar | Script avulso: lê `2026.xlsx` e gera SQL de carga. |

---

### Task 1: Regras de avaliação, estimativa e status

**Files:**
- Modify: `projetos-core.js` (adicionar; não remover nada ainda)
- Test: `tests/projetos-core.test.js` (adicionar no fim)

**Interfaces:**
- Produces (todas em `ProjCore`):
  - `PLANO_PADRAO`: `{criterios:[{nome,pergunta,opcoes:[4 strings],peso}] x4, faixas_prioridade:{baixa_ate:8,media_ate:16}, faixas_esforco:{pequeno_ate:40,medio_ate:120}, papel_padrao_id:null, redmine_sync_em:null}`
  - `configPlano(row|null) -> config` (cópia do padrão com os campos não nulos da linha por cima)
  - `prioridade(crit:number[4]|null, criterios) -> number|null`
  - `faixaPrioridade(valor:number|null, faixas) -> 'alta'|'media'|'baixa'|null`
  - `faixaEsforco(horas:number, faixas) -> 'pequeno'|'medio'|'grande'|'sem'`
  - `papeisDoPlano(papeis) -> papel[]` (não externos, `ativo!==false`, por `ordem`)
  - `horasTotal(horasPapeis:[{papel_id,horas}]|null, papeis) -> number` (soma, ignorando papéis externos; papel inativo ou desconhecido conta)
  - `horasDoPapel(horasPapeis, papelId) -> number`
  - `definirHoras(horasPapeis, papelId, horas) -> novo array` (arredonda para 0,1; negativo ou inválido vira 0)
  - `situacaoEstimativa(horasPapeis, papeis) -> 'completa'|'parcial'|'sem'`
  - `STATUS`, `STATUS_ROTULO`, `podeMudarStatus(de, para) -> boolean`, `statusAposCriterios(status, crit) -> status`
  - `compararPlano(a, b)` sobre `{posicao, prioridade, pai_redmine, criado_em}`
  - `tituloPlano(versoes:[{data, ativa, planejada}]) -> string`
  - `ACEITA_OS` passa a `['plano','entregue']`; em `sugestoesPorPai`, `PROJ_ENCERRADO` passa a `['descartada']`.

- [ ] **Step 1: Escrever os testes**

```js
test('configPlano: sem linha usa o padrão; linha sobrepõe só o que veio', () => {
  const c = C.configPlano(null);
  assert.equal(c.criterios.length, 4);
  assert.deepEqual(c.criterios.map(x => x.peso), [1, 2, 2, 3]);
  assert.deepEqual(c.criterios[0].opcoes, ['Bloqueada', 'Difícil', 'Possível', 'Simples']);
  assert.deepEqual(c.faixas_prioridade, { baixa_ate: 8, media_ate: 16 });
  assert.deepEqual(c.faixas_esforco, { pequeno_ate: 40, medio_ate: 120 });
  const d = C.configPlano({ faixas_esforco: { pequeno_ate: 20, medio_ate: 80 }, criterios: null });
  assert.equal(d.faixas_esforco.pequeno_ate, 20);
  assert.equal(d.criterios.length, 4);
  c.criterios[0].peso = 99;
  assert.equal(C.configPlano(null).criterios[0].peso, 1);
});

test('prioridade: soma pontos × peso; nula se faltar critério', () => {
  const cr = C.PLANO_PADRAO.criterios;
  assert.equal(C.prioridade([3, 3, 3, 3], cr), 24);
  assert.equal(C.prioridade([3, 2, 2, 0], cr), 11);
  assert.equal(C.prioridade([0, 0, 0, 0], cr), 0);
  assert.equal(C.prioridade([3, null, 2, 0], cr), null);
  assert.equal(C.prioridade(null, cr), null);
});

test('faixaPrioridade e faixaEsforco nas bordas', () => {
  const fp = C.PLANO_PADRAO.faixas_prioridade, fe = C.PLANO_PADRAO.faixas_esforco;
  assert.equal(C.faixaPrioridade(8, fp), 'baixa');
  assert.equal(C.faixaPrioridade(9, fp), 'media');
  assert.equal(C.faixaPrioridade(16, fp), 'media');
  assert.equal(C.faixaPrioridade(17, fp), 'alta');
  assert.equal(C.faixaPrioridade(null, fp), null);
  assert.equal(C.faixaEsforco(0, fe), 'sem');
  assert.equal(C.faixaEsforco(40, fe), 'pequeno');
  assert.equal(C.faixaEsforco(40.5, fe), 'medio');
  assert.equal(C.faixaEsforco(120, fe), 'medio');
  assert.equal(C.faixaEsforco(121, fe), 'grande');
});

const PAPEIS = [
  { id: 'an', nome: 'Analista', externo: false, ordem: 1 },
  { id: 'cl', nome: 'Cliente', externo: true, ordem: 2 },
  { id: 'de', nome: 'Desenvolvedor', externo: false, ordem: 3 },
  { id: 'te', nome: 'Testador', externo: false, ordem: 4, ativo: false },
];

test('papeisDoPlano: sem externo nem inativo, por ordem', () => {
  assert.deepEqual(C.papeisDoPlano(PAPEIS).map(p => p.id), ['an', 'de']);
});

test('horasTotal ignora externo; inativo e desconhecido contam', () => {
  const h = [{ papel_id: 'an', horas: 10 }, { papel_id: 'cl', horas: 50 }, { papel_id: 'te', horas: 4 }, { papel_id: 'xx', horas: 1 }];
  assert.equal(C.horasTotal(h, PAPEIS), 15);
  assert.equal(C.horasTotal(null, PAPEIS), 0);
  assert.equal(C.horasDoPapel(h, 'an'), 10);
  assert.equal(C.horasDoPapel(h, 'de'), 0);
});

test('definirHoras: imutável, arredonda e não aceita negativo', () => {
  const h = [{ papel_id: 'an', horas: 10 }];
  const n = C.definirHoras(h, 'de', 7.26);
  assert.deepEqual(n, [{ papel_id: 'an', horas: 10 }, { papel_id: 'de', horas: 7.3 }]);
  assert.deepEqual(h, [{ papel_id: 'an', horas: 10 }]);
  assert.deepEqual(C.definirHoras(h, 'an', -3), [{ papel_id: 'an', horas: 0 }]);
  assert.deepEqual(C.definirHoras(h, 'an', 'x'), [{ papel_id: 'an', horas: 0 }]);
});

test('situacaoEstimativa olha só os papéis do plano', () => {
  assert.equal(C.situacaoEstimativa([], PAPEIS), 'sem');
  assert.equal(C.situacaoEstimativa([{ papel_id: 'an', horas: 5 }], PAPEIS), 'parcial');
  assert.equal(C.situacaoEstimativa([{ papel_id: 'an', horas: 5 }, { papel_id: 'de', horas: 1 }], PAPEIS), 'completa');
});

test('podeMudarStatus e statusAposCriterios', () => {
  assert.equal(C.podeMudarStatus('pauta', 'plano'), true);
  assert.equal(C.podeMudarStatus('adiada', 'descartada'), true);
  assert.equal(C.podeMudarStatus('plano', 'entregue'), true);
  assert.equal(C.podeMudarStatus('plano', 'adiada'), true);
  assert.equal(C.podeMudarStatus('entregue', 'plano'), true);
  assert.equal(C.podeMudarStatus('triagem', 'plano'), false);
  assert.equal(C.podeMudarStatus('descartada', 'plano'), false);
  assert.equal(C.podeMudarStatus('pauta', 'pauta'), false);
  assert.equal(C.statusAposCriterios('triagem', [1, 2, 3, 0]), 'pauta');
  assert.equal(C.statusAposCriterios('triagem', [1, null, 3, 0]), 'triagem');
  assert.equal(C.statusAposCriterios('plano', [1, 2, 3, 0]), 'plano');
});

test('compararPlano: posição, prioridade, pai do Redmine numérico, criação', () => {
  const itens = [
    { id: 'a', posicao: null, prioridade: 20, criado_em: '2026-01-01' },
    { id: 'b', posicao: 2, prioridade: 5, criado_em: '2026-01-01' },
    { id: 'c', posicao: 1, prioridade: 5, criado_em: '2026-01-01' },
    { id: 'd', posicao: 2, prioridade: 9, criado_em: '2026-01-01' },
    { id: 'e', posicao: null, prioridade: 20, pai_redmine: '900', criado_em: '2026-01-01' },
    { id: 'f', posicao: null, prioridade: 20, pai_redmine: '1000', criado_em: '2026-01-01' },
  ];
  assert.deepEqual(itens.sort(C.compararPlano).map(x => x.id), ['c', 'd', 'b', 'e', 'f', 'a']);
});

test('tituloPlano pelos anos das versões ativas e planejadas', () => {
  assert.equal(C.tituloPlano([{ data: '2026-11-10', ativa: true }, { data: '2027-03-01', planejada: true }]), 'Plano 2026/27');
  assert.equal(C.tituloPlano([{ data: '2026-11-10', ativa: true }]), 'Plano 2026');
  assert.equal(C.tituloPlano([{ data: '2025-01-01', ativa: false }]), 'Plano');
});

test('aceitaOS com os status novos', () => {
  assert.equal(C.aceitaOS('plano'), true);
  assert.equal(C.aceitaOS('entregue'), true);
  ['triagem', 'pauta', 'adiada', 'descartada'].forEach(s => assert.equal(C.aceitaOS(s), false));
});
```

No mesmo step, apague os testes antigos `aceitaOS` (linha 47) e ajuste os testes `vinculoPorPai` e `sugestoesPorPai` trocando os status antigos pelos novos (`aprovada`/`execucao` → `plano`, `ideia` → `triagem`, `cancelada`/`recusada` → `descartada`), mantendo as mesmas expectativas.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL com `C.configPlano is not a function` (e os novos testes de `aceitaOS`).

- [ ] **Step 3: Implementar em `projetos-core.js`**

`configPlano` faz cópia profunda (JSON) do padrão antes de sobrepor. `compararPlano`: `posicao` asc com nulos no fim; `prioridade` desc com nulos no fim; `pai_redmine` comparado como número (vazio no fim); `criado_em` asc. `tituloPlano` usa `data` das versões com `ativa` ou `planejada`; ano final com 2 dígitos. `podeMudarStatus`: `pauta|adiada → plano|adiada|descartada`, `plano → entregue|adiada|descartada`, `entregue → plano`, nada mais. Exporte tudo no objeto `api`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add projetos-core.js tests/projetos-core.test.js
git commit -m "feat(plano): regras de prioridade, faixas, estimativa e status"
```

---

### Task 2: Cascata pelas versões, repartição por papel e reordenação

**Files:**
- Modify: `projetos-core.js`
- Test: `tests/projetos-core.test.js`

**Interfaces:**
- Consumes: `compararPlano` (Task 1).
- Produces:
  - `distribuirPlano(demandas, versoes, realizado) -> {versoes, semVersao, semHoras, previstas}`
    - `demandas`: `[{id, status, posicao, prioridade, pai_redmine, criado_em, horas}]` (`horas` = `horasTotal`). Só `status==='plano'` entra.
    - `versoes`: `[{id, data, ativa, planejada, capacidade}]`. Entram as `ativa` (por `data` asc, nula no fim) e depois as `planejada && !ativa` (por `data` asc).
    - `realizado`: `{total:{[demId]:h}, porVersao:{[versaoId]:{[demId]:h}}}` (porVersao inclui demandas fora do plano).
    - Saída `versoes[i]`: `{id, capacidade, realizado, usado, livres, itens:[{id, horas, realizado, parte, partes}]}`; `semVersao`: `[{id, horas, parte, partes}]`; `semHoras`: `[id]`; `previstas`: `{[demId]:[versaoId|null]}` (null = sem versão).
  - `repartirPorPapel(itens, restantePorPapel, realizadoPorPapel, papeisIds, capacidadePorPapel) -> [{papelId, capacidade, usado, realizado, acima, livres, itens:[{id, horas, realizado}]}]`
  - `restantePorPapel(horasPapeis, realizadoPorPapelTotal:{[papelId]:h}, papeisIds) -> {[papelId]:h}`
  - `moverPara(ordemIds, id, indice) -> ordemIds novo`; `renumerar(ordemIds, posicaoAtual:{[id]:n}) -> [{id, posicao}]` (só as que mudam; posições 1..n)
  - `indiceDeSoltura(ordemIds, id, idsDoPote, idsAntesDoPote, fracao) -> indice` no array sem `id`. `fracao` 0 = fundo do pote (antes), 1 = topo (depois de todos do pote); `null` = fim do plano (pote "Sem versão").
  - `repartirTotal(capPorPapel:{[papelId]:h}, novoTotal) -> {[papelId]:h}` (inteiros pelo método do maior resto: arredonda para baixo e distribui a sobra pelos maiores restos fracionários, empate para o primeiro na ordem das chaves; tudo zero = divide igual).

- [ ] **Step 1: Escrever os testes**

```js
const V = (id, cap, extra) => Object.assign({ id, capacidade: cap, data: '2026-1' + id.slice(1) + '-01', planejada: true }, extra);
const D = (id, h, pos, extra) => Object.assign({ id, status: 'plano', posicao: pos, prioridade: null, criado_em: '2026-01-01', horas: h }, extra);
const R0 = { total: {}, porVersao: {} };

test('distribuirPlano: enche em ordem e divide a demanda que não cabe', () => {
  const r = C.distribuirPlano([D('d1', 6, 1), D('d2', 6, 2), D('d3', 10, 3)], [V('v1', 10), V('v2', 10)], R0);
  assert.deepEqual(r.versoes[0].itens.map(i => [i.id, i.horas]), [['d1', 6], ['d2', 4]]);
  assert.deepEqual(r.versoes[1].itens.map(i => [i.id, i.horas]), [['d2', 2], ['d3', 8]]);
  assert.deepEqual(r.semVersao.map(i => [i.id, i.horas]), [['d3', 2]]);
  assert.deepEqual(r.previstas.d2, ['v1', 'v2']);
  assert.deepEqual(r.previstas.d3, ['v2', null]);
  assert.equal(r.versoes[0].itens[1].partes, 2);
  assert.equal(r.versoes[1].itens[0].parte, 1);
  assert.equal(r.versoes[0].livres, 0);
});

test('distribuirPlano: só status plano; sem horas vai para semHoras; encerrada fica fora', () => {
  const r = C.distribuirPlano(
    [D('d1', 5, 1), D('d2', 0, 2), D('d3', 5, 3, { status: 'pauta' })],
    [V('v1', 20), { id: 'vx', capacidade: 99, data: '2026-01-01', ativa: false, planejada: false }], R0);
  assert.equal(r.versoes.length, 1);
  assert.deepEqual(r.versoes[0].itens.map(i => i.id), ['d1']);
  assert.deepEqual(r.semHoras, ['d2']);
  assert.equal(r.versoes[0].livres, 15);
});

test('distribuirPlano: ativa antes da planejada e desconta o realizado da versão', () => {
  const vers = [V('v2', 10), V('v1', 20, { ativa: true, planejada: false, data: '2026-12-31' })];
  const real = { total: { d1: 5 }, porVersao: { v1: { d1: 5, dx: 3 } } };
  const r = C.distribuirPlano([D('d1', 10, 1), D('d2', 20, 2)], vers, real);
  assert.equal(r.versoes[0].id, 'v1');
  assert.equal(r.versoes[0].realizado, 8);
  assert.deepEqual(r.versoes[0].itens.map(i => [i.id, i.horas, i.realizado]), [['d1', 5, 5], ['d2', 7, 0]]);
  assert.equal(r.versoes[0].usado, 20);
  assert.deepEqual(r.versoes[1].itens.map(i => [i.id, i.horas]), [['d2', 10]]);
  assert.deepEqual(r.semVersao.map(i => [i.id, i.horas]), [['d2', 3]]);
});

test('distribuirPlano: realizado acima do estimado ocupa 0 e não fica negativo', () => {
  const vers = [V('v1', 10, { ativa: true, planejada: false })];
  const r = C.distribuirPlano([D('d1', 4, 1), D('d2', 3, 2)], vers, { total: { d1: 6 }, porVersao: { v1: { d1: 6 } } });
  assert.deepEqual(r.versoes[0].itens.map(i => [i.id, i.horas, i.realizado]), [['d1', 0, 6], ['d2', 3, 0]]);
  assert.equal(r.versoes[0].livres, 1);
});

test('distribuirPlano: versão com capacidade 0 passa tudo adiante', () => {
  const r = C.distribuirPlano([D('d1', 5, 1)], [V('v1', 0), V('v2', 10)], R0);
  assert.deepEqual(r.versoes[0].itens, []);
  assert.equal(r.versoes[0].livres, 0);
  assert.deepEqual(r.previstas.d1, ['v2']);
});

test('distribuirPlano: sem posição ordena por prioridade', () => {
  const r = C.distribuirPlano([D('a', 5, null, { prioridade: 3 }), D('b', 5, null, { prioridade: 20 })], [V('v1', 5)], R0);
  assert.deepEqual(r.versoes[0].itens.map(i => i.id), ['b']);
});

test('restantePorPapel e repartirPorPapel', () => {
  assert.deepEqual(C.restantePorPapel([{ papel_id: 'an', horas: 8 }, { papel_id: 'de', horas: 4 }], { an: 2, de: 6 }, ['an', 'de']), { an: 6, de: 0 });
  const out = C.repartirPorPapel(
    [{ id: 'd1', horas: 10, realizado: 2 }, { id: 'd2', horas: 4, realizado: 0 }],
    { d1: { an: 6, de: 4 }, d2: { an: 0, de: 0 } },
    { d1: { an: 2 } },
    ['an', 'de'], { an: 5, de: 10 });
  assert.equal(out[0].papelId, 'an');
  assert.deepEqual(out[0].itens, [{ id: 'd1', horas: 6, realizado: 2 }]);
  assert.equal(out[0].usado, 8);
  assert.equal(out[0].acima, 3);
  assert.equal(out[0].livres, 0);
  assert.deepEqual(out[1].itens, [{ id: 'd1', horas: 4, realizado: 0 }]);
  assert.equal(out[1].acima, 0);
  assert.equal(out[1].livres, 6);
});

test('moverPara, renumerar e indiceDeSoltura', () => {
  assert.deepEqual(C.moverPara(['a', 'b', 'c', 'd'], 'd', 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(C.renumerar(['a', 'd', 'b', 'c'], { a: 1, b: 2, c: 3, d: 4 }), [{ id: 'd', posicao: 2 }, { id: 'b', posicao: 3 }, { id: 'c', posicao: 4 }]);
  const ordem = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(C.indiceDeSoltura(ordem, 'e', ['b', 'c'], ['a'], 0), 1);
  assert.equal(C.indiceDeSoltura(ordem, 'e', ['b', 'c'], ['a'], 1), 3);
  assert.equal(C.indiceDeSoltura(ordem, 'a', ['c', 'd'], ['a', 'b'], 0.6), 2);
  assert.equal(C.indiceDeSoltura(ordem, 'x', [], ['a', 'b'], 0.5), 2);
  assert.equal(C.indiceDeSoltura(ordem, 'x', [], [], 0.5), 0);
  assert.equal(C.indiceDeSoltura(ordem, 'b', ['c'], ['a'], null), 4);
});

test('repartirTotal mantém a proporção em inteiros', () => {
  assert.deepEqual(C.repartirTotal({ an: 50, de: 80, te: 30 }, 200), { an: 63, de: 100, te: 37 });
  assert.deepEqual(C.repartirTotal({ an: 0, de: 0 }, 11), { an: 6, de: 5 });
  assert.equal(Object.values(C.repartirTotal({ an: 1, de: 1, te: 1 }, 10)).reduce((a, b) => a + b), 10);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL com `C.distribuirPlano is not a function`

- [ ] **Step 3: Implementar**

`distribuirPlano`: ordena as demandas do plano com `compararPlano`; restante = `max(horas − total[id], 0)`; demandas com `horas` 0 vão para `semHoras`. Espaço da ativa = `capacidade − Σ porVersao[v]` (pode ficar ≤ 0). Para cada demanda da ativa com `porVersao[v][id] > 0`, há item nessa versão com `realizado` preenchido, mesmo com `horas` 0; o restante entra no mesmo item quando cai na mesma versão. Depois, o preenchimento em ordem com divisão, como `distribuir()` do mockup v4. `parte`/`partes` contam só os pedaços de restante (versões + sem versão). `usado = realizado da versão + Σ itens.horas`; `livres = max(capacidade − usado, 0)`. `repartirPorPapel`: fatia = `item.horas × rest[p] / Σrest` (0 se Σrest = 0); omite linhas com `horas + realizado < 0.05`; arredonda a 0,1. `indiceDeSoltura`: tira `id` da ordem; `fracao===null` → fim; pote vazio → depois do último de `idsAntesDoPote` (ou 0); senão `q = round(fracao × n)` sobre `idsDoPote` sem `id`, e devolve o índice de `idsDoPote[q]` ou o seguinte ao último.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add projetos-core.js tests/projetos-core.test.js
git commit -m "feat(plano): cascata por versão, repartição por papel e reordenação"
```

---

### Task 3: Realizado, Redmine e resumo plano × realizado

**Files:**
- Modify: `projetos-core.js`
- Test: `tests/projetos-core.test.js`

**Interfaces:**
- Produces:
  - `papelDoTipo(papeis, papelPadraoId) -> {[tipoId:string]:papelId}` e `papelPadrao(papeis, papelPadraoId) -> papelId|null` (o configurado se existir e for do plano; senão o primeiro de `papeisDoPlano`).
  - `agregarRealizado(linhas, papeis, papelPadraoId) -> {total, porVersao, porPapel, porVersaoPapel, versaoPapel}`; `linhas`: `[{projeto_id, versao_id|null, activity_type_id|null, horas}]`. `total[dem]`, `porVersao[ver][dem]`, `porPapel[dem][papel]`, `porVersaoPapel[ver][dem][papel]`, `versaoPapel[ver][papel]`. Tipo sem papel ou nulo → papel padrão. `versao_id` nulo só entra em `total` e `porPapel`.
  - `horasDoRedmine(filhas:[{tracker:{id,name}, estimated_hours}], papeis, papelPadraoId) -> [{papel_id, horas}]` (casa `String(tracker.id)` ou `tracker.name` com `papel.trackers`; sem casar → papel padrão; ignora horas nulas).
  - `camposSync(demanda:{horas_origem}, horasRedmine) -> {horas_redmine, [horas_papeis]}` (`horas_papeis` só quando `horas_origem==='redmine'`).
  - `resumoVersao(versaoId, linhaBase:[{projeto_id, horas_previstas}], demandas:[{id, status, horas}], realizado) -> {temLinhaBase, horasPrevistas, horasRealizadas, previstas, entregues, herdadas:[id], estimadoEntregues, realizadoEntregues}`
  - `capacidadeSugerida(encerradas:[{id, data}], versaoPapel, papeisIds, n=3) -> {[papelId]:h}` (média arredondada das últimas `n` por `data` desc; papel sem horas numa versão conta 0; sem histórico → `{}`).

- [ ] **Step 1: Escrever os testes**

```js
const PP = [
  { id: 'an', externo: false, ordem: 1, tipos_atividade: ['9'], trackers: ['Análise', '4'] },
  { id: 'de', externo: false, ordem: 2, tipos_atividade: ['10'], trackers: ['Desenvolvimento'] },
  { id: 'cl', externo: true, ordem: 3, tipos_atividade: [], trackers: [] },
];

test('agregarRealizado: tipo como número ou string; sem tipo vai para o padrão', () => {
  const r = C.agregarRealizado([
    { projeto_id: 'd1', versao_id: 'v1', activity_type_id: 9, horas: 2 },
    { projeto_id: 'd1', versao_id: 'v1', activity_type_id: '10', horas: 3 },
    { projeto_id: 'd1', versao_id: null, activity_type_id: null, horas: 1 },
    { projeto_id: 'd2', versao_id: 'v1', activity_type_id: '77', horas: '4' },
  ], PP, 'de');
  assert.deepEqual(r.total, { d1: 6, d2: 4 });
  assert.deepEqual(r.porVersao, { v1: { d1: 5, d2: 4 } });
  assert.deepEqual(r.porPapel.d1, { an: 2, de: 4 });
  assert.deepEqual(r.porVersaoPapel.v1.d1, { an: 2, de: 3 });
  assert.deepEqual(r.versaoPapel.v1, { an: 2, de: 7 });
});

test('papelPadrao cai no primeiro do plano quando não configurado', () => {
  assert.equal(C.papelPadrao(PP, null), 'an');
  assert.equal(C.papelPadrao(PP, 'cl'), 'an');
  assert.equal(C.papelPadrao(PP, 'de'), 'de');
});

test('horasDoRedmine: tracker por nome ou id; sem mapa vai para o padrão', () => {
  const h = C.horasDoRedmine([
    { tracker: { id: 4, name: 'Outro nome' }, estimated_hours: 5 },
    { tracker: { id: 2, name: 'Desenvolvimento' }, estimated_hours: 10 },
    { tracker: { id: 3, name: 'QA' }, estimated_hours: 2 },
    { tracker: { id: 2, name: 'Desenvolvimento' }, estimated_hours: null },
  ], PP, 'de');
  assert.deepEqual(h, [{ papel_id: 'an', horas: 5 }, { papel_id: 'de', horas: 12 }]);
});

test('camposSync respeita a origem', () => {
  const h = [{ papel_id: 'an', horas: 3 }];
  assert.deepEqual(C.camposSync({ horas_origem: 'redmine' }, h), { horas_redmine: h, horas_papeis: h });
  assert.deepEqual(C.camposSync({ horas_origem: 'vs' }, h), { horas_redmine: h });
});

test('resumoVersao: cumprimento, herdadas e precisão', () => {
  const real = { total: { d1: 12, d2: 3 }, porVersao: { v1: { d1: 10, d2: 3, d9: 50 } } };
  const r = C.resumoVersao('v1',
    [{ projeto_id: 'd1', horas_previstas: 10 }, { projeto_id: 'd2', horas_previstas: 8 }],
    [{ id: 'd1', status: 'entregue', horas: 10 }, { id: 'd2', status: 'plano', horas: 8 }], real);
  assert.deepEqual(r, { temLinhaBase: true, horasPrevistas: 18, horasRealizadas: 13, previstas: 2, entregues: 1,
    herdadas: ['d2'], estimadoEntregues: 10, realizadoEntregues: 12 });
  assert.equal(C.resumoVersao('v2', [], [], real).temLinhaBase, false);
});

test('capacidadeSugerida: média das 3 últimas encerradas', () => {
  const enc = [{ id: 'a', data: '2026-01-01' }, { id: 'b', data: '2026-02-01' }, { id: 'c', data: '2026-03-01' }, { id: 'd', data: '2026-04-01' }];
  const vp = { a: { an: 100 }, b: { an: 10, de: 30 }, c: { an: 20 }, d: { an: 30, de: 31 } };
  assert.deepEqual(C.capacidadeSugerida(enc, vp, ['an', 'de']), { an: 20, de: 20 });
  assert.deepEqual(C.capacidadeSugerida([], vp, ['an']), {});
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL com `C.agregarRealizado is not a function`

- [ ] **Step 3: Implementar** as funções acima em `projetos-core.js`, convertendo horas com `num()` e ids com `String()`. `horasDoRedmine` devolve os papéis na ordem de `papeisDoPlano`, só os com horas > 0. `resumoVersao`: `horasRealizadas` = soma de `porVersao[versaoId]` só das demandas da linha de base; `herdadas` = da linha de base com status `plano`; precisão = estimado (`horas`) e `realizado.total` das entregues da linha de base.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add projetos-core.js tests/projetos-core.test.js
git commit -m "feat(plano): realizado por papel, horas do Redmine e resumo da versão"
```

---

### Task 4: Migration do esquema do Plano

**Files:**
- Create: `supabase/migrations/2026-10-29_01_plano.sql`

**Interfaces:**
- Produces (banco):
  - `projetos`: `crit smallint[]`, `posicao numeric`, `produto text`, `solicitante text`, `horas_papeis jsonb not null default '[]'`, `horas_origem text not null default 'vs' check in ('vs','redmine')`, `horas_redmine jsonb`, `decisao_obs text`, `decidido_em timestamptz`, `decidido_por uuid references auth.users`, `entregue_em timestamptz`. Check do status: `triagem, pauta, plano, adiada, descartada, entregue`; default `triagem`.
  - `projeto_papeis`: `trackers text[] not null default '{}'`, `tipos_atividade text[] not null default '{}'`, `ativo boolean not null default true`.
  - `versoes.planejada boolean not null default false`.
  - `plano_config (workspace_id uuid pk → workspaces, criterios jsonb, faixas_prioridade jsonb, faixas_esforco jsonb, papel_padrao_id uuid → projeto_papeis on delete set null, redmine_sync_em timestamptz)`. Nulos = padrão do cliente (`configPlano`).
  - `versao_capacidade (workspace_id, versao_id → versoes on delete cascade, papel_id → projeto_papeis on delete cascade, horas numeric not null default 0 check >= 0, primary key (versao_id, papel_id))`.
  - `plano_linha_base (id uuid pk, workspace_id, versao_id → versoes on delete cascade, projeto_id → projetos on delete cascade, horas_previstas numeric not null, posicao numeric, criado_em timestamptz default now(), unique (versao_id, projeto_id))`.
  - `projeto_eventos.tipo` aceita também `decisao, criterios, posicao, entrega, horas`.

- [ ] **Step 1: Pré-checagem (o usuário roda no SQL Editor e cola o resultado)**

```sql
select status, count(*) from projetos group by 1 order by 1;
select conname from pg_constraint where conrelid in ('projetos'::regclass, 'projeto_eventos'::regclass) and contype = 'c';
select count(*) filter (where planejada is not null) from versoes; -- deve dar erro "column does not exist" antes da migration
```

Use os nomes reais das constraints de check que vierem (o padrão é `projetos_status_check` e `projeto_eventos_tipo_check`).

- [ ] **Step 2: Escrever a migration**

Na ordem:
1. Colunas novas (`add column if not exists`), tabelas novas (`create table if not exists`), índices `(workspace_id)`.
2. Status: `alter table projetos drop constraint if exists projetos_status_check;` depois `update` pelo mapa `ideia→triagem, avaliacao→pauta, aprovada|execucao|pausada→plano, concluida→entregue, recusada|cancelada→descartada`; depois `add constraint projetos_status_check check (status in (...))` e `alter column status set default 'triagem'`. Mesma coisa para `projeto_eventos_tipo_check` (lista antiga + nova).
3. `crit`: `check (crit is null or (cardinality(crit) = 4 and 0 <= all(array_remove(crit, null)) and 3 >= all(array_remove(crit, null))))`.
4. Migração de dados (idempotente: só onde `horas_papeis = '[]'`): `tipos_atividade` do papel = união dos `tipos_atividade` das etapas ativas daquele papel; `horas_papeis` = soma de `projeto_etapa_config.horas_estimadas` agrupada por `projeto_etapas.papel_id`; se der vazio e `esforco_total_h > 0`, um item com o papel interno de menor `ordem` cujo nome é `Desenvolvedor` (ou o interno de menor `ordem`). `posicao` = `row_number()` por `prioridade desc nulls last, criado_em` para quem ficou `plano` e está com `posicao` nula.
5. RLS:
   - `plano_config`: select membro; insert/update/delete `is_workspace_admin`.
   - `versao_capacidade`: select membro; escrita `pode_gerir_projetos(workspace_id)` com `exists` de `versoes` do mesmo workspace e de `projeto_papeis` do mesmo workspace.
   - `plano_linha_base`: select membro; insert `is_workspace_member(workspace_id) and exists (select 1 from versoes v where v.id = versao_id and v.workspace_id = plano_linha_base.workspace_id and v.ativa)` e o projeto do mesmo workspace; sem update/delete.
   - `projetos_insert`: membro, `sugerido_por = auth.uid()`, `status = 'triagem'`, `crit is null`, `posicao is null`, `decidido_em is null`.
   - Eventos (`projeto_eventos_insert`): mantém `comentario` e `vinculo_os` para membros como hoje; remove o ramo de `status/etapa` automático; quem gere insere qualquer tipo.
6. Trigger `projetos_guarda_update` reescrito: sessão sem usuário ou `pode_gerir_projetos` → libera. Senão só o autor, com `old.status = 'triagem' and new.status = 'triagem'`, e sem mudar `workspace_id, sugerido_por, criado_em, crit, posicao, pai_redmine, decisao_obs, decidido_em, decidido_por, entregue_em`. Senão: `raise exception 'Sem permissão para alterar esta demanda (requer "Gerir o plano").'`.
7. Trocar o trigger `projetos_x_prioridade` por `projetos_x_normaliza` (drop do antigo e de `projeto_calc_prioridade`): no insert, `criado_em := now()`, `atualizado_em := null`, e para quem não gere zera `pai_redmine`; no update, `atualizado_em := now()`; nos dois, se `status = 'triagem'` e `crit` tem 4 não nulos, `status := 'pauta'`; se algum `horas` de `horas_papeis` for negativo, `raise exception 'Horas não podem ser negativas.'`; se `status` muda para `plano` e `posicao` é nula, `posicao := coalesce((select max(posicao) from projetos where workspace_id = new.workspace_id and status = 'plano'), 0) + 1`; se muda para `entregue`, `entregue_em := now()`; se sai de `entregue`, `entregue_em := null`.

- [ ] **Step 3: O usuário roda o arquivo inteiro no SQL Editor de produção** e confirma "Success".

- [ ] **Step 4: Verificar (o usuário roda e cola o resultado)**

```sql
select status, count(*), count(posicao) as com_posicao, count(*) filter (where horas_papeis <> '[]') as com_horas from projetos group by 1 order by 1;
-- Esperado: só os 6 status novos; todo "plano" com posição.
select nome, externo, ativo, tipos_atividade from projeto_papeis order by workspace_id, ordem;
-- Esperado: Analista/Desenvolvedor/Testador com os tipos que estavam nas etapas.
select to_regclass('plano_config'), to_regclass('versao_capacidade'), to_regclass('plano_linha_base');
-- Esperado: os três nomes, nenhum nulo.
```

Rode o arquivo de novo e confirme que não dá erro (idempotência).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026-10-29_01_plano.sql
git commit -m "feat(plano): migration de demandas, papéis, capacidade e linha de base"
```

---

### Task 5: Função de realizado agregado e marca de sincronização

**Files:**
- Create: `supabase/migrations/2026-10-29_02_plano_realizado.sql`

**Interfaces:**
- Produces:
  - `plano_realizado(p_workspace_id uuid) returns table(projeto_id uuid, versao_id uuid, activity_type_id text, horas numeric)`: `security definer`, `stable`, `search_path = public, pg_temp`; só para `is_workspace_member(p_workspace_id)`; todas as apropriações de OSs com `projeto_id` não nulo, em qualquer status, expandindo `breakdown` como `projeto_horas_agregadas` faz (sem `breakdown` → linha com tipo nulo); `versao_id` = `pontos.versao_id`; agrupado pelas 3 chaves. `revoke` de `public, anon`; `grant` a `authenticated`.
  - `plano_marcar_sync(p_workspace_id uuid) returns timestamptz`: `security definer`; exige `pode_gerir_projetos(p_workspace_id)` (senão `raise exception`); faz upsert em `plano_config` com `redmine_sync_em = now()` e devolve o valor.

- [ ] **Step 1: Escrever a migration** com as duas funções.

- [ ] **Step 2: O usuário roda no SQL Editor de produção.**

- [ ] **Step 3: Verificar (o usuário roda e cola)**

```sql
select * from plano_realizado('<workspace_id da Siacon>') limit 5;
```
Esperado: **0 linhas** (no SQL Editor `auth.uid()` é nulo, então quem chama não é membro). O caso de membro é verificado na Task 8 pelo console do app: `await sb.rpc('plano_realizado',{p_workspace_id:CURRENT_WORKSPACE_ID})` devolve linhas, e a soma por `projeto_id` bate com `projetos_horas_totais`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-10-29_02_plano_realizado.sql
git commit -m "feat(plano): realizado agregado por demanda, versão e tipo; marca de sync"
```

---

### Task 6: `plano-viz.js` — grade de bolhas e potes

**Files:**
- Create: `plano-viz.js`, `tests/plano-viz.html`

**Interfaces:**
- Produces `window.PlanoViz`:
  - `grade(svg, opts)`. `opts = {linhas:[{chave, titulo, sub, cor}], colunas:[{chave, titulo, sub}], destaque:{linha, coluna, texto}, bolhas:[{id, linha, coluna, horas, cor, anel:bool, tracejada:bool, apagada:bool}], podeArrastar:bool, semAnimacao:bool, aoClicar(id), aoSoltar(id, alvo), aoPassar(id, on, ev)}`. A célula mostra a contagem das bolhas não apagadas.
  - `potes(svg, wrap, opts)`. `opts = {potes:[{chave, tipo:'versao'|'papel'|'sem', titulo, sub, subCor, capacidade, usado, realizado, acima, rodape, rodapeCor, editavel:bool, corTampa, tituloClicavel:bool, itens:[{id, horas, realizado, cor, dividida:bool}]}], podeArrastar, semAnimacao, aoClicar(id), aoSoltar(id, alvo), aoPassar(id, on, ev), aoTampa(chave, horas, final:bool), aoTitulo(chave)}`.
  - `alvo` em `aoSoltar` = `{chave, fracao}` (fração 0 no fundo do pote, 1 na borda) ou `null` quando solta fora de um pote.
  - `realcar(id, on)`: destaca a bolha `id` na grade e em todos os potes.
  - Bolhas mantêm posição entre redesenhos pela chave `chave + ':' + id` (cai de cima só a bolha nova), como `bodies` no mockup.

- [ ] **Step 1: Escrever `tests/plano-viz.html`**

Página com `<!doctype html>`, os tokens de cor do `:root` do `index.html`, `<svg id="g">`, `<div id="w"><svg id="p"></svg></div>`, `<script src="../plano-viz.js">`, e dados fixos que cobrem: célula vazia, célula com 26 bolhas de 0h (tracejadas), bolha de 337h; potes com `capacidade` 160, 0 (vazio, rodapé "0 de 0h") e um `papel` com `acima` 12; pote `sem`; um item `dividida`; um item com `realizado`. Com `?static` passa `semAnimacao:true`; com `?v=1` desenha potes de papel.

- [ ] **Step 2: Rodar e ver falhar**

Run: `"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --window-size=1400,1100 --virtual-time-budget=4000 --screenshot="$TEMP/viz.png" "file:///$(pwd -W)/tests/plano-viz.html?static"` e abra a imagem.
Expected: página sem bolhas (o script ainda não existe).

- [ ] **Step 3: Implementar `plano-viz.js`** (ES5, IIFE, `window.PlanoViz`)

Porte do mockup v4: `packCells`/`buildMatrix`/`paintDots` → `grade`; `drawMacro`/`drawMicro`/`step`/`kick`/`paintBodies`/`bindLid` → `potes`; `startDrag`/`jarAt`/`toSvg` → arrasto. As regras de negócio (cascata, ordem) **não** entram aqui, só o desenho. Parâmetros que ficam fixos: raio na grade `5 + 19·√(min(h,340)/340)` (0h → 5, tracejada); área do pote `largura × k × 0,52` por hora, raio entre 5 e `largura/2 − 4`; gravidade 0,32, amortecimento 0,97, velocidade máx. 12, 3 iterações de colisão, 3 passos por quadro, 420 quadros; limiar de arrasto 5px; tampa em passos de 5h, mínimo 0. Escala dos potes: `k = altura / max(maior capacidade, maior usado, 40)` (Review Focus 1). `semAnimacao` ou `prefers-reduced-motion`: roda 900 passos de uma vez e desenha assentado. Na grade, `apagada` = opacidade 0,1. `aoTampa` dispara com `final:false` durante o arrasto (o chamador redesenha) e `final:true` no `pointerup`.

- [ ] **Step 4: Rodar e conferir as capturas**

Run: o comando do Step 2 com `?static` e com `?static&v=1`.
Expected: grade 4 × 4 com rótulos, a célula de destaque violeta, as 26 bolhas tracejadas sem sobrepor; potes com líquido e bolhas assentadas; pote de capacidade 0 desenhado sem erro; pote de papel com a faixa vermelha acima da borda; console sem erros (rode também com `--enable-logging=stderr --v=0` e procure "Uncaught").

- [ ] **Step 5: Commit**

```bash
git add plano-viz.js tests/plano-viz.html
git commit -m "feat(plano): visualização de bolhas e potes com física"
```

---

### Task 7: Dados do Plano no `index.html` e Preferências → Plano

**Files:**
- Modify: `index.html`: `projCarregar` (~5949), `PJ` (~5945), seção de preferências (`renderFluxoProjetosPrefs` ~6599–6678, chamada em ~2805), rótulos de permissão (~2265, ~2399), `<script>` no `<head>` (~10).

**Interfaces:**
- Consumes: `ProjCore.configPlano`, `papeisDoPlano`, `agregarRealizado`, `papelPadrao` (Tasks 1 e 3); RPC `plano_realizado`, tabelas da Task 4.
- Produces (globais no `index.html`):
  - `PJ = {projetos, papeis, eventos, cfgRow, cfg, capac:[{versao_id, papel_id, horas}], linhaBase, realLinhas, real, ok}`.
  - `projCarregar()` carrega tudo isso (incluindo `plano_config` com `maybeSingle()` e `rpc('plano_realizado')`) e calcula `PJ.cfg = ProjCore.configPlano(PJ.cfgRow)` e `PJ.real = ProjCore.agregarRealizado(...)`.
  - `planoRecalcularReal()`: recarrega só a RPC e `PJ.real`.
  - `planoPapeis() -> papel[]` (= `ProjCore.papeisDoPlano(PJ.papeis)`).
  - `planoCapPorPapel(versaoId) -> {[papelId]:h}`; `planoCapTotal(versaoId) -> number`.
  - `planoDemanda(p) -> {id, status, posicao, prioridade, pai_redmine, criado_em, horas, faixaP, faixaE}` (prioridade e horas calculadas com `PJ.cfg`).
  - `renderPlanoPrefs()` no lugar de `renderFluxoProjetosPrefs()`.

- [ ] **Step 1: Carregar `plano-viz.js`** com `<script src="plano-viz.js"></script>` logo depois de `projetos-core.js`.

- [ ] **Step 2: Reescrever `projCarregar` e o estado `PJ`** com as interfaces acima. Tire `etapas` e `configs` do carregamento.

- [ ] **Step 3: `renderPlanoPrefs()`** (só admin, no mesmo `#pref-fluxo-projetos`), com o título "Plano" e 3 blocos:
  - **Critérios:** para cada um dos 4, nome, pergunta, 4 rótulos e peso (número 0–9). Embaixo, as faixas de prioridade ("Baixa até", "Média até") e de esforço ("Pequeno até", "Médio até", em horas). Salvar faz upsert em `plano_config` e recalcula a tela.
  - **Papéis:** nome, "externo", "ativo", trackers do Redmine (texto separado por vírgula, aceita nome ou id) e os tipos de atividade como checkboxes (reaproveite os chips de `getTipoAtividades()` do código atual, agora por papel). "+ Novo papel" continua.
  - **Papel padrão:** select dos papéis do plano, com a dica "Recebe horas de trackers e tipos de atividade sem papel."
  - Troque `'acoes.gerir_projetos':'Gerir projetos'` por `'Gerir o plano'`, o texto do checkbox por `Gerir o plano (avaliar, decidir, ordenar e capacidade)` e `'menus.projetos':'Projetos'` por `'Plano'`.

- [ ] **Step 4: Verificar** (8080, migrations aplicadas, como admin). No console: `PJ.ok === true`, `PJ.cfg.criterios.length === 4`, `planoPapeis().map(p=>p.nome)` dá `['Analista','Desenvolvedor','Testador']`, e `Object.keys(PJ.real.total).length > 0` se houver OSs vinculadas com horas. A soma de `PJ.real.total` por demanda bate com `sb.rpc('projetos_horas_totais',...)`. Em Preferências → Plataforma aparece "Plano": mude o peso do Alcance para 2, salve, recarregue, e o valor continua lá. Volte para 3.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(plano): estado, carga e preferências do Plano"
```

---

### Task 8: Tela Plano — grade, potes, filtros e arrastar

**Files:**
- Modify: `index.html`: HTML de `#screen-projetos` (~625–633), nav (~564), botões da topbar em `goScreen` (~2836), módulo de Projetos (substitui `renderProjetos`, `renderPjBacklog`, `renderPjQuadro`, `pjCard`, `pjDrop`, `pjDragOver`, as sugestões por pai e `pjTab`), CSS (~120–130).

**Interfaces:**
- Consumes: `PlanoViz.grade`, `PlanoViz.potes`, `PlanoViz.realcar` (Task 6); `ProjCore.distribuirPlano`, `repartirPorPapel`, `restantePorPapel`, `indiceDeSoltura`, `moverPara`, `renumerar`, `repartirTotal`, `tituloPlano` (Tasks 1–3); `planoDemanda`, `planoCapPorPapel`, `planoCapTotal` (Task 7).
- Produces:
  - `renderProjetos()` (nome mantido, `goScreen` chama) → desenha a tela inteira.
  - `_plano = {filtro:null|status, busca:'', produto:'', visao:'todas'|versaoId, dist:null}`.
  - `planoVersoes()`: versões que entram na cascata, no formato de `distribuirPlano`.
  - `planoDistribuir()`: grava `_plano.dist` e devolve.
  - `planoSoltar(id, alvo)`: aplica um arrasto (inclui no plano ou reordena).
  - `planoSetCapPapel(versaoId, papelId, horas, final)` e `planoSetCapTotal(versaoId, horas, final)`: só gravam em `versao_capacidade` quando `final`.
  - `planoGravarOrdem(ordemIds)`: grava as posições de `renumerar` e um evento `posicao` para a demanda movida.

- [ ] **Step 1: HTML da tela.** `#screen-projetos` passa a ter: `#pl-chips` (pílulas + busca + select de produto), `section.panel` "Projetos" com a dica do mockup e `<svg id="pl-grade" viewBox="0 0 1000 452">`, `section.panel` "Capacidade por versão" com `<select id="pl-visao">`, `#pl-dica`, `#pl-resumo`, `<div id="pl-potes-wrap"><svg id="pl-potes"></svg></div>`, e uma seção recolhível `#pl-relatorio` (preenchida na Task 11). O nav passa a dizer "Plano" e usa o ícone de barras do mockup. A topbar de `projetos` mostra "Sincronizar" (só se `can('gerir_projetos')` e Redmine configurado), "Apresentar" e "+ Nova demanda" (`planoNova()`, Task 9). O título da topbar vem de `ProjCore.tituloPlano`, com o subtítulo "N demandas · Redmine sincronizado há X" quando `PJ.cfg.redmine_sync_em` existe.

- [ ] **Step 2: Grade.** Linhas = alta/média/baixa/sem avaliação (cores `--green`, `--amber`, `--red`, `--muted`), colunas = pequeno/médio/grande/sem. Cor da bolha pelo status, como `ST` no mockup (Em pauta = anel âmbar). `apagada` quando não bate com o filtro de status, a busca (ID, título, solicitante) ou o produto. `aoPassar` mostra o tooltip (título, `#pai_redmine`, horas, prioridade, versões previstas de `_plano.dist.previstas`) e chama `PlanoViz.realcar`.

- [ ] **Step 3: Potes.**
  - Em "Todas as versões", um pote por versão de `planoVersoes()`, mais o pote "Sem versão ainda".
  - O rodapé mostra `usado de capacidade`, e embaixo "Xh livres", "cheio" ou "⚠ <papéis> acima", que vem de `repartirPorPapel` com `acima > 0`.
  - Na visão de uma versão, um pote por papel do plano, com os dados de `repartirPorPapel`.
  - `restantePorPapel` usa `PJ.real.porPapel`, e o realizado por papel da versão vem de `PJ.real.porVersaoPapel`.
  - A cor das bolhas dos potes segue uma paleta violeta fixa (`TONES` do mockup) pelo índice da demanda.
  - O select `#pl-visao` lista "Todas as versões" e as versões de `planoVersoes()`. Clicar no título de um pote de versão troca para essa versão.

- [ ] **Step 4: Arrastar e tampa** (só `can('gerir_projetos')`; sem permissão, `podeArrastar:false` e tampas fixas).
  - `planoSoltar`: se a demanda não está em `plano`, primeiro muda para `plano` pelo mesmo caminho do botão "Incluir no plano" (Task 9, `planoDecidir`). Depois calcula o índice com `indiceDeSoltura`:
    - pote de versão: `idsDoPote` são os itens dele e `idsAntesDoPote` os dos potes anteriores;
    - pote "Sem versão": `fracao=null`;
    - pote de papel: inclui no fim daquela versão (`fracao=1`, usando os itens da versão).
  - Em seguida aplica `moverPara` e `planoGravarOrdem`, redesenha e mostra o toast "Incluída no plano · prevista para X → Y" ou "Movida para Nº · prevista para X".
  - Tampa: com `final:false`, só muda o estado local e redesenha. Com `final:true`, grava. Na visão "Todas", o total é repartido com `repartirTotal`.

- [ ] **Step 5: Verificar** (8080, admin, com dados).
  - **Grade:** as bolhas ficam nas células certas, e o filtro "Em pauta" apaga as outras sem mover nada.
  - **Capacidade 0:** arraste a tampa de uma versão até 0. O pote mostra "0 de 0h" e a cascata pula para a seguinte (Review Focus 1). Devolva o valor.
  - **Tampa:** arraste a tampa de uma versão; ao soltar, `select * from versao_capacidade` mostra os novos valores.
  - **Arrastar:** leve uma bolha em pauta para um pote. Ela vira "No plano", e `projetos.posicao` muda para as demandas reordenadas.
  - **Visão por versão:** escolha uma versão no select; aparecem 3 potes de papel.
  - **Sem permissão:** com um perfil sem "Gerir o plano", nada arrasta.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(plano): tela com grade de bolhas, potes por versão e por papel"
```

---

### Task 9: Ficha da demanda, nova demanda e limpeza do módulo antigo

**Files:**
- Modify: `index.html`: o painel de detalhes (`pjAbrir`, `pjFluxoHtml`, `pjSetConfig`, `pjSetCampo`, `openPjIdeia`, `pjSalvarIdeia`, `pjAcao`, `#pj-drawer` em ~1496), `projMudarStatus`, `projAposMudancaOS`, `_projNotificarOS`, `projetos-core.js` e `tests/projetos-core.test.js` (remoções).

**Interfaces:**
- Consumes: `ProjCore.prioridade`, `definirHoras`, `horasTotal`, `situacaoEstimativa`, `podeMudarStatus`, `STATUS_ROTULO` (Task 1); `projEvento`, `projSalvar`, `projRegistrarVinculo` (existentes); `planoDistribuir` (Task 8).
- Produces:
  - `planoAbrir(id)` (ficha no `#pj-drawer`)
  - `planoNova()`
  - `planoCriterio(id, i, v)`
  - `planoSetHoras(id, papelId, horas)`
  - `planoUsarRedmine(id)`
  - `planoDecidir(id, para, obs)`
  - `planoMoverPasso(id, dir)`
  - `planoEntregar(id, on)`

- [ ] **Step 1: Ficha.** Siga o mockup v4, com o painel lateral de 420px e as seções na ordem abaixo.
  - **Cabeçalho:** `#pai_redmine` (ou "Criada no VS"), produto e solicitante, mais o título. Na ficha nova, título, produto e solicitante são campos editáveis.
  - **Esforço estimado:**
    - Se houver `pai_redmine`, a escolha "Definido no VS / Do Redmine #id".
    - A barra por papel e, para cada papel do plano, uma linha com − / campo / + e o total.
    - A situação da estimativa (Completa, Parcial ou Sem estimativa).
    - O texto de origem, copiado do mockup.
  - **No plano** (só em `plano`): posição ↑/↓ e "prevista: X → Y", ou "sem horas, não ocupa espaço".
  - **Execução:** realizado × estimado, situação (Prevista / Em andamento / Entregue) e as OSs vinculadas, reaproveitando `pjOSsHtml` com o rótulo "Demanda". Botão "Marcar como entregue" ou "Reabrir".
  - **Avaliação:** os 4 critérios em botões segmentados, com os textos de `PJ.cfg`, e a nota com a faixa.
  - **Decisão** (em `pauta`, `adiada` e `plano`): os botões permitidos por `podeMudarStatus`, mais a observação.
  - **Histórico:** `projeto_eventos` com textos para os tipos novos:
    - `decisao`: "X incluiu no plano / adiou / descartou"
    - `criterios`: "avaliou · prioridade N"
    - `posicao`: "moveu de Nº para Mº"
    - `entrega`: "marcou como entregue / reabriu"
    - `horas`: "ajustou as horas (total Nh)" ou "voltou a usar o Redmine"
  - **Permissão:** sem `gerir_projetos`, a ficha é só leitura, exceto para o autor de uma demanda em `triagem`. Nesse caso ele edita título, descrição, produto, solicitante e horas.

- [ ] **Step 2: Ações.**
  - `planoSetHoras`:
    - grava `horas_papeis` com `definirHoras` e `horas_origem:'vs'`;
    - grava o evento `horas`;
    - recalcula a grade com `PlanoViz.grade` e os potes (a bolha muda de tamanho).
  - `planoUsarRedmine`: copia `horas_redmine` para `horas_papeis` e grava `horas_origem:'redmine'`.
  - `planoCriterio`:
    - grava `crit` (o trigger passa `triagem → pauta`);
    - grava o evento `criterios`;
    - recarrega a demanda com `projRecarregar`.
  - `planoDecidir`:
    - grava `status`, `decisao_obs`, `decidido_em: new Date().toISOString()` e `decidido_por: CURRENT_USER.id`;
    - a `posicao` vem do trigger;
    - grava o evento `decisao`.
  - `planoMoverPasso`: usa `moverPara` + `planoGravarOrdem`.
  - `planoEntregar`: grava `status` `entregue`/`plano` e o evento `entrega`.
  - `planoNova`: insere com `status:'triagem'`, `titulo:'Nova demanda'` e `sugerido_por: CURRENT_USER.id`, abre a ficha e foca o título.

- [ ] **Step 3: Remover o antigo.**
  - **No `index.html`:**
    - apague as funções do backlog, do quadro e das sugestões;
    - `projMudarStatus` e `projMoverEtapa` saem;
    - `projAposMudancaOS` e `_projNotificarOS` ficam só redesenhando a tela, se ela estiver aberta. Não há mais status automático.
  - **No `projetos-core.js`, remova** `FATOR`, `tamanhoPorHoras`, `horasEsforco`, `calcPrioridade`, `compararBacklog`, `primeiraEtapa`, `gatilhosDaOS`, `proximoStatusAuto`, `intervalosEtapa`, `tempoPorPapel`, `diasNaEtapaAtual`, `etapaNaData`, `horasPorEtapa`, `sugestoesPorPai` e os testes deles. `vinculoPorPai`, `aceitaOS` e `dataLocal` ficam.
  - **Antes de apagar, confira os usos:** `grep -n "ProjCore\.\(calcPrioridade\|horasPorEtapa\|tempoPorPapel\|sugestoesPorPai\|gatilhosDaOS\)" index.html` tem de dar vazio.
  - **Mantenha `pjBuscarPaisNoRedmine`** (renomeie para `planoBuscarPaisNoRedmine`). Ela preenche `oss.pai_redmine`, que é usado no vínculo automático. Chame-a ao abrir o Plano, sem a UI de sugestões.

- [ ] **Step 4: Rodar os testes**

Run: `node --test tests/`
Expected: PASS (só os testes que restaram).

- [ ] **Step 5: Verificar** (8080).
  - **Nova demanda:** crie uma, dê 10h ao Analista e 30h ao Desenvolvedor. A bolha aparece em "Sem avaliação × Pequeno" (40h). Suba o Desenvolvedor para 31h e ela desliza para "Médio".
  - **Avaliação:** preencha os 4 critérios. O status vira "Em pauta" e a bolha muda de linha.
  - **Inclusão:** "Incluir no plano" faz a bolha cair num pote, e o histórico mostra a decisão.
  - **Ordem:** use ↑/↓ e confira `posicao` no banco.
  - **Entrega:** "Marcar como entregue" tira a demanda dos potes, e "Reabrir" devolve.
  - **Sem permissão:** com outro usuário sem permissão, crie uma demanda. Ele edita título e horas, mas não os critérios. Tente `await sb.from('projetos').update({crit:[1,1,1,1]}).eq('id','<id>')` no console: deve dar o erro do trigger.

- [ ] **Step 6: Commit**

```bash
git add index.html projetos-core.js tests/projetos-core.test.js
git commit -m "feat(plano): ficha da demanda e remoção do backlog/quadro antigos"
```

---

### Task 10: Redmine — adicionar por ID e sincronizar

**Files:**
- Modify: `index.html` (módulo Plano)

**Interfaces:**
- Consumes: `getRedmineConfig`, `_redmineFetch` (existentes, ~8640/8669), `ProjCore.horasDoRedmine`, `camposSync`, `papelPadrao` (Task 3), RPC `plano_marcar_sync` (Task 5).
- Produces:
  - `planoRedmineOk() -> boolean` (`can('gerir_projetos')` e Redmine configurado com proxy)
  - `planoAdicionarDoRedmine(id)`
  - `planoSincronizar(auto:boolean)`

- [ ] **Step 1: Implementar.**
  - `planoAdicionarDoRedmine`:
    - fica num campo "Adicionar do Redmine #" ao lado de "+ Nova demanda", visível só com `planoRedmineOk()`;
    - busca `/issues/<id>.json` para o título e `/issues.json?parent_id=<id>&status_id=*&limit=100` para as filhas;
    - insere a demanda em `triagem` com `pai_redmine`, `titulo`, `horas_redmine` = `horas_papeis` = `horasDoRedmine(...)` e `horas_origem:'redmine'`;
    - se já existe uma demanda com esse `pai_redmine`, só abre a ficha dela.
  - `planoSincronizar`:
    - percorre as demandas com `pai_redmine`, em lotes de 1 chamada de filhas por demanda e no máximo 5 em paralelo;
    - grava `camposSync` só quando o resultado mudou;
    - depois chama `plano_marcar_sync` e atualiza `PJ.cfgRow.redmine_sync_em`;
    - ao final, mostra o toast "Sincronizado: N demandas atualizadas".
  - **Execução automática:** ao abrir o Plano, roda `auto:true` se `planoRedmineOk()` e a última sincronização tiver mais de 1 hora. Nesse caso, os erros vão só para `console.warn`.

- [ ] **Step 2: Verificar** (8080, admin com o proxy do Redmine rodando).
  - **Adicionar:** "Adicionar do Redmine #" com um chamado pai real cria a demanda com as horas por papel. Confira contra as filhas no Redmine.
  - **Origem VS:** mude 1h na ficha (a origem vira VS), mude a estimativa no Redmine e sincronize. As horas da ficha não mudam, e `horas_redmine` muda.
  - **Voltar ao Redmine:** "Do Redmine" traz as horas novas.
  - **Data da sincronização:** o subtítulo da topbar mostra "sincronizado há 0 min".

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(plano): adicionar demanda do Redmine e sincronizar estimativas"
```

---

### Task 11: Versões planejadas, capacidade, linha de base e resumo

**Files:**
- Modify: `index.html`
  - `#modal-versao` (~1425)
  - `openNovaVersao`/`editarVersao`/`salvarVersao`: as definições **ativas** são as de ~6784–6830, porque a de ~2951 é sobrescrita depois.
  - `dbSalvarVersao` (~6679) e o mapeamento de `S.versoes` (~5874)
  - `versaoStatus` (~2865)
  - `renderDash` (~2900–2935)
  - `renderHist` (~5561)
  - selects de versão (~3002, ~3202)
  - encerramento: `encerrarVersao`/`confirmarEncerrarVersao` ativos em ~9318

**Interfaces:**
- Consumes:
  - de tasks anteriores: `ProjCore.capacidadeSugerida`, `resumoVersao`, `distribuirPlano`, `planoCapPorPapel`, `planoDistribuir`;
  - do banco: `versao_capacidade` e `plano_linha_base`.
- Produces:
  - `iniciarVersao(vid)`;
  - `planoGravarLinhaBase(vid)`;
  - `planoResumoHtml(vid) -> string`;
  - `S.versoes[i].planejada`.

- [ ] **Step 1: Modelo e modal.**
  - `S.versoes` ganha `planejada:!!v.planejada`, e `dbSalvarVersao` grava `planejada`.
  - No modal de versão:
    - checkbox "Versão planejada (ainda não iniciada)", só na criação;
    - quando marcado, a data da versão vira obrigatória, com o erro "Informe a data da versão planejada.";
    - bloco "Capacidade para o plano" com um campo de horas por papel do plano (aparece se `PJ.ok`), cujo placeholder é a sugestão de `capacidadeSugerida`, no formato "sugestão: 60h".
  - Ao salvar:
    - versão nova planejada = `ativa:false, planejada:true`;
    - versão nova não planejada = `ativa:true, planejada:false`, como hoje;
    - as linhas de `versao_capacidade` são gravadas por upsert;
    - versão ativa criada já ativa **não** grava linha de base.

- [ ] **Step 2: Status e listas.**
  - `versaoStatus` devolve `'planejada'` quando `planejada && !ativa && !encerradaEm`.
  - No Histórico, a etiqueta da versão planejada é "Planejada" (`badge-gray`), e ela troca "Reativar" por "Iniciar".
  - Os selects de versão mostram " (planejada)" no lugar de " ✓".
  - No Dashboard, abaixo de "Versões ativas", entra a seção "Versões planejadas" com nome, data, capacidade total e o botão "Iniciar". Cuidado: o `return` antecipado quando não há ativas (~2917) não pode esconder essa seção.

- [ ] **Step 3: Iniciar e linha de base.**
  - `iniciarVersao(vid)` faz, nesta ordem:
    1. confirma com `modalConfirm` e o texto "Iniciar <nome>? O que o plano prevê para ela vira a linha de base.";
    2. grava `ativa:true, planejada:false`;
    3. recalcula com `planoDistribuir()`;
    4. chama `planoGravarLinhaBase(vid)`.
  - `planoGravarLinhaBase`:
    - insere uma linha por item da versão, com `horas_previstas` = `horas + realizado` do item e `posicao` = a da demanda;
    - **antes**, faz `select count(*)` na versão; se já existir linha de base, não grava.
  - Reativar uma versão encerrada não grava nada.

- [ ] **Step 4: Resumo plano × realizado.**
  - `planoResumoHtml(vid)` mostra:
    - cumprimento (horas previstas × realizadas, demandas previstas × entregues);
    - herdadas, com os títulos;
    - precisão (estimado × realizado das entregues);
    - "Sem linha de base" quando `temLinhaBase` é falso.
  - O resumo aparece:
    - no `modal-encerrar`, antes de confirmar;
    - no item encerrado do Histórico, num `<details>`;
    - em `#pl-relatorio` da tela Plano, para a última versão encerrada.

- [ ] **Step 5: Verificar** (8080, admin).
  - **Criar:** crie "Teste Dez" planejada, com data e 40/60/20h. Ela aparece nos potes depois das ativas, e o Dashboard a mostra em "Versões planejadas".
  - **Iniciar:** clique em "Iniciar". `select * from plano_linha_base where versao_id='<id>'` traz uma linha por demanda prevista. Clique em "Iniciar" de novo pelo console (`iniciarVersao('<id>')`): não duplica.
  - **Encerrar:** encerre a versão. O modal mostra o resumo.
  - **Limpeza:** apague a versão de teste.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(plano): versões planejadas, capacidade por papel, linha de base e resumo"
```

---

### Task 12: OS como "Demanda", modo Apresentar e acabamento

**Files:**
- Modify: `index.html`
  - modal da OS (~1468–1471, ~3275–3290)
  - selo do kanban (~3249)
  - CSS

**Interfaces:**
- Consumes: `ProjCore.aceitaOS` e `STATUS_ROTULO`; `planoResumoHtml`.
- Produces: `planoApresentar(on:boolean)`.

- [ ] **Step 1: OS.**
  - O rótulo "Projeto" vira "Demanda", tanto no modal quanto no `title` do selo.
  - O select lista só as demandas que `aceitaOS` aceita, mais a demanda atual. O texto de cada opção é `#pai · título` (ou só o título, se não houver pai).
  - Vincular uma OS a uma demanda entregue **não** muda o status da demanda.

- [ ] **Step 2: Apresentar.**
  - `planoApresentar(true)`:
    - adiciona `body.plano-apresentar` e chama `document.documentElement.requestFullscreen()`, com `catch` silencioso;
    - esconde sidebar, topbar, chips de edição, tampas e o arrastar (`podeArrastar:false`);
    - aumenta a fonte da tela em 15%;
    - abre `#pl-relatorio` com a última versão encerrada;
    - redesenha.
  - Esc ou o botão "Sair" chamam `planoApresentar(false)`.

- [ ] **Step 3: Movimento e acessibilidade.**
  - Confira que a abertura da tela tem uma única sequência de animação: as bolhas da grade aparecem e as bolhas caem nos potes.
  - Com "Reduzir movimento" ligado no sistema, a tela já abre assentada.
  - As bolhas da grade têm `tabindex=0`, e Enter abre a ficha.

- [ ] **Step 4: Verificar** (8080).
  - **Modal da OS:** mostra "Demanda" e lista só demandas no plano ou entregues.
  - **Apresentar:** abre em tela cheia, sem controles, com o resumo. Esc volta.
  - **Rodar os testes:** `node --test tests/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(plano): OS como demanda, modo Apresentar e acabamento"
```

---

### Task 13: Script de carga da planilha 2026.xlsx

**Files:**
- Create: `scripts/importar-planilha-2026.py`

**Interfaces:**
- Produces: `python scripts/importar-planilha-2026.py <caminho.xlsx> <workspace_id> > carga.sql`, que gera o SQL de carga. O arquivo `carga.sql` **não** vai para o git.

- [ ] **Step 1: Escrever o script.** Usa `openpyxl` com `data_only=True`, na aba "Análise de viabilidade", a partir da linha 5 e pulando linhas sem ID na coluna 2. Colunas:

| Coluna | Campo | Regra |
|---|---|---|
| 2 | `pai_redmine` | |
| 3 | título | sem o prefixo `[...] -` |
| 5 | produto | |
| 6, 8, 10, 12 | critérios | mapas abaixo |
| 16 | `posicao` | 0 ou vazio vira nulo |
| 18 | `decisao_obs` | |
| 19 | `decidido_em` | |
| 20 | situação | mapa abaixo |
| 21 | solicitante | antes do `|`, em Title Case; vazio vira "Interno" |
| 23 a 26 | horas | `timedelta` vira horas; número vira × 24 |

- **Situação:** "AGUARDANDO ANÁLISE" → `triagem`, "AGUARDANDO COMITÊ" → `pauta`, "APROVADO" → `plano`, "STAND BY" → `adiada`, "NÃO APROVADO" → `descartada`.
- **Mapas dos critérios:** os textos da aba Parametrizações, já levantados em `export.py` do brainstorm:
  - técnica: "Não temos nenhuma limitação" 3 … "Somos totalmente limitados" 0;
  - estratégia: "Nenhuma estratégia envolvida" 0 … "Totalmente estratégico" 3;
  - valor: "Não há impacto" 0 … "Alto impacto" 3;
  - clientes: "Pouco ou baixo" 0, "Médio" 1, "Alto" 2, "Muito alto" 3.
- **Horas:** Análise e Implantação vão para o papel `Analista`, Desenvolvimento para `Desenvolvedor` e Teste para `Testador`.
- **SQL gerado:**
  - um bloco `do $$ ... $$` que acha os ids dos papéis pelo nome no workspace;
  - um `insert ... on conflict do nothing` por demanda, deduplicado por `(workspace_id, pai_redmine)` com `where not exists`;
  - `horas_papeis` = `horas_redmine` com `horas_origem 'redmine'` e `sugerido_por` nulo.
  - Rode como postgres; o trigger libera sessões sem usuário.
- **Resumo:** imprime no stderr a contagem por status e as horas no plano.

- [ ] **Step 2: Rodar localmente**

Run: `python scripts/importar-planilha-2026.py "C:/Users/costa/OneDrive/Área de Trabalho/Siacon/2026.xlsx" 00000000-0000-0000-0000-000000000000 > "$TEMP/carga.sql"`
Expected: no stderr, `115 demandas · triagem 10 · pauta 68 · plano 35 · adiada 2 · descartada 0 · 1086h no plano`.

- [ ] **Step 3: Carga.** O usuário roda o SQL gerado com o `workspace_id` real no SQL Editor e depois confere:

```sql
select status, count(*) from projetos where workspace_id = '<id>' group by 1;
```

Rodar de novo não pode duplicar nada.

- [ ] **Step 4: Commit**

```bash
git add scripts/importar-planilha-2026.py
git commit -m "chore(plano): script de carga única da planilha 2026.xlsx"
```
