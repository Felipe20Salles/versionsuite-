# Design: Integração Redmine no Kanban — VersionSuite

**Data:** 2026-05-17
**Arquivo alvo:** `index.html`
**Abordagem:** Inline, vanilla JS, via proxy local (`redmine-proxy.js`)

---

## Contexto

O Kanban do VersionSuite tem um botão "Importar do Redmine" que já existe mas está quebrado: cards importados recebem `status:'backlog'` (coluna inexistente), então somem da tela. Além disso, mudanças de coluna no VersionSuite não refletem no Redmine.

### Hierarquia de tasks no Redmine do cliente

```
OS de Serviço  (tracker: "Ordem de Serviço") — Vô
  └── OS de Produto  (tracker: "OSxProduto") — Pai
       └── Card normal  (tracker: "Melhoria" | "Correção" | "Suporte" | "Demandas Internas") — folha
```

Somente os **cards normais** (folha) devem ser importados. OS de Serviço e OS de Produto nunca entram no Kanban.

Esta spec cobre:
1. **GET** — corrigir e robustificar a importação de issues
2. **PUT** — sincronizar mudança de coluna no VersionSuite com o status da issue no Redmine
3. **UI** — badge de tipo no card + renomear "OS" para "Card"

---

## 1. GET — Importar issues do Redmine

### Filtro de importação

Query:
```
GET /issues.json?assigned_to_id=me&status_id=open&limit=100&include=children
```

Filtro JS após receber a resposta (dois critérios obrigatórios):
```javascript
var TIPOS_FILHOS = ['Correção','Melhoria','Suporte','Demandas Internas'];
issues.filter(function(iss){
  return TIPOS_FILHOS.indexOf(iss.tracker.name) > -1 && iss.parent;
})
```

- **Tipo filho** — exclui OS de Serviço e OS de Produto pelo tracker
- **Tem pai** — segurança extra contra issues raiz mal classificadas

### O que muda

**Bug fix:** `importarDoRedmine()` cria OS com `status:'backlog'`. Corrigir para `status:'afazer'`.

**Novos campos importados na OS:**
```javascript
{
  // campos existentes
  num:    String(iss.id),
  titulo: iss.subject || '',
  obs:    iss.description || '',
  atribuicao: iss.assigned_to ? iss.assigned_to.name : '',
  produto:    iss.project ? iss.project.name : '',
  // campos novos
  tipoRedmine: iss.tracker ? iss.tracker.name : '',   // "Melhoria", "Correção", etc.
  paiRedmine:  iss.parent  ? String(iss.parent.id) : '' // ID da OS de Produto (pai)
}
```

**Modal de importação** — cada item lista:
`[Tipo] #ID — Título (Pai: #ID_PAI)`

Exemplo: `[Melhoria] #4521 — Corrigir login SSO (Pai: #4100)`

**Feedback de erro:**
- Proxy inativo: `"Ative o proxy Redmine nas Preferências"`
- Erro de rede/Redmine: `"Erro ao conectar ao Redmine: <mensagem>"`

**Deduplicação:** mantida — issues com mesmo `num` na versão ativa são ignoradas.

### Fluxo

1. Clica "🔴 Importar do Redmine"
2. Valida `cfg.proxyUrl && cfg.proxy` → toast se não configurado
3. GET com filtro acima
4. Aplica filtro JS (tipo filho + tem pai)
5. Exclui issues já importadas na versão ativa
6. Modal lista novas issues com tipo, ID, título e pai
7. Confirma → cria OS com `status:'afazer'` + `tipoRedmine` + `paiRedmine` → salva Supabase → renderKanban

---

## 2. PUT — Sincronizar status ao mover coluna

### Mapeamento de status (configurável nas Preferências)

Novo bloco na aba Admin → seção Redmine, abaixo das configurações existentes.

**UI:**
```
[ Carregar status disponíveis ]   ← GET /issue_statuses.json

A fazer      → [ select: status Redmine ]
Em andamento → [ select: status Redmine ]
Concluído    → [ select: status Redmine ]
```

- Botão "Carregar status" faz GET em `/issue_statuses.json` e popula os 3 selects
- Cada option: `value = id numérico`, `label = nome` (ex: "Backlog: Priorizado")
- Config salva em `localStorage` como `vs_redmine_status_map`:
  ```json
  { "afazer": 1, "andamento": 5, "concluido": 3 }
  ```
- Selects recarregam valores salvos na abertura das Preferências

### Novas funções JS

```javascript
function getRedmineStatusMap()               // lê vs_redmine_status_map do localStorage
function saveRedmineStatusMap(map)           // salva no localStorage
async function loadRedmineStatuses()         // GET /issue_statuses.json → popula selects
async function sincronizarStatusRedmine(os, novoStatus)  // PUT /issues/:num.json
```

### Trigger no Kanban

A função que muda o status de uma OS (botões ← → nos cards) chama `sincronizarStatusRedmine(os, novoStatus)` após salvar localmente.

**Condições para o PUT:**
- `cfg.proxy && cfg.proxyUrl` ativo
- `os.num` é numérico (veio do Redmine)
- `getRedmineStatusMap()[novoStatus]` existe

**Se falhar silenciosamente:** nenhuma condição → ignora sem toast.
**Sucesso:** toast `"Redmine atualizado ✓"`
**Erro:** toast `"Falha ao atualizar Redmine ✗"` (não bloqueia o Kanban)

### Payload

```
PUT /issues/{os.num}.json
{ "issue": { "status_id": <id_do_mapa> } }
```

---

## 3. UI — Badge de tipo + renomear "OS" para "Card"

### Badge de tipo no card

Campo `tipoRedmine` renderizado como badge colorido no card do Kanban, ao lado do badge de produto.

Cores por tipo:
| Tipo | Cor |
|---|---|
| Melhoria | azul (`rgba(59,130,246,.15)` / `#3b82f6`) |
| Correção | vermelho (`rgba(239,68,68,.12)` / `#ef4444`) |
| Suporte | amarelo (`rgba(245,158,11,.15)` / `#f59e0b`) |
| Demandas Internas | roxo (`rgba(124,111,247,.15)` / `#7c6ff7`) |

Cards sem `tipoRedmine` (criados manualmente) não exibem o badge.

### Renomear "OS" → "Card"

Onde o card exibe `"OS 4521"`, passa a exibir `"Card 4521"`.
Afeta apenas o texto visível no card — o campo `num` e a lógica interna não mudam.

---

## 4. O que não muda

- `enviarAoRedmine()` (exportar horas)
- Estrutura das colunas (`afazer`, `andamento`, `concluido`)
- Proxy local (`redmine-proxy.js`)
- Deduplicação e modal de confirmação (estrutura)

---

## 5. Fora de escopo

- Sincronização bidirecional (Redmine → VersionSuite em tempo real)
- Atualizar título/descrição da issue ao editar OS
- Criar issues no Redmine a partir do VersionSuite
- Importar por projeto ou versão/milestone do Redmine
- Exibir a hierarquia completa (Vô → Pai → Card) no card do Kanban
