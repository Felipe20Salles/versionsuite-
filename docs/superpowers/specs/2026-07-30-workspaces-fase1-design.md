# Design: Workspaces Multi-Tenant — Fase 1 (Fundação de Dados + RLS)

**Data:** 2026-07-30
**Arquivo alvo:** `index.html` + novo `supabase/migrations/`
**Abordagem:** Inline, seguindo padrão vanilla JS existente. Sem mudança visível para o usuário final.

---

## Contexto

O VersionSuite hoje é single-tenant: existe um único espaço global, com um catálogo global de `roles` e um único fluxo de aprovação de acesso (`profiles.role` + `profiles.prefs.status`). O objetivo de longo prazo é vender o VersionSuite como SaaS para outras empresas, cada uma isolada em seu próprio **workspace**, podendo um mesmo usuário pertencer a vários workspaces.

Essa mudança é grande demais para uma spec só, e foi dividida em 3 sub-projetos:

1. **Fase 1 (esta spec)** — fundação de dados: novas tabelas, `workspace_id` nas tabelas existentes, RLS real no Postgres, migração dos dados atuais para um "workspace inicial". Nenhuma UI nova — o app continua se comportando exatamente como hoje.
2. **Fase 2** — gestão de workspace na UI: criação self-serve, convite por e-mail + link compartilhável, switcher de workspace, senha de visitante por workspace, tela de roles já escopada por workspace.
3. **Fase 3** — mover configuração de integração Redmine/Zendesk do `localStorage` do navegador para o banco, por workspace.

Cada fase terá seu próprio ciclo spec → plano → implementação. Esta spec cobre **apenas a Fase 1**.

### Por que RLS entra já na Fase 1

Hoje o controle de acesso é 100% client-side (`can()`/`canMenu()`/`isAdmin()` em JS); não há RLS no Supabase. Isso é aceitável num espaço único onde todo mundo já é "da casa", mas se torna um risco real de vazamento de dados entre empresas clientes assim que existir mais de um workspace acessível pela mesma anon key. Por isso a Fase 1 já sai com isolamento de verdade no Postgres, não só um filtro a mais no JS.

---

## 1. Modelo de Dados

### Tabelas novas

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references auth.users(id),
  role_id uuid references roles(id),
  status text not null default 'pending' check (status in ('pending','active','rejected')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
```

Sem campos de plano/billing — fora de escopo (YAGNI nesta fase).

### Tabelas existentes que ganham `workspace_id`

`roles`, `equipes`, `produtos`, `versoes`, `oss`, `pontos`, `publicacoes` — todas ganham coluna `workspace_id uuid not null references workspaces(id)`.

A tabela `roles` deixa de ser um catálogo global e passa a ser o catálogo de papéis **daquele workspace** — sem duplicar lógica, só ganha o filtro (Fase 2 pode então customizar roles por empresa cliente sem retrabalho de schema).

### `profiles` — muda de dono, não de forma

`profiles` **não** ganha `workspace_id` — continua sendo só identidade (nome, avatar, e-mail, prefs pessoais). O que hoje vive em `profiles.role` (papel) e `profiles.prefs.status` (pendente/ativo/rejeitado) muda de dono: passa a viver inteiramente em `workspace_members.role_id` / `workspace_members.status`, pois papel e status de aprovação agora são por *membership*, não por identidade global.

A coluna `profiles.role` é removida ao final da migração (passo de limpeza, seção 3) — sem manter coluna morta ou lógica de fallback permanente.

---

## 2. RLS (Row Level Security)

Function helper central:

```sql
create or replace function is_workspace_member(ws_id uuid, only_active boolean default true)
returns boolean language sql security invoker stable as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
    and (not only_active or status = 'active')
  )
$$;
```

### Tabelas de domínio (`oss`, `versoes`, `produtos`, `pontos`, `publicacoes`, `equipes`)

- `SELECT`/`INSERT`/`UPDATE`/`DELETE`: `USING/WITH CHECK (is_workspace_member(workspace_id))`. Membro pendente não enxerga nada (mesmo espírito do "aguardando aprovação" atual).

### `roles`

- `SELECT`: `is_workspace_member(workspace_id)`.
- `INSERT`/`UPDATE`/`DELETE`: só membro ativo cujo `role_id` aponta para um role com `nome = 'admin'` naquele workspace (mantém o comportamento atual de edição de permissões restrita a admin).

### `workspace_members`

- `SELECT`: a própria linha do usuário (`user_id = auth.uid()`) **ou** qualquer linha do mesmo workspace se ele for membro ativo (para listar colegas).
- `UPDATE`: só admin do workspace pode alterar `status`/`role_id` de outra linha — substitui `approveUser`/`rejectUser`.
- `INSERT`: bloqueado para o client nesta fase (sem criação/convite de workspace ainda — isso é Fase 2). Só a migração, rodando com service role, insere linhas.

### `workspaces`

- `SELECT`: usuário só vê workspaces onde tem alguma linha em `workspace_members` (pendente ou ativo) — permite a tela de pendente mostrar o nome do workspace aguardando aprovação.
- `INSERT`/`UPDATE`/`DELETE`: bloqueado para o client nesta fase, mesmo motivo do `workspace_members.INSERT`.

Isso garante isolamento real: mesmo manipulando a API diretamente com a anon key, é impossível ler ou escrever fora do(s) workspace(s) em que o usuário é membro ativo.

---

## 3. Migração / Rollout

Sem projeto de staging disponível — tudo roda em produção, em estágios, para nunca deixar o app quebrado no meio do caminho.

### Passo 0 — Backup

Dump manual do banco (Supabase Dashboard/CLI) antes de qualquer alteração. É o "desfazer" caso algo dê errado.

### Passo 1 — Migração aditiva (`supabase/migrations/2026-07-30_workspaces_fase1_add.sql`)

1. Criar `workspaces` e `workspace_members`.
2. Inserir a linha do **workspace inicial** (nome a definir com o usuário antes da execução).
3. Adicionar `workspace_id` **nullable** nas 7 tabelas existentes.
4. `UPDATE` em massa: todas as linhas existentes recebem o id do workspace inicial.
5. Alterar `workspace_id` para `NOT NULL` nas 7 tabelas.
6. Backfill de `workspace_members`: para cada `profiles` com `role` preenchido (aprovado) ou pendente, criar a linha correspondente no workspace inicial, carregando `role_id`/`status` do estado atual.

Nada disso quebra o app atual — client antigo não referencia `workspace_id`, e RLS ainda não está ativo.

### Passo 2 — Verificação SQL

Contagens: linhas com `workspace_id` preenchido em cada uma das 7 tabelas batem com o total anterior; contagem de `workspace_members` bate com o total de perfis aprovados+pendentes.

### Passo 3 — Deploy do client atualizado (seção 4), RLS ainda desligado

Percorrer o app inteiro logado como usuário real (Dashboard, Demandas Kanban/Ciclo incluindo o filtro de produto, Agenda, Ponto, Preferências/Roles, importação do Redmine), conferindo que nada muda visualmente e sem erros no console. Como RLS ainda está desligado, um eventual bug no filtro por `workspace_id` não bloqueia ninguém — dá para observar com calma.

### Passo 4 — Habilitar RLS + policies (`supabase/migrations/2026-07-30_workspaces_fase1_rls.sql`)

Só depois de confirmar (de preferência fora do horário de pico) que o client novo já filtra certo. Rollback pronto: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` nas 7 tabelas, para rodar imediatamente se algo ficar vazio.

Verificação:
- **Positivo**: como membro ativo, todas as telas continuam trazendo os mesmos dados.
- **Negativo** (prova real de isolamento): requisição direta à API do Supabase (curl/script, anon key + JWT de um usuário que não está em `workspace_members` daquele workspace) confirmando que `SELECT`/`INSERT` nas 7 tabelas voltam vazio/são rejeitados.
- Checar logs do Supabase por erros de policy logo após ligar.

### Passo 5 — Limpeza (`supabase/migrations/2026-07-30_workspaces_fase1_cleanup.sql`)

Só alguns dias depois, com tudo estável: dropar `profiles.role` e parar de escrever `profiles.prefs.status`.

---

## 4. Mudanças no Client (`index.html`)

Todas invisíveis para o usuário final — mesmo comportamento, canalização nova:

- **`CURRENT_WORKSPACE_ID`**: resolvido no login, após `getSession()`, buscando a(s) linha(s) de `workspace_members` do usuário. Nesta fase existe só uma (a migrada). Equivalente conceitual ao `S.versaoK`, em escopo mais alto. O switcher para múltiplos workspaces é Fase 2 — aqui a variável já existe, só não tem UI para trocar.
- **Todas as queries das 7 tabelas** (`sb.from('oss'|'versoes'|'produtos'|'pontos'|'publicacoes'|'equipes'|'roles')`) ganham `.eq('workspace_id', CURRENT_WORKSPACE_ID)` nas leituras e `workspace_id: CURRENT_WORKSPACE_ID` nos inserts/upserts.
- **`isAdmin()` / `can()` / `canMenu()`**: passam a resolver `CURRENT_ROLE`/`CURRENT_ROLE_NAME` a partir da linha de `workspace_members` do usuário (join com `roles`), em vez de `profiles.role`.
- **`mostrarPendente()`**: dispara com base em `workspace_members.status !== 'active'` para o workspace resolvido, em vez de `profiles.role == null`.
- **`approveUser`/`rejectUser`**: passam a fazer `update` em `workspace_members` (`status`/`role_id`) em vez de em `profiles`.
- Bootstrap "primeiro usuário vira admin": não precisa de lógica nova nesta fase — a migração já insere as `workspace_members` corretas para os usuários existentes. Esse comportamento por-workspace só volta a ser relevante quando a criação self-serve chegar na Fase 2.

---

## 5. Testes e Verificação

Sem suíte automatizada no repo (arquivo estático único) — verificação manual, alinhada aos passos da seção 3:

| Passo | O que verificar |
|---|---|
| Migração aditiva | Contagens de linhas por tabela batem com o estado anterior |
| Deploy client (RLS off) | Percurso completo do app sem mudança visível, sem erro no console; reteste do filtro de produto e da migração de OS entre versões (correções desta sessão) |
| RLS ligado — positivo | Todas as telas continuam trazendo os mesmos dados como membro ativo |
| RLS ligado — negativo | Requisição direta à API com JWT de não-membro retorna vazio/rejeitado nas 7 tabelas |
| Pós-RLS | Logs do Supabase sem erros de policy |
| Limpeza | Só após dias estáveis sem regressão relatada |

---

## Fora de Escopo (Fase 1)

- Criação/convite de novos workspaces (Fase 2)
- Switcher de workspace na UI (Fase 2)
- Senha de visitante por workspace (Fase 2)
- Tela de gestão de roles adaptada para múltiplos workspaces (Fase 2 — nesta fase o schema já suporta, mas a UI de Preferências continua assumindo um único workspace)
- Configuração de Redmine/Zendesk por workspace (Fase 3 — continua em `localStorage` por enquanto)
- Billing/planos por workspace
- Qualquer alteração de UI visível ao usuário final
