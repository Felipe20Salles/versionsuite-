# Design: Sistema de Permissões por Role — VersionSuite

**Data:** 2026-05-17  
**Arquivo alvo:** `index.html`  
**Abordagem:** Inline, seguindo padrão vanilla JS existente  

---

## Contexto

O VersionSuite passará de 2 para até 25 usuários. É necessário um sistema de permissões granular por role, onde cada role define quais menus e ações cada usuário pode acessar. As permissões são gerenciadas pelo admin diretamente na interface, sem deploy.

---

## 1. Arquitetura e Dados

### Variável global

Adicionar junto a `CURRENT_USER` (linha ~3539):

```javascript
var CURRENT_ROLE = null;
```

### Tabela `roles` no Supabase (já existe)

Estrutura esperada:
```
roles
  id        uuid
  nome      text        -- ex: 'pm', 'gerente', 'admin', 'visualizador'
  label     text        -- ex: 'Product Manager', 'Gerente', 'Administrador'
  permissoes jsonb      -- { acoes: { os_criar: bool, ... }, menus: { boletim: bool, ... } }
```

### Migração de roles

- Adicionar rows `admin` e `visualizador` na tabela `roles` via painel do Supabase
- Remover `membro` dos labels hardcoded (`ROLE_LABELS`, `ROLE_PRIORITY`)
- Usuários com `prefs.role = 'membro'` passam a cair no default `'visualizador'` (comportamento seguro — somente leitura)

### Roles finais na tabela

`gerente`, `superintendente`, `pm`, `documentacao`, `admin`, `visualizador`

### Carregamento no `load()`

Após carregar `prof` do Supabase (linha ~3674), adicionar:

```javascript
var roleNome = (prof && prof.prefs && prof.prefs.role) || 'visualizador';
var { data: roleData } = await sb.from('roles').select('*').eq('nome', roleNome).single();
CURRENT_ROLE = roleData;
```

Se o role não existir na tabela, `CURRENT_ROLE` fica `null` e `can()` / `canMenu()` negam tudo — usuário vê interface somente leitura, sem erros.

---

## 2. Funções de Permissão

Adicionar após `isVisualizador()` (linha ~978):

```javascript
function can(acao) {
  if (!CURRENT_USER || CURRENT_USER.isVisitor || !CURRENT_ROLE) return false;
  return !!(CURRENT_ROLE.permissoes?.acoes?.[acao]);
}

function canMenu(menu) {
  if (!CURRENT_USER || CURRENT_USER.isVisitor || !CURRENT_ROLE) return false;
  return !!(CURRENT_ROLE.permissoes?.menus?.[menu]);
}
```

Atualizar `isAdmin()`:

```javascript
function isAdmin() { return CURRENT_ROLE?.nome === 'admin'; }
```

**Visitors:** `can()` e `canMenu()` retornam `false`. O `applyVisitorMode()` existente permanece intocado para ocultar itens de nav — não há conflito.

---

## 3. Aplicação na Interface

### Sidebar — `goScreen()` e render inicial

Ocultar itens de menu condicionalmente:

| ID do elemento | Condição para exibir |
|---|---|
| `nav-boletim` | `canMenu('boletim')` |
| `nav-ponto` | `canMenu('ponto')` |
| `nav-preferencias` | `canMenu('preferencias')` |

### Topbar actions — dentro de `goScreen()`

| Tela | Botão | Condição |
|---|---|---|
| `kanban` | `+ Nova OS` | `can('os_criar')` |
| `boletim` | (botões de edição) | `can('boletim_editar')` |
| `agenda` | `+ Nova publicação` | `can('agenda_editar')` |

### Botões nas funções de render

| Função | Botão | Condição |
|---|---|---|
| `renderKanban()` | Editar OS | `can('os_editar')` |
| `renderKanban()` | Deletar OS | `can('os_deletar_propria') && os.createdBy === CURRENT_USER.id` |
| `bolRenderOSList()` | Botões de edição do Boletim | `can('boletim_editar')` |
| `renderAgenda()` | Botões de edição da Agenda | `can('agenda_editar')` |
| `renderUsersPrefs()` + nova seção Roles | Seção admin nas Preferências | `can('preferencias_admin')` |

### Regra especial para deletar OS

Nunca permitir deletar OS de outro usuário, independente do role:
```javascript
can('os_deletar_propria') && os.createdBy === CURRENT_USER.id
```

---

## 4. UI de Roles & Permissões nas Preferências

Visível apenas para `can('preferencias_admin')`.

### Parte A — Gerenciar Roles

Lista de cards, um por role, carregados via `sb.from('roles').select('*')`.

**Cada card contém:**
- Header: `label` do role + badge com contagem de usuários naquele role + botão expandir/recolher
- Corpo (expansível): checkboxes em 2 grupos

**Grupo Menus:**
- Boletim (`menus.boletim`)
- Ponto (`menus.ponto`)
- Preferências (`menus.preferencias`)

**Grupo Ações:**
- Criar OS (`acoes.os_criar`)
- Editar OS (`acoes.os_editar`)
- Deletar próprias OSs (`acoes.os_deletar_propria`)
- Editar Boletim (`acoes.boletim_editar`)
- Editar Agenda (`acoes.agenda_editar`)
- Administrar Preferências (`acoes.preferencias_admin`)

**Salvar:** botão "Salvar" por card → `sb.from('roles').update({ permissoes }).eq('id', role.id)`

**Novo role:** botão `+ Novo role` abre modal com campos: nome (slug), label, "herdar permissões de" (select com roles existentes). Cria via `sb.from('roles').insert(...)`.

### Parte B — Usuários (seção existente, com adição)

- Select de role por usuário populado dinamicamente com roles da tabela (não mais hardcoded)
- Visível apenas para `can('preferencias_admin')`
- Salva via `sb.from('profiles').update({ prefs: { ...prefs, role: novoRole } }).eq('id', userId)`
- Usuários sem role definido (ou com role `membro` legado) aparecem com badge âmbar "Não configurado" para facilitar onboarding dos 25 usuários

---

## 5. Matriz de Permissões de Referência

A ser configurada no Supabase pelo admin. Sugestão inicial:

| Permissão | admin | gerente | superintendente | pm | documentacao | visualizador |
|---|---|---|---|---|---|---|
| menus.boletim | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| menus.ponto | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| menus.preferencias | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| acoes.os_criar | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| acoes.os_editar | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| acoes.os_deletar_propria | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| acoes.boletim_editar | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| acoes.agenda_editar | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| acoes.preferencias_admin | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

> Esta matriz é uma sugestão. O admin pode ajustar diretamente na interface após o deploy.

---

## 6. Comportamentos de Borda

| Cenário | Comportamento |
|---|---|
| Role não existe na tabela | `CURRENT_ROLE = null` → tudo negado → interface somente leitura |
| Usuário com `prefs.role = 'membro'` (legado) | Cai em `visualizador` como default seguro |
| Visitor tenta acessar tela bloqueada | Comportamento existente permanece (`applyVisitorMode()`) |
| Admin deleta o próprio role | `isAdmin()` retorna false na próxima sessão — não bloqueia a sessão atual |
| Novo usuário sem role atribuído | `visualizador` por default — vê interface limpa, somente leitura |

---

## Fora de Escopo

- Criação da tabela `roles` (já existe)
- RLS (Row Level Security) no Supabase — não alterado
- Alteração de qualquer funcionalidade não citada no prompt
