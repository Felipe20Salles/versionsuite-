# Design: Redesign do Menu Preferências — VersionSuite

**Data:** 2026-05-17
**Arquivo alvo:** `index.html`, `netlify/functions/zendesk.js`
**Abordagem:** Inline, seguindo padrão vanilla JS existente

---

## Contexto

O menu Preferências mistura configurações pessoais (aparência, cor) com configurações administrativas (usuários, perfis, integrações) em uma única lista vertical sem hierarquia clara. Além disso, credenciais sensíveis (chaves de API do Zendesk e Redmine) ficam armazenadas no `localStorage` do browser, acessíveis via DevTools.

---

## 1. Estrutura de Abas

A tela de Preferências passa a ter três abas no topo. A aba **Admin** só é renderizada e visível para usuários com `isAdmin() === true`.

### Aba: Pessoal
Configurações individuais — visível para todos os usuários.

| Seção atual | Mantém? |
|---|---|
| Aparência (dark/light) | ✅ |
| Cor de destaque | ✅ |

### Aba: Plataforma
Configurações da ferramenta — visível para todos, apenas admin pode editar.

| Seção atual | Mantém? |
|---|---|
| Produtos cadastrados | ✅ |
| Tipo de Atividade | ✅ |
| Acesso de Visitantes | ✅ |

### Aba: Admin
Oculta para não-admins. Renderizada via `isAdmin()`.

| Seção atual | Mantém? | Observação |
|---|---|---|
| Usuários da plataforma | ✅ | Move para cá |
| Perfis de Acesso | ✅ | Move para cá |
| Integração Redmine | ✅ parcial | Campos sensíveis removidos |
| Integração Zendesk | ✅ parcial | Campos sensíveis removidos |

### Comportamento das abas

- Aba ativa armazenada em variável JS `_prefTab` (sem persistência — sempre abre em `'pessoal'`).
- Função `goPrefsTab(nome)` aplica `display:none` / `display:block` nos painéis.
- Aba Admin invisível (`display:none` no botão) quando `!isAdmin()`.
- `goScreen('preferencias')` continua funcionando igual — chama `renderRolesPrefs()`, `renderUsersPrefs()` etc. após definir a aba inicial.

---

## 2. Segurança das Integrações

### 2a. Zendesk → Netlify Function

**Problema:** subdomain, e-mail e token ficam no `localStorage`.

**Solução:** criar `netlify/functions/zendesk.js` que lê as credenciais de variáveis de ambiente do Netlify e expõe um endpoint `/.netlify/functions/zendesk`.

**Variáveis de ambiente necessárias (painel Netlify):**
```
ZENDESK_SUBDOMAIN=suaempresa.zendesk.com
ZENDESK_EMAIL=voce@empresa.com
ZENDESK_TOKEN=seu-token-api
```

**Endpoint:** `GET /.netlify/functions/zendesk?type=tickets|articles`

**O que some da UI:** campos "Subdomínio", "E-mail do agente", "Token de API", checkbox "Usar proxy local".

**O que fica na UI:**
- Badge de status: "Zendesk: conectado ✓" / "desconectado ✗" (resultado do último teste)
- Botão "Testar conexão" (chama o endpoint e atualiza badge)
- Nota: "Credenciais configuradas via variáveis de ambiente do Netlify"

**Migração do frontend:**
- Remover leitura de `localStorage` para `zendeskConfig`
- Substituir chamadas diretas à API do Zendesk pela chamada ao endpoint Netlify
- Status de conexão persiste em `localStorage` apenas como cache de UI (não sensível)

### 2b. Redmine → proxy local melhorado

**Problema:** chave API fica no `localStorage`.

**Solução:** o proxy já lê `REDMINE_KEY` via `.env`. O frontend para de armazenar e enviar a chave.

**O que some da UI:** campo "Chave API".

**O que fica na UI:**
- "URL do proxy" (ex: `http://localhost:3001`) — não sensível
- "ID de atividade padrão" — não sensível
- Checkbox "Proxy ativo"
- Instruções de setup: `node redmine-proxy.js` com link para `.env.example`

**Migração do frontend:**
- Remover `key` de `getRedmineConfig()` / `saveRedmineConfig()`
- O proxy passa a receber chamadas sem credencial no header — ele mesmo injeta `X-Redmine-API-Key` a partir do `.env`
- Atualizar `redmine-proxy.js` para sempre usar `process.env.REDMINE_KEY` (já implementado parcialmente)

### 2c. `.env.example` para o proxy

Criar `redmine.env.example` na raiz com:
```
REDMINE_URL=http://192.168.0.1/redmine
REDMINE_KEY=sua-chave-api-aqui
```

---

## 3. O que não muda

- Toda a lógica de negócio das integrações (importar issues, exportar horas) permanece intacta
- `renderUsersPrefs()`, `renderRolesPrefs()`, `renderProdutos()`, `renderTipoAtividades()` — sem alteração de lógica
- Sistema de permissões (`can()`, `canMenu()`) — sem alteração
- RLS e Supabase — sem alteração

---

## 4. Fora de Escopo

- Redesign visual dos cards de usuário ou perfis de acesso
- Novas funcionalidades nas integrações
- Migração de outros dados do `localStorage` para Supabase
