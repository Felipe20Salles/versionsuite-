# Design: Workspaces Multi-Tenant — Fase 2b (Convite por E-mail)

**Data:** 2026-08-23
**Arquivo alvo:** `index.html` + novo `supabase/migrations/`
**Abordagem:** Inline, seguindo padrão vanilla JS existente. Extensão da seção "Usuários" (Preferências) já existente, não uma tela nova.

---

## Contexto

A Fase 2a (`docs/superpowers/specs/2026-08-13-workspaces-fase2-criacao-switcher-design.md`) entregou criação de workspace (restrita por allowlist) e switcher, mas deixou explicitamente fora de escopo "Convite por e-mail/link compartilhável (Fase 2b)". Hoje, a única forma de trazer alguém pra dentro de um workspace é um admin inserir a linha em `workspace_members` direto via SQL Editor — o que já se mostrou não ser um fluxo aceitável no uso real (o usuário tentou e achou ruim).

Esta spec cobre o sub-projeto **Fase 2b**: convite por e-mail, sem envio de e-mail de verdade (sem serviço de e-mail no projeto) — o "convite" é uma entrada no banco que é resgatada automaticamente quando a pessoa loga com aquele e-mail. Avisar a pessoa que ela foi convidada continua sendo manual, fora do app (o admin manda uma mensagem por fora).

---

## Decisões de design (revisadas em brainstorm com o usuário)

- **Aceite é imediato e ativo** — sem tela de "aguardando aprovação". Quem tem convite pendente pro e-mail dela entra direto como membro `active`, com o role que o admin escolheu.
- **Quem convida:** qualquer admin de um workspace pode convidar gente pro **próprio** workspace dele — não é restrito à allowlist global de criação de workspace (`workspace_creators`).
- **Role escolhido na hora do convite** pelo admin (não um default fixo tipo "Visualizador").
- **Sem trava adicional antes do login Google.** Domínio de e-mail não serve (o usuário atende clientes com domínios diferentes); a tela "Sem acesso" pós-login já impede acesso a qualquer dado real. Uma linha órfã em `profiles` pra quem loga sem convite/allowlist é ruído aceitável, não risco — e é tecnicamente inevitável de qualquer forma, porque `workspace_members.user_id` referencia `profiles.id`, então o profile precisa existir antes de qualquer convite poder ser aceito.
- **Gerenciamento 100% pela UI** — criar convite, listar pendentes, cancelar. Nada de SQL manual no dia a dia (só a migração inicial, como qualquer feature nova).
- **`bootstrap_login()` fica intocada.** É a RPC que roda em todo login de todo mundo — dado o incidente desta mesma sessão (RLS que ficou sem efeito por 10 dias em produção porque uma migração só rodou pela metade), o convite é resolvido por uma RPC nova e separada, chamada só nos pontos onde faz sentido, nunca dentro do caminho crítico de login.
- **Convite é checado em dois pontos:**
  1. **Boot com 0 workspaces** (login novo, ninguém ainda tem acesso a nada) — antes de cair nas telas "Criar workspace"/"Sem acesso".
  2. **Abertura manual do switcher** (clique no badge 🏢 no topbar) — cobre quem **já** tem acesso a outro workspace e recebeu um convite novo depois; sem isso, o convite dessa pessoa nunca seria resgatado (ela nunca mais passa pelo boot de "0 workspaces").
- **Sem histórico de convites.** A linha em `workspace_invites` existe enquanto pendente; some ao ser aceita ou cancelada. Sem coluna de status.
- **Mesmo e-mail pode ter convites pendentes pra workspaces diferentes ao mesmo tempo** (ex.: convidado por dois clientes diferentes antes de nunca ter logado). `claim_invite()` resgata todos de uma vez.

---

## 1. Modelo de Dados

```sql
create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  email text not null,
  role_id uuid not null references roles(id),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

alter table workspace_invites enable row level security;
create policy workspace_invites_admin_all on workspace_invites for all
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
```

`unique(workspace_id, email)`: impede convite duplicado pro mesmo par workspace+e-mail (a constraint gera um `23505` que o client mostra como "Já existe um convite pendente pra esse e-mail"). Acesso via RLS direta (`is_workspace_admin(workspace_id)`, já usada por `roles_write`/`equipes_isolation`/etc.) — sem RPC nova pra criar ou cancelar convite, o client faz `insert`/`delete` direto na tabela.

---

## 2. RPC nova: `claim_invite()`

Security definer — resgata **todos** os convites pendentes do e-mail logado de uma vez, cria a membership `active` com o role escolhido pelo admin, e apaga o convite:

```sql
create or replace function claim_invite()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv record;
  claimed jsonb := '[]'::jsonb;
begin
  for inv in
    select * from workspace_invites where email = auth.jwt()->>'email'
  loop
    insert into workspace_members (workspace_id, user_id, role_id, status)
    values (inv.workspace_id, auth.uid(), inv.role_id, 'active')
    on conflict (workspace_id, user_id) do nothing;
    delete from workspace_invites where id = inv.id;
    claimed := claimed || jsonb_build_object('workspace_id', inv.workspace_id);
  end loop;
  return claimed;
end;
$$;

revoke execute on function claim_invite() from public;
grant execute on function claim_invite() to authenticated;
```

`on conflict (workspace_id, user_id) do nothing`: defensivo, caso já exista uma membership pra esse par (não deveria acontecer no fluxo normal, mas evita erro se acontecer).

---

## 3. Fluxo no Client

### 3a. Boot com 0 workspaces

Em `resolveWorkspaceForLogin()` (`index.html`, Fase 2a), quando `bootstrap_login()` retorna `workspaces:[]`: antes de decidir entre `mostrarCriarWorkspace()`/`mostrarSemAcesso()`, chamar `claim_invite()`. Se ela resgatar algo (array não-vazio), buscar `bootstrap_login()` de novo e seguir o fluxo normal de resolução (1 workspace → entra direto; 2+ → switcher). Só cai em `can_create`/"Sem acesso" se `claim_invite()` não achou nada.

### 3b. Abertura manual do switcher

Em `abrirSwitcher(forced)` (Fase 2a), no caminho `forced=false` (clique no badge 🏢) — que já busca `bootstrapLogin()` fresco — chamar `claim_invite()` antes desse fetch, pelo mesmo motivo: pega convites novos pra quem já tem workspace.

### 3c. UI de convite (seção "Usuários" em Preferências)

- **Botão "Convidar"** → modal com campo de e-mail + `<select>` de role (mesma lista `S_ROLES` já carregada pro workspace atual). Confirmar roda:
  ```js
  sb.from('workspace_invites').insert({workspace_id:CURRENT_WORKSPACE_ID, email:email, role_id:roleId})
  ```
- **Lista "Convites pendentes"** (mesmo estilo visual da lista de solicitações pendentes já existente): e-mail + label do role + botão `×` que roda:
  ```js
  sb.from('workspace_invites').delete().eq('id', inviteId)
  ```

Ambos protegidos só pela RLS (`is_workspace_admin`) — sem checagem de permissão extra no client além do que já existe (só admin vê a seção de gestão de usuários).

---

## 4. Testes e Verificação

Sem suíte automatizada (mesmo padrão das Fases 1/2a). Roteiro manual pós-implementação:

1. Admin convida um e-mail que nunca logou → convite aparece na lista "Convites pendentes". Login desse e-mail (Google, porta 8080) → entra direto ativo no workspace, com o role escolhido — sem tela de aprovação.
2. Admin convida um e-mail que **já** tem acesso a outro workspace → nada muda até essa pessoa clicar no badge 🏢 (abrir o switcher); depois disso, o workspace novo aparece na lista.
3. Cancelar um convite antes de ser aceito → some da lista; login desse e-mail depois cai no fluxo normal (sem acesso / criar workspace), sem entrar automaticamente.
4. Convidar o mesmo e-mail duas vezes pro mesmo workspace → erro inline "Já existe um convite pendente pra esse e-mail", sem travar o form.
5. Mesmo e-mail convidado por dois workspaces diferentes antes de logar → `claim_invite()` resgata os dois na mesma chamada; o `bootstrap_login()` refeito em seguida já volta com `workspaces.length===2`, então cai no switcher (lógica de 2+ workspaces já existente da Fase 2a — sem escolha lembrada em `localStorage` ainda, então é `forced`).

---

## Fora de Escopo (Fase 2b)

- Envio de e-mail de verdade avisando a pessoa que foi convidada — sem serviço de e-mail no projeto; o aviso é manual, fora do app.
- Expiração automática de convite pendente.
- Histórico de convites aceitos/cancelados.
- Convidar por link compartilhável (sem exigir e-mail pré-cadastrado) — continua fora de escopo, como já era na Fase 2a.
