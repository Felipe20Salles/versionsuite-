# Apropriação Automática de Horas no Foco — Design Spec

**Data:** 2026-05-21
**Projeto:** VersionSuite
**Escopo:** Apropriar automaticamente as horas do timer de foco ao mover um card para "Concluído"

---

## Objetivo

Eliminar o trabalho manual de distribuir horas nas OSs ao final do dia. Quando o usuário conclui uma OS, o tempo rastreado pelo timer de foco é apropriado automaticamente no ponto do dia, integrando-se ao fluxo existente do Resumo do Dia e da exportação para o Redmine.

---

## O que já existe

| Componente | Estado |
|---|---|
| Timer de foco com `vs_time_log_<data>` (log por sessão por OS) | ✅ Pronto |
| `concludeOS(osId)` — move OS para concluído e troca foco | ✅ Pronto |
| `S.pontos` com `apropriacoes: [{osId, horas}]` por dia | ✅ Pronto |
| `vs_dayresume_<data>` — entradas confirmadas para Redmine | ✅ Pronto |
| `buildExportPreview()` lê `vs_dayresume_<data>` | ✅ Pronto |
| Modal Resumo do Dia com `confirmDayResume()` | ✅ Pronto |

---

## Comportamento esperado

### Fluxo principal

1. Usuário trabalha com OS em foco — timer registra sessões em `vs_time_log_<hoje>`
2. Usuário move card para **Concluído**
3. Sistema verifica tempo acumulado hoje para essa OS
4. **Se `totalSegundos < APROP_MIN_SECONDS`** → conclui normalmente, nenhuma apropriação
5. **Se `totalSegundos >= APROP_MIN_SECONDS`**:
   - Encontra ou cria ponto de hoje (vazio, `horasTrabalhadas = 0`)
   - Soma horas na entrada `apropriacoes` daquele osId
   - Salva ponto no Supabase via `dbSalvarPonto`
   - Grava entrada `{ osId, approvedHours, auto: true }` em `vs_dayresume_<hoje>`
   - Limpa entradas do `vs_time_log_<hoje>` para esse osId
   - Exibe toast com botão **Desfazer** (5 segundos)

### Retorno ao "Em andamento"

Quando uma OS concluída volta para "Em andamento":
- Limpa entradas de `vs_time_log_<hoje>` para esse osId
- Nova sessão começa do zero — o tempo acumulado anterior já foi apropriado e não é recontado

### Desfazer (undo)

Estado temporário em memória `_undoAprop`:
```
{
  osId,
  horas,          // horas que foram apropriadas
  pontoId,        // id do ponto modificado
  logSnapshot,    // entradas do vs_time_log salvas antes de limpar
  timeoutId       // referência ao setTimeout de 5s
}
```

Ao clicar **Desfazer** (dentro de 5 segundos):
1. Remove (ou subtrai) entrada `apropriacoes` do ponto no Supabase
2. Remove entrada `auto: true` do `vs_dayresume_<hoje>` para esse osId
3. Restaura entradas do `vs_time_log_<hoje>` para esse osId
4. Move OS de volta para "Em andamento"
5. Reinicia foco nela com o tempo acumulado restaurado
6. Cancela o timeout de 5s

Após 5s sem undo: descarta `_undoAprop`, apropriação confirmada.

---

## Constante

```js
var APROP_MIN_SECONDS = 300; // 5 minutos — limiar para apropriar
```

Definida no topo do arquivo junto com as demais variáveis globais.

---

## Mudanças por função

### `concludeOS(osId)` — modificada

```
1. Calcular totalSegundos do vs_time_log_<hoje> para osId
2. Se totalSegundos < APROP_MIN_SECONDS → fluxo original (sem apropriação)
3. Se totalSegundos >= APROP_MIN_SECONDS:
   a. horas = parseFloat((totalSegundos / 3600).toFixed(2))
   b. Buscar ponto de hoje em S.pontos
      - Se não existir: criar { id, data, dia, marcacoes:'', horasTrabalhadas:0, versaoId, apropriacoes:[] }
        e salvar no Supabase
   c. Somar horas em ponto.apropriacoes[osId] (criar entrada se não existir)
   d. Salvar ponto no Supabase
   e. Mesclar { osId, approvedHours: horas, auto: true } em vs_dayresume_<hoje>
   f. Salvar snapshot do log antes de limpar → _undoAprop.logSnapshot
   g. Limpar entradas do vs_time_log_<hoje> para osId
   h. Exibir toast "Xh apropriadas para OS #N  [Desfazer]" com timeout de 5s
4. Continuar com o fluxo original de concludeOS (move status, troca foco, etc.)
```

### `moveOS(osId, newStatus)` — modificada

Quando `newStatus === 'andamento'` e OS vinha de `'concluido'`:
- Limpar entradas de `vs_time_log_<hoje>` para esse osId

### `confirmDayResume()` — modificada

```
1. Ler vs_dayresume_<hoje> existente (pode conter entradas auto: true)
2. Separar entradas auto: true das manuais
3. Coletar entradas manuais dos inputs do modal (as não-auto)
4. Mesclar: entradas auto preservadas + entradas manuais novas
5. Salvar resultado consolidado em vs_dayresume_<hoje>
6. Continuar fluxo original (recalcVelocityFactor, fechar modal, toast)
```

### `renderResumeOsList()` — modificada

Para OSs cujo osId está em entradas `auto: true` de `vs_dayresume_<hoje>`:
- Exibir linha somente leitura com badge **"✓ Auto-apropriado"**
- Horas em cinza, sem input editável
- Não incluir `<input class="resume-h-input">` para essas OSs

### `buildExportPreview()` — sem mudança

Já lê `vs_dayresume_<data>` normalmente — entradas auto aparecem automaticamente.

---

## Ponto criado automaticamente

Quando não existe ponto para hoje:
```js
{
  id: uid(),
  data: hoje,           // 'YYYY-MM-DD'
  dia: diaDaSemana,     // 'Seg', 'Ter', etc.
  marcacoes: '',
  horasTrabalhadas: 0,  // usuário preenche depois
  versaoId: versaoAtual,
  apropriacoes: []
}
```

A barra de apropriação ficará "over" até o usuário preencher `horasTrabalhadas` — comportamento esperado e aceitável.

---

## Estrutura do vs_dayresume_<data> atualizada

```json
{
  "entries": [
    { "osId": "abc123", "approvedHours": 2.5, "auto": true },
    { "osId": "def456", "approvedHours": 1.0 }
  ]
}
```

Entradas sem `auto` são as criadas manualmente pelo Resumo do Dia (comportamento atual).

---

## Fora do escopo

- Apropriação automática de OSs em andamento (não concluídas) — segue fluxo manual do Resumo do Dia
- Retroativo: dias anteriores sem apropriação não são afetados
- Edição das horas auto-apropriadas diretamente no Resumo do Dia (somente leitura nesta iteração)

---

## Critérios de aceite

1. Concluir OS com ≥ 5 min de foco cria apropriação automática e exibe toast com Desfazer
2. Concluir OS com < 5 min de foco não apropia nada
3. Undo restaura timer, ponto e move OS de volta para andamento
4. OS voltando para "Em andamento" zera o timer do dia para ela
5. Ponto de hoje criado automaticamente se não existir (`horasTrabalhadas = 0`)
6. Horas já existentes para a OS no ponto são somadas, não substituídas
7. Resumo do Dia exibe OSs auto-apropriadas como somente leitura com badge
8. `confirmDayResume()` preserva entradas auto no `vs_dayresume_<hoje>`
9. `buildExportPreview()` inclui horas auto-apropriadas no payload do Redmine
