# Design: Workspaces Multi-Tenant — Fase 2a (Criação de Workspace + Switcher)

**Data:** 2026-08-13
**Arquivo alvo:** `index.html` + novo `supabase/migrations/`
**Abordagem:** Inline, seguindo padrão vanilla JS existente. Primeira mudança de UI visível desde a Fase 1.
**Decisões de design revisadas por:** Norte (proxy de decisão do Felipe, ver `paralelo-studio/.claude/agents/norte.md`) nos itens A1/A2/B1/B2/B3/C abaixo.

---

## Contexto

A Fase 1 (`docs/superpowers/specs/2026-07-30-workspaces-fase1-design.md`) deixou o banco pronto para multi-tenant (tabelas `workspaces`/`workspace_members`, RLS real, `workspace_id` em todas as tabelas de domínio), mas o client continua preso a um único workspace fixo: `resolveCurrentWorkspace()` (`index.html:5227`) sempre resolve o slug hardcoded `'default'`. Não existe UI para criar um segundo workspace nem para trocar entre workspaces — isso foi deliberadamente deixado fora de escopo na Fase 1, reservado para a "Fase 2".

A Fase 2 completa (criação self-serve, convite por e-mail/link, switcher, senha de visitante por workspace, tela de roles multi-workspace) é grande demais para uma spec só. Esta spec cobre apenas o sub-projeto **Fase 2a**: criação de workspace (restrita por allowlist) + switcher. Convite por link/e-mail, senha de visitante por workspace e tela de roles multi-workspace ficam para sub-projetos futuros.

### Motivação

O Felipe deixou o emprego CLT onde usava o VersionSuite com uma única empresa (workspace `'LG'`/`'default'`, seedado na Fase 1). Ele passa a usar o mesmo app em múltiplas empresas/projetos como autônomo, sem abandonar ou apagar os dados da `LG` — precisa apenas de uma forma de criar workspaces novos e trocar entre eles.

### Por que restringir criação por allowlist

O login hoje é só Google OAuth, sem gatekeeper — a "aprovação" existente é só dentro de um workspace já existente (`workspace_members.status`). Sem uma allowlist, qualquer conta Google válida poderia criar um workspace e virar admin dele. Como o app não é (ainda) um produto público, a criação fica restrita a uma lista de e-mails autorizados.

---

## 1. Modelo de Dados

### Tabela nova

```sql
create table workspace_creators (
  email text primary key
);
```

Sem FK para `profiles`/`auth.users` — o e-mail pode ser cadastrado antes da pessoa nunca ter logado. Sem policy de SELECT/INSERT para o client: a tabela só é lida pela RPC `bootstrap_login` (security definer). Gestão é manual via SQL Editor do Supabase, no mesmo padrão usado hoje para o resto da administração.

### `roles` — seed do admin em workspace novo

A tabela `roles` (pré-existente, ganhou `workspace_id` na Fase 1) é por-workspace: um workspace novo nasce **sem nenhum role**. `create_workspace` precisa semear pelo menos o role `admin`.

Confirmado lendo `index.html:1499-1505` (`can()`/`canMenu()`): o bypass de permissão do admin é feito **pelo nome do role** (`CURRENT_ROLE_NAME==='admin'`), não pelo conteúdo de `permissoes` — então não há necessidade (nem benefício de robustez) em clonar `permissoes` de outro workspace. O seed usa um JSON literal estável, no mesmo formato usado em `roles.insert` (`index.html:2166`):

```sql
insert into roles (nome, label, permissoes, workspace_id)
values ('admin', 'Admin', '{"acoes":{},"menus":{}}'::jsonb, novo_workspace_id)
returning id;
```

---

## 2. RPCs novas

### `bootstrap_login()` — substitui `resolveCurrentWorkspace()`

Security definer (bypassa a ausência de policy de SELECT em `workspaces`/`workspace_creators`). Retorna num único roundtrip:

```sql
{ workspaces: [{ id, nome, slug, status }, ...], can_create: boolean }
```

- `workspaces`: memberships do usuário (`auth.uid()`) com `status in ('active','pending')` — **exclui `rejected`** (consistente com o tratamento já usado em `ensure_workspace_membership`, migration `2026-07-30_03`: um usuário só-rejeitado em um workspace deve cair no mesmo fluxo de quem não tem workspace nenhum, não ficar travado).
- `can_create`: `exists(select 1 from workspace_creators where email = auth.jwt()->>'email')`.

Um único RPC em vez de duas chamadas sequenciais (`list_my_workspaces` → se vazio, `can_create_workspace`): evita latência e estado de loading extra no caso mais comum (zero workspaces), sem abrir mão de nenhuma garantia de segurança — a tabela `workspace_creators` continua invisível ao client.

### `create_workspace(nome text, slug text)`

Security definer, atômica (uma única function = uma transação):

1. Confere `can_create` (mesma checagem de `bootstrap_login`) — `raise exception` se não autorizado.
2. `insert into workspaces (nome, slug, created_by) values (nome, slug, auth.uid()) returning id`.
3. Semeia o role `admin` (seção 1 acima).
4. `insert into workspace_members (workspace_id, user_id, role_id, status) values (novo_id, auth.uid(), admin_role_id, 'active')`.
5. Slug duplicado: a constraint `unique` em `workspaces.slug` estoura erro naturalmente — o client trata como erro de validação (ver seção 4). Essa constraint também é a proteção real contra duplo-submit (cliques duplos no botão criam duas chamadas, mas a segunda falha na constraint; desabilitar o botão durante a chamada é UX, não a camada de correção).

---

## 3. Fluxo de Login (client)

Substitui o corpo de `resolveCurrentWorkspace()`. Após `getSession()`, chama `bootstrap_login()`:

- **0 workspaces, `can_create=true`** → tela "Criar workspace" (seção 4).
- **0 workspaces, `can_create=false`** → tela "sem acesso", dead-end (seção 4) — convite por link/e-mail é sub-projeto futuro, não existe forma de entrar sem allowlist ou convite manual (admin insere `workspace_members` direto via SQL, como hoje).
- **1 workspace** → seleciona automaticamente, `CURRENT_WORKSPACE_ID` = esse id. **Comportamento idêntico ao atual** — quem só tem a `LG` não vê nenhuma diferença.
- **2+ workspaces** → switcher: lista os `status='active'` (nome + seleção), lembra a última escolha em `localStorage` (chave por usuário) para pular direto da próxima vez. Sempre acessível depois via item no menu do usuário — não só no primeiro login — permitindo trocar de workspace ou criar mais um a qualquer momento (se `can_create=true`).
- Se o workspace resolvido tiver `status='pending'` → cai na tela de pendente já existente (`mostrarPendente()`), sem mudança nesse fluxo.

Depois de resolvido, `CURRENT_WORKSPACE_ID` segue usado exatamente como hoje pelo resto do app — nenhuma mudança em queries, `isAdmin()`, `can()`, etc.

---

## 4. Telas novas

### "Criar workspace"

- Campo **Nome do workspace** (placeholder: "ex.: Nome do Cliente ou Projeto"). No `oninput`, gera o slug automaticamente (slugify: minúsculas, remove acento, espaço→hífen).
- Campo **Identificador** (slug), pré-preenchido pelo auto-gerado, **editável** — assim que o usuário mexer manualmente nele, o campo fica "dirty" e para de auto-atualizar a partir do nome (evita sobrescrever uma correção manual). Hint: "usado internamente, sem espaços".
- Botão **"Criar workspace"**, desabilitado + texto "Criando..." durante a chamada RPC.
- Erro de slug duplicado (inline, sem travar o form): **"Já existe um workspace com esse identificador. Escolha outro."**

### "Sem acesso" (dead-end)

Copy: **"Você ainda não tem acesso a nenhum workspace. Peça para alguém te convidar."** — sem botão de ação (é dead-end mesmo nesta fase; deixa claro que não é erro do sistema, evita abertura de suporte desnecessária).

---

## 5. Testes e Verificação

Sem suite automatizada (app é um `index.html` único; Fase 1 foi validada manualmente em produção real + code review por subagente). Roteiro manual pós-implementação:

1. E-mail na allowlist, login novo (conta que nunca logou) → tela "Criar workspace" aparece; criar → confere no Table Editor que `workspaces` + `workspace_members` (admin, active) + `roles` (admin) foram criados corretamente; app carrega já escopado pro novo workspace.
2. Membro único da `LG` loga → comportamento idêntico ao atual, sem fricção nova (auto-seleciona, sem tela extra).
3. Admin com 2 memberships (`LG` + o novo) → switcher aparece, troca funciona, dados de um workspace não vazam pro outro.
4. E-mail fora da allowlist, zero memberships → tela "sem acesso", sem forma de criar.
5. Slug duplicado → erro inline claro, form não trava.
6. Duplo-clique real no botão "Criar workspace" → confirma que a constraint `unique` se comporta como esperado (segunda chamada falha) e que a UI mostra o erro de forma sensata na segunda tentativa.

---

## Fora de Escopo (Fase 2a)

- Convite por e-mail/link compartilhável (Fase 2b)
- Senha de visitante por workspace (Fase 2b)
- Tela de gestão de roles adaptada para múltiplos workspaces (Fase 2b)
- UI de gestão da tabela `workspace_creators` (continua manual via SQL Editor)
- URL/subdomínio por tenant (decidido: switcher in-app, mesma URL para todos os workspaces)
- Billing/planos por workspace
- Deletar/arquivar workspaces
