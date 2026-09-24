# Design: Auto-apropriação de horas ao mover OS no Kanban

**Data:** 2026-09-24
**Arquivo alvo:** `index.html` (sem migração de banco)
**Abordagem:** Inline, seguindo padrão vanilla JS existente. Unifica um comportamento que hoje só existe atrás de um botão específico.

---

## Contexto

VersionSuite já tem um timer de "foco" por OS (`startFocus`/`pauseFocus`/`closeFocusSession`) que grava sessões trabalhadas em `localStorage` (`vs_time_log_YYYY-MM-DD`), e uma função `_autoApropriar(osId, totalSeg)` que soma esse tempo na apropriação de horas do ponto do dia — por OS, mesclando com o que já existir naquele dia (index.html:7129).

O problema: `_autoApropriar` só é chamada em **um único lugar**, `concludeOS()` (index.html:7111), que só existe como botão "✓ Concluir OS" dentro do dropdown do timer de foco. O jeito mais comum de mover uma OS no Kanban é pelos botões direto no card (`moveOS`, index.html:6070) ou marcando todos os itens de entrega (`toggleE`, index.html:6103) — nenhum dos dois passa por `_autoApropriar`. Resultado: o usuário conclui pelo card (fluxo mais usado), o tempo rastreado no timer de foco nunca vira apropriação, e o histórico do dia se perde.

Achado um bug relacionado: dentro de `moveOS`, quando a OS que sai de `'andamento'` é a que está em foco e não existe outra OS em andamento pra transferir o foco, o código faz `saveFocusState(null)` **sem** fechar a sessão corrente primeiro — descarta o tempo decorrido sem gravar nem no log.

## Decisões de design (fechadas em brainstorm com o usuário)

- **Gatilho unificado:** qualquer caminho que tire uma OS de `'andamento'` — botões do card, setas, dropdown de foco, ou `toggleE` fechando a OS ao marcar a última entrega — roda a mesma lógica de auto-apropriação. Não fica mais restrito ao dropdown de foco.
- **Dois destinos disparam apropriação, não só `'concluido'`:** voltar pra `'a fazer'` também apropria o tempo rastreado até ali, com a mesma regra.
- **Mesmo limiar mínimo pros dois casos:** só apropria automaticamente se ≥ 5 min rastreados (`APROP_MIN_SECONDS`, já existe). Abaixo disso, move o status normalmente sem apropriar nada (silencioso, como hoje).
- **Mesmo toast com Desfazer pros dois casos:** "Xh apropriadas — OS #123 [Desfazer]" por 5s. Desfazer sempre restaura a OS pra `'andamento'` e retoma o foco nela, independente de o destino ter sido `'concluido'` ou `'afazer'`.
- **Soma por dia continua automática:** como `_autoApropriar` já mescla com a apropriação existente daquele `osId` no ponto do dia corrente, reabrir e apropriar de novo no mesmo dia soma; em outro dia, vira uma entrada separada naquele dia. Nenhuma mudança nessa parte — é o comportamento que já existe, só passa a ser acionado em mais lugares.
- **Fora de escopo:** sessões de foco que atravessam a meia-noite continuam sendo atribuídas ao dia em que a sessão é *fechada* (comportamento pré-existente do `getTodayLog`/`closeFocusSession`, não mexido aqui).

---

## 1. Função central: `_finalizarAndamento(osId, newStatus)`

Nova função que substitui, num único lugar, a lógica de "sair de andamento" que hoje está espalhada entre `moveOS` (transferência de foco) e `concludeOS`/`_autoApropriar` (apropriação). Chamada só quando a OS **está** em `'andamento'` e vai para `'concluido'` ou `'afazer'`.

```js
function _finalizarAndamento(osId,newStatus){
  var st=getFocusState();
  var eraFocal=st&&st.osId===osId;
  if(eraFocal)closeFocusSession(st); // fecha e loga o tempo decorrido — corrige o bug de perda de sessão

  var totalSeg=focusAccumulatedToday(osId);
  if(totalSeg>=APROP_MIN_SECONDS){
    _autoApropriar(osId,totalSeg,newStatus); // generalizada — ver seção 2
  }else{
    _doMoveOS(osId,newStatus);
  }

  if(eraFocal){
    var next=_proxOssAndamento(osId);
    if(next)startFocus(next.id);
    else{saveFocusState(null);updateFocusUI();updatePipUI();}
  }
}
```

Ordem importa: fecha a sessão de foco (garante que o tempo decorrido entra no log) **antes** de ler `focusAccumulatedToday`; decide e executa a apropriação/movimentação; só depois transfere o foco pra próxima OS — mesma ordem que `concludeOS` já usa hoje, só que reaproveitável por qualquer chamador.

## 2. `_autoApropriar` generalizada

Hoje termina com `moveOS(osId,'concluido')` fixo. Passa a receber o status de destino e chamar `_doMoveOS` diretamente (não `moveOS`) para não reentrar em `_finalizarAndamento` e apropriar em duplicidade:

```js
function _autoApropriar(osId,totalSeg,newStatus){
  // ...(soma nas apropriações do ponto do dia, grava entrada auto no day-resume,
  //     limpa o log — tudo igual ao que já existe hoje)...
  _doMoveOS(osId,newStatus); // era: moveOS(osId,'concluido')
  // ...(toast "Xh apropriadas — OS #123 [Desfazer]", igual hoje)...
}
```

`_desfazerAprop` não muda — já restaura pra `'andamento'` e retoma o foco, independente de onde veio.

## 3. `moveOS` passa a delegar

```js
function moveOS(osId,newStatus){
  var os=S.oss.find(function(o){return o.id===osId});if(!os)return;
  if(newStatus==='andamento'){
    // ...(checagem de WIP limit e reabertura, sem mudança)...
    _doMoveOS(osId,newStatus);
    return;
  }
  if(os.status==='andamento'&&(newStatus==='concluido'||newStatus==='afazer')){
    _finalizarAndamento(osId,newStatus);
    return;
  }
  _doMoveOS(osId,newStatus);
}
```

Cobre os botões do card ("✓ Concluir", setas, "↩ Reabrir" quando aplicável) sem precisar mudar nada nos `onclick` existentes.

## 4. `concludeOS` vira um atalho fino

```js
function concludeOS(osId){
  moveOS(osId,'concluido');
  closeFocoDropdown();
}
```

Toda a lógica de fechar sessão, apropriar e trocar de foco já está em `_finalizarAndamento`, chamada via `moveOS`.

## 5. `toggleE` passa a rotear pelo mesmo caminho

Quando marcar a última entrega fecha a OS **e** ela estava em `'andamento'`, não persiste o novo status direto — deixa `_finalizarAndamento` decidir e persistir, pra não pular a apropriação:

```js
function toggleE(osId,key){
  var os=S.oss.find(function(o){return o.id===osId});
  if(!os||!os.entregas||!os.entregas[key]||!os.entregas[key].aplicavel)return;
  os.entregas[key].feito=!os.entregas[key].feito;
  var statusAnterior=os.status;
  if(os.entregas[key].feito&&os.status==='afazer')os.status='andamento';
  var fechaAgora=Object.values(os.entregas).filter(function(e){return e.aplicavel}).every(function(e){return e.feito});

  dbToggleEntrega(osId,os.entregas).then(function(){
    if(fechaAgora&&statusAnterior==='andamento')return; // _finalizarAndamento cuida do status
    os.status=fechaAgora?'concluido':os.status;
    return dbMoverOS(osId,os.status);
  }).then(function(){
    if(fechaAgora&&statusAnterior==='andamento')_finalizarAndamento(osId,'concluido');
    else{renderKanban();renderDash();}
  }).catch(function(e){toast('Erro: '+e.message,'err')});
}
```

Ponto de atenção pro plano de implementação: `os.status` só pode ser sobrescrito por `_doMoveOS` quando o caminho passa por `_finalizarAndamento` — `toggleE` não pode setar `os.status='concluido'` localmente antes de chamar essa função, senão `moveOS`/`_finalizarAndamento` leem o status errado.

---

## Testes manuais (roteiro de validação, sem suíte automatizada no projeto)

1. Focar uma OS, deixar o timer rodar ≥5min, clicar "✓ Concluir" **no card** (não no dropdown de foco) → apropriação deve aparecer no ponto de hoje, com toast de Desfazer.
2. Repetir o passo 1 mas mover pra "← A fazer" em vez de concluir → mesmo resultado (apropria, toast, Desfazer volta pra andamento com foco retomado).
3. Ser a única OS em foco, sem nenhuma outra em andamento, e concluir pelo card → tempo decorrido não pode se perder (valida o fix do bug de `saveFocusState(null)`).
4. Marcar todas as entregas de uma OS em andamento (fechando via `toggleE`) com tempo de foco rastreado → deve apropriar igual aos outros caminhos.
5. Reabrir uma OS concluída no mesmo dia, acumular mais tempo, concluir de novo no mesmo dia → apropriação do dia deve **somar**, não duplicar linha.
6. Repetir com < 5 min rastreados → não deve gerar apropriação nem toast de Desfazer, só mover o status normalmente.
