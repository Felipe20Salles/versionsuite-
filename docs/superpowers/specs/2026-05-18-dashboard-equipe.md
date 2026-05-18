# Design: Dashboard de Equipe — VersionSuite

**Data:** 2026-05-18
**Arquivo alvo:** `index.html`
**Abordagem:** Inline, vanilla JS, Supabase

---

## Contexto

Gerentes PM e Superintendente precisam visualizar hora ponto e hora apropriada dos membros de suas equipes, filtrado por período (ciclo 16→15). O sistema atual não possui conceito de equipe — apenas roles individuais e dados de ponto por usuário logado.

---

## 1. Modelo de Dados

### Nova tabela `equipes`

```sql
CREATE TABLE equipes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome      TEXT NOT NULL,
  gestor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
```

Exemplos de registros iniciais:
- `{ nome: 'Pagadoria', gestor_id: <id da Roberta> }`
- `{ nome: 'Gestão de Talentos', gestor_id: <id do Gabriel> }`
- `{ nome: 'Documentação/Reports', gestor_id: NULL }`

### Novas colunas em `profiles`

```sql
ALTER TABLE profiles ADD COLUMN equipe_id    UUID    REFERENCES equipes(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN gestor_geral BOOLEAN NOT NULL DEFAULT FALSE;
```

- `equipe_id` — equipe à qual o usuário pertence
- `gestor_geral` — `TRUE` para o Superintendente; permite que a RLS identifique quem vê todas as equipes sem depender do nome do role

O Gerente PM tem `equipe_id` apontando para sua equipe e é o `gestor_id` dessa equipe. O Superintendente tem `gestor_geral = TRUE` e pode não ter `equipe_id` definido (ou pertencer a alguma equipe para fins de alocação).

---

## 2. Permissões

Dois novos itens de ação adicionados ao sistema de roles existente:

| Permissão | Escopo |
|---|---|
| `dashboard_equipe` | Vê aba "Equipe" no Dashboard — apenas a equipe que gerencia (onde é `gestor_id`) |
| `dashboard_todas_equipes` | Vê aba "Equipe" com todas as equipes e filtro de equipe habilitado |

A aba "Equipe" é exibida quando `can('dashboard_equipe') || can('dashboard_todas_equipes') || isAdmin()`.
O filtro de equipe é exibido quando `can('dashboard_todas_equipes') || isAdmin()`.
O role `admin` acessa tudo por padrão (sem mudança).

**Roles a criar nas Preferências:**
- **"Gerente PM"** — permissão `dashboard_equipe`
- **"Superintendente"** — permissão `dashboard_todas_equipes`

---

## 3. Configuração nas Preferências (Admin)

### Nova seção "Equipes" (antes da seção Usuários)

- Lista equipes cadastradas: nome + gestor atribuído
- Botão "Nova equipe" → formulário inline: campo nome + select de gestor (lista de usuários cadastrados)
- Cada linha tem botão editar (inline) e remover (com confirmação)
- Salva na tabela `equipes` via Supabase

### Seção "Usuários" — novas colunas Equipe e Gestor Geral

- Dropdown "Equipe" adicionado ao lado do dropdown de Role em cada linha de usuário
- Opções: equipes cadastradas + "— Sem equipe —"
- Checkbox "Gestor geral" ao lado (exibido apenas para admins) — quando marcado define `gestor_geral = TRUE`; usado para identificar o Superintendente
- Salva `equipe_id` e `gestor_geral` na tabela `profiles`
- Visível apenas para usuários com `preferencias_admin`

---

## 4. Dashboard — aba "Equipe"

### Acesso

A aba "Equipe" aparece no Dashboard apenas para usuários com `dashboard_equipe` ou `dashboard_todas_equipes` (ou admin).

### Filtros

| Filtro | Descrição |
|---|---|
| **Período** | Navegação ← → com label "16/Abr – 15/Mai". Padrão: período atual (16 do mês anterior até 15 do mês atual se dia atual > 15, senão período anterior). |
| **Equipe** | Select visível apenas para `dashboard_todas_equipes`. Opções: todas as equipes + "Todas". Gerente PM não vê esse filtro — vê apenas a sua equipe. |
| **Pessoa** | Select com membros da equipe selecionada + "Todas". |

**Cálculo do período padrão:**
- Se dia atual > 15 → período = 16/mês_atual até 15/próximo_mês
- Se dia atual ≤ 15 → período = 16/mês_anterior até 15/mês_atual

### Tabela de resultados

Colunas: **Pessoa**, **Hora Ponto**, **Hora Apropriada**, **% Apropriada**

- Ordenada por nome (alfabético)
- Linha de **Total** ao final (soma das colunas + % do total)
- Membros sem ponto no período exibem `—` nas colunas de horas
- Cor da coluna % Apropriada:
  - Verde: ≥ 95%
  - Amarelo: 80% – 94%
  - Vermelho: < 80%
  - Cinza (`var(--muted)`): sem dados (`—`)

### Cálculo de horas

- **Hora Ponto:** soma de `ponto.horasTrabalhadas` de todos os pontos do usuário no período
- **Hora Apropriada:** soma de `aprop.horas` de todas as `apropriacoes` de todos os pontos do usuário no período
- **% Apropriada:** `(hora_apropriada / hora_ponto) * 100`, arredondado para 1 casa decimal

---

## 5. Busca de Dados e RLS

### Carregamento

- `S.pontosEquipe` — novo array, carregado apenas quando a aba "Equipe" é aberta
- Função `loadPontosEquipe(userIds, inicio, fim)`:
  - Query: `pontos WHERE user_id IN (userIds) AND data >= inicio AND data <= fim`
  - Também carrega os `profiles` necessários para exibir nomes (já disponível em `S_USERS`)

### RLS na tabela `pontos`

```sql
-- Gestores veem pontos dos membros da sua equipe
CREATE POLICY "Gestores veem pontos da equipe"
ON pontos FOR SELECT
USING (
  -- próprio usuário
  auth.uid() = user_id
  OR
  -- gestor da equipe do dono do ponto
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN equipes e ON e.id = p.equipe_id
    WHERE p.id = pontos.user_id
      AND e.gestor_id = auth.uid()
  )
  OR
  -- superintendente (gestor_geral = true)
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gestor_geral = TRUE
  )
);
```

> **Nota:** Verificar se já existe uma policy `FOR SELECT` em `pontos` antes de aplicar — se existir `auth.uid() = user_id`, substituir por esta ou fazer DROP da antiga primeiro.

### RLS na tabela `equipes`

```sql
-- Todos os usuários autenticados podem ler equipes (para popular selects)
CREATE POLICY "Usuarios autenticados leem equipes"
ON equipes FOR SELECT
USING (auth.role() = 'authenticated');

-- Apenas admins podem modificar equipes (via policies de INSERT/UPDATE/DELETE)
CREATE POLICY "Admins gerenciam equipes"
ON equipes FOR ALL
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
```

---

## 6. O que não muda

- Carregamento de `S.pontos` (continua carregando apenas do usuário logado no fluxo normal)
- Estrutura das abas existentes do Dashboard
- Sistema de roles e permissões (apenas acrescenta 2 novas permissões)
- Tabela `pontos` e `profiles` (apenas adiciona coluna e políticas)

---

## 7. Fora de escopo

- Exportação do relatório de equipe para Excel/PDF
- Alertas de horas abaixo do mínimo (notificações push/email)
- Histórico de equipes (ex.: usuário mudou de equipe no meio do período)
- Breakdown por OS ou por dia dentro do período
- Dashboard de equipe para roles que não sejam Gerente PM ou Superintendente
