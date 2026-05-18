# Design: Integração Redmine no Kanban — VersionSuite

**Data:** 2026-05-17
**Arquivo alvo:** `index.html`
**Abordagem:** Inline, vanilla JS, via proxy local (`redmine-proxy.js`)

---

## Contexto

O Kanban do VersionSuite tem um botão "Importar do Redmine" que já existe mas está quebrado: cards importados recebem `status:'backlog'` (coluna inexistente), então somem da tela. Além disso, mudanças de coluna no VersionSuite não refletem no Redmine.

Esta spec cobre duas melhorias:
1. **GET** — corrigir e robustificar a importação de issues
2. **PUT** — sincronizar mudança de coluna no VersionSuite com o status da issue no Redmine

---

## 1. GET — Importar issues do Redmine

### O que muda

**Bug fix:** `importarDoRedmine()` cria OS com `status:'backlog'`. Corrigir para `status:'afazer'` (coluna "A fazer" do Kanban).

**Filtro:** mantém `assigned_to_id=me&status_id=open&limit=100` — apenas issues abertas atribuídas ao usuário logado.

**Feedback de erro:** se o proxy não estiver ativo ou retornar erro, exibir toast claro:
- Proxy inativo: `"Ative o proxy Redmine nas Preferências"`
- Erro de rede/Redmine: `"Erro ao conectar ao Redmine: <mensagem>"`

**Deduplicação:** mantida — issues já importadas (mesmo `num`) não aparecem no modal.

### Fluxo (sem mudança estrutural)

1. Usuário clica "🔴 Importar do Redmine"
2. Valida `cfg.proxyUrl && cfg.proxy` → toast se não configurado
3. GET `/issues.json?assigned_to_id=me&status_id=open&limit=100`
4. Filtra issues já importadas na versão ativa
5. Modal lista as novas issues com título e ID
6. Usuário confirma → cria OS com `status:'afazer'` → salva Supabase → renderKanban

---

## 2. PUT — Sincronizar status ao mover coluna

### Mapeamento de status (configurável)

Novo bloco nas Preferências → aba Admin → seção Redmine, abaixo das configurações existentes.

**UI:**
```
[ Carregar status disponíveis ]   ← botão: GET /issue_statuses.json

A fazer      → [ select: status Redmine ]
Em andamento → [ select: status Redmine ]  
Concluído    → [ select: status Redmine ]
```

- Botão "Carregar status" popula os 3 selects com os status disponíveis no Redmine
- Cada option: `value = id numérico`, `label = nome do status` (ex: "Backlog: Priorizado")
- Configuração salva em `localStorage` como `vs_redmine_status_map`:
  ```json
  { "afazer": 1, "andamento": 5, "concluido": 3 }
  ```
- Valores persitem entre sessões; selects recarregam da config salva se disponíveis

### Novas funções JS

```javascript
function getRedmineStatusMap() { /* lê vs_redmine_status_map do localStorage */ }
function saveRedmineStatusMap(map) { /* salva no localStorage */ }
async function loadRedmineStatuses() { /* GET /issue_statuses.json → popula selects */ }
async function sincronizarStatusRedmine(os, novoStatus) { /* PUT /issues/:num.json */ }
```

### Trigger no Kanban

Função `moverOS(osId, dir)` (ou equivalente que muda o status da OS) deve chamar `sincronizarStatusRedmine` após salvar localmente.

Condições para o PUT acontecer:
- `cfg.proxy && cfg.proxyUrl` está ativo
- `os.num` é numérico (issue importada do Redmine)
- `getRedmineStatusMap()[novoStatus]` existe (mapeamento configurado)

**Se qualquer condição falhar:** ignora silenciosamente (sem toast, sem erro).

**Se o PUT tiver sucesso:** toast discreto `"Redmine atualizado ✓"`

**Se o PUT falhar:** toast `"Falha ao atualizar Redmine ✗"` (não bloqueia o fluxo do Kanban)

### Payload PUT

```
PUT /issues/{os.num}.json
{ "issue": { "status_id": <id_do_mapa> } }
```

---

## 3. O que não muda

- Fluxo de importação (modal de confirmação, deduplicação, campos da OS)
- `enviarAoRedmine()` (exportar horas)
- Estrutura das colunas do Kanban (`afazer`, `andamento`, `concluido`)
- Proxy local (`redmine-proxy.js`) — já suporta `d.path`

---

## 4. Fora de escopo

- Sincronização bidirecional (Redmine → VersionSuite em tempo real)
- Atualizar título/descrição da issue ao editar OS
- Criar issues no Redmine a partir do VersionSuite
- Importar issues por projeto ou versão/milestone
