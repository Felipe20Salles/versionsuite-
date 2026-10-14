# Design: Backlog de Projetos (ideias → projetos acompanhados pelas OSs)

**Data:** 2026-10-14 (brainstorm em 2026-10-13)
**Arquivos alvo:** `index.html` + migrations novas em `supabase/migrations/`
**Abordagem:** tabelas novas no Supabase, separadas por responsabilidade, com `workspace_id` e RLS no padrão atual. A tela segue o padrão vanilla JS do `index.html`.
**Mockup aprovado:** `.superpowers/brainstorm/708-1791907223/content/projetos-telas.html`

---

## Contexto

Hoje cada OS pertence a uma **versão** (o ciclo mensal) e pode ter um **pai no Redmine** (`oss.pai_redmine`). Não existe nada acima disso: nenhuma entidade que reúna OSs de várias versões num projeto, nem um lugar para registrar e priorizar ideias antes de virarem trabalho.

Este módulo cria essa camada: **ideia → avaliação → aprovação → projeto → acompanhamento pelas OSs**.

## Decisões fechadas no brainstorm

- **Propósito:** funil de ideias e acompanhamento de projetos, em sequência.
- **Quem usa:** todo o workspace sugere ideias; só quem tem a permissão nova `gerir_projetos` (gestor/admin) pontua e decide.
- **Pontuação:** Valor ÷ Esforço, com pesos fixos nesta versão (sem critérios configuráveis).
- **Esforço:** em horas por etapa do fluxo (ex.: 15h especificação, 20h dev, 10h testes, 5h implantação = 50h). Na fase de ideia pode ser só o total ou só o tamanho.
- **Vínculo com OS:** manual no modal da OS, mais vínculo automático opcional pelo pai do Redmine. **Cada OS pertence a no máximo um projeto.**
- **Fluxo de etapas configurável, um por workspace**, com um papel responsável por etapa. O projeto pode pular etapas.
- **Responsável por etapa no projeto:** usuário do workspace (opcional) ou nome livre (opcional) ou só o papel.
- **Transições automáticas:** Aprovada → Em execução e Concluída → Em execução.
- **Prazo:** só data-alvo final.
- **Horas realizadas por etapa:** "regra C", ou seja, pelo tipo de atividade do Redmine quando a apropriação tem esse detalhe e, quando não tem, pela etapa em que o projeto estava naquela data.
- **Totais para todos:** uma função no banco devolve as horas do projeto já somadas, sem expor o ponto de ninguém.
- **Regras:** ideias Legais sempre no topo; comentário obrigatório para recusar ou cancelar.

---

## 1. Telas e navegação

**Menu:** seção nova na barra lateral, acima de "Versão atual":

```
Estratégico
  ◆ Projetos
```

Controlada por `canMenu('projetos')`.

### 1.1 Aba "Backlog de ideias"
Mostra os status Ideia, Em avaliação e Recusada.
- Lista ordenada por prioridade, da maior para a menor; Legais primeiro; sem nota completa vai para o fim com "—".
- Cada linha traz: título, quem sugeriu, prioridade, notas (Impacto · Urgência · Alinhamento), tamanho do esforço, selo **Legal** e status.
- **"+ Nova ideia"** (todos): título, descrição e, se quiser, notas e esforço iniciais.
- Com `gerir_projetos`: pontuar e **Aprovar / Recusar** (recusar exige comentário). Nas recusadas, **Reabrir**.
- Filtro para mostrar ou esconder as recusadas.

### 1.2 Aba "Projetos" (quadro por etapa)
Mostra os status Aprovada, Em execução, Pausada e Concluída.
- As colunas são as etapas ativas do fluxo, com o papel responsável no topo. Antes delas fica a coluna **"Aguardando início"** (Aprovadas).
- O cartão traz: título; responsável da etapa (usuário, nome livre ou só o papel); "há N dias nesta etapa"; barra de OSs concluídas de Y; horas apropriadas × estimadas; data-alvo (vermelha se atrasada, âmbar se faltam 7 dias ou menos).
- Arrastar o cartão entre colunas muda a etapa e grava o evento (só com `gerir_projetos`).
- Filtro para mostrar Pausadas e Concluídas.

### 1.3 Painel de detalhe (lateral)
Abre ao clicar num cartão ou numa ideia.
- Dados gerais, notas, esforço, data-alvo, pai do Redmine.
- **Fluxo do projeto:** etapas com responsável, horas estimadas e a opção "pular etapa" neste projeto.
- **Estimado × realizado por etapa:** ex.: "Desenvolvimento: 26h de 20h (130%)", mais o grupo "Sem etapa" quando houver.
- **Tempo por papel:** ex.: "Cliente 23d · Desenvolvedor 41d · Testador 9d", mais o número de retornos.
- **Linha do tempo:** todos os eventos, com data, autor e comentário.
- **OSs vinculadas** agrupadas por versão, com o status de cada uma, e o botão **"Vincular OS"**.

### 1.4 Telas existentes
- **Modal da OS (Demandas):** campo novo **"Projeto"** (select opcional, só com projetos que aceitam OS), com aviso quando o vínculo veio do pai do Redmine.
- **Cartão da OS no Kanban:** selo pequeno com o nome do projeto.
- **Preferências → Plataforma:** seção **"Fluxo de projetos"** (só admin), com papéis do fluxo, etapas (ordem, papel, tipos de atividade do Redmine ligados) e ativar/desativar.
- **Tela de papéis (roles):** permissão nova `gerir_projetos` e menu `projetos`.

---

## 2. Regras

### 2.1 Pontuação e prioridade
- **Valor** = Impacto no cliente + Urgência/obrigação legal + Alinhamento estratégico, cada um de 1 a 5 (total de 3 a 15).
- **Horas de esforço**, nesta ordem de preferência:
  1. a soma das horas estimadas por etapa, quando alguma for maior que 0;
  2. senão, o total livre `esforco_total_h`;
  3. senão, o tamanho escolhido direto (`esforco_tamanho`).
- **Tamanho a partir das horas:** até 20h é P; até 80h é M; até 200h é G; acima disso é GG.
- **Fator de esforço:** P = 1, M = 3, G = 7, GG = 15.
- **Prioridade** = Valor ÷ Fator, com uma casa decimal. Sem as três notas ou sem esforço, fica nula ("—", no fim da lista). O valor é calculado no cliente e gravado em `projetos.prioridade` para ordenar.
- **Legal:** só pode ser marcado com Urgência = 5. Ideias legais aparecem no topo, independentemente da nota.
- Etapas cujo papel é **externo** (ex.: Cliente) sugerem 0h, porque é espera e não esforço. A espera é medida em dias.

### 2.2 Status

| De → Para | Como |
|---|---|
| Ideia → Em avaliação | automático, quando alguém com `gerir_projetos` grava a primeira pontuação |
| Em avaliação → Aprovada / Recusada | manual, `gerir_projetos`; recusar exige comentário |
| Recusada → Em avaliação | manual ("Reabrir"), `gerir_projetos` |
| Aprovada → Em execução | **automático** quando uma OS vinculada entra em andamento; começa na 1ª etapa ativa não pulada |
| Em execução ⇄ Pausada | manual, `gerir_projetos` |
| Em execução → Concluída | manual, `gerir_projetos` |
| Concluída → Em execução | **automático** quando uma OS nova é vinculada ou uma OS vinculada é reaberta |
| qualquer → Cancelada | manual, `gerir_projetos`, com comentário |

- **Pausada não sai sozinha da pausa**, mesmo com OS em andamento. O cartão só mostra um aviso.
- Toda mudança de status grava um evento em `projeto_eventos`.

### 2.3 Etapas (só com o projeto Em execução)
- Avançar, voltar ou pular é **manual**, pelo arraste no quadro ou pelo painel.
- Voltar para uma etapa anterior grava o evento como `retorno`; o painel conta os retornos.
- **Tempo por papel** = soma do tempo em cada etapa, agrupada pelo papel **gravado no evento** (`papel_id`). Mudanças posteriores no fluxo não reescrevem o histórico.

### 2.4 Vínculo com OSs
- `oss.projeto_id`: no máximo um projeto por OS.
- **Aceitam OS:** Aprovada, Em execução, Pausada e Concluída (Concluída volta sozinha para Em execução). Ideia, Em avaliação, Recusada e Cancelada não aceitam.
- **Pai do Redmine:** quando o projeto tem `pai_redmine`, toda OS com o mesmo `pai_redmine` é vinculada **ao ser criada ou sincronizada**, desde que ainda não tenha projeto e não esteja com `projeto_desvinculado = true`. Ele nunca troca o projeto de uma OS que já tem um.
- **Desvincular à mão** marca `projeto_desvinculado = true`. Vincular de novo à mão limpa a marca.
- Vincular e desvincular gravam um evento `vinculo_os`.

### 2.5 Horas realizadas por etapa (regra C)
Para cada apropriação das OSs do projeto (`pontos.apropriacoes`, agregadas pela função do banco, seção 3.4):
1. Se tem detalhamento por atividade (`breakdown[{activityTypeId, horas}]`), cada parcela vai para a etapa cujo `tipos_atividade` contém aquele `activityTypeId`.
2. Se não tem detalhamento, ou o tipo não está ligado a nenhuma etapa, a hora vai para a etapa em que o projeto estava **naquela data**, pela linha do tempo de eventos.
3. Se nenhuma etapa se aplica (ex.: lançada antes da 1ª etapa), vai para **"Sem etapa"** e conta no total.

Um mesmo tipo de atividade fica ligado a no máximo uma etapa ativa do workspace; a tela de fluxo impede duplicar.

### 2.6 Permissões
- **Todos do workspace:** ver backlog e projetos; criar ideias; editar as **próprias** ideias enquanto estão em "Ideia"; comentar; vincular as **próprias** OSs a um projeto que aceita OS.
- **`gerir_projetos`** (o admin já tem): pontuar, aprovar, recusar, reabrir, pausar, concluir, cancelar, mover etapas, editar responsáveis, horas por etapa, etapas puladas e data-alvo.
- **Admin do workspace:** editar o fluxo e os papéis do fluxo.

---

## 3. Dados

Todas as tabelas novas têm `workspace_id` e RLS por `is_workspace_member()`, no padrão das migrations de 2026-07-30.

### 3.1 Tabelas novas

**`projeto_papeis`**: os papéis do fluxo, que não são os papéis de permissão do app.
`id uuid pk, workspace_id, nome text, externo bool default false, ordem int`

**`projeto_etapas`**: o fluxo do workspace.
`id uuid pk, workspace_id, nome text, ordem int, papel_id → projeto_papeis, tipos_atividade int[] default '{}', ativo bool default true`
Remover uma etapa = desativar (`ativo = false`), para preservar o histórico.

**`projetos`**
`id uuid pk, workspace_id, titulo text, descricao text,`
`status text check in (ideia, avaliacao, aprovada, recusada, execucao, pausada, concluida, cancelada) default 'ideia',`
`etapa_id → projeto_etapas null` (só em execução, pausada ou concluída),
`nota_impacto, nota_urgencia, nota_alinhamento smallint null check 1..5, legal bool default false,`
`esforco_total_h numeric null, esforco_tamanho text null check in (P, M, G, GG),`
`prioridade numeric null, data_alvo date null, pai_redmine text null,`
`sugerido_por → auth.users, criado_em timestamptz default now(), atualizado_em timestamptz`

**`projeto_etapa_config`**: o que é específico do projeto em cada etapa.
`projeto_id → projetos on delete cascade, etapa_id → projeto_etapas, PK (projeto_id, etapa_id),`
`horas_estimadas numeric default 0, pulada bool default false,`
`responsavel_user_id → auth.users null, responsavel_nome text null`
A linha só existe se algo difere do padrão. Sem linha, vale: papel da etapa, 0h, não pulada.

**`projeto_eventos`**: histórico, só com inserção.
`id uuid pk, workspace_id, projeto_id → projetos, tipo text check in (status, etapa, retorno, comentario, vinculo_os),`
`de text null, para text null, papel_id → projeto_papeis null, comentario text null, autor_id → auth.users, criado_em timestamptz default now()`

### 3.2 Colunas novas em `oss`
`projeto_id uuid null → projetos on delete set null`
`projeto_desvinculado bool default false`

### 3.3 RLS
- **Select:** membros do workspace, em todas as tabelas novas.
- **Insert em `projetos`:** membros, com `sugerido_por = auth.uid()` e `status = 'ideia'`.
- **Update em `projetos` e escrita em `projeto_etapa_config`:** membros. A distinção entre o autor da ideia e `gerir_projetos` é checada no cliente com `can()`, como no resto do app hoje.
- **Insert em `projeto_eventos`:** membros, com `autor_id = auth.uid()`. Sem update e sem delete.
- **`projeto_papeis` e `projeto_etapas`:** escrita só com `is_workspace_admin()`.
- **Seed:** ao rodar a migration, cada workspace existente recebe o fluxo padrão:

| # | Etapa | Papel | Externo |
|---|---|---|---|
| 1 | Especificação | Analista | não |
| 2 | Aprovação da especificação | Cliente | sim |
| 3 | Desenvolvimento | Desenvolvedor | não |
| 4 | Validação | Testador | não |
| 5 | Implantação | Analista | não |

Workspaces criados depois recebem o mesmo seed na criação (ajuste em `create_workspace`).

### 3.4 Função de horas agregadas
`projeto_horas_agregadas(p_projeto_id uuid)`, `security definer`:
- Primeiro confere se `auth.uid()` é membro do workspace do projeto; se não for, devolve vazio.
- Devolve linhas `(data date, activity_type_id int null, horas numeric)`, somando as apropriações de **todas as pessoas** nas OSs do projeto. Não devolve usuário nem marcações.
- A regra C (seção 2.5) é aplicada no cliente sobre esse resultado, para a lógica ficar em JavaScript e testável.

### 3.5 Lógica no cliente (funções puras, testáveis no Node)
- `calcPrioridade(projeto, etapaConfigs)` → `{valor, horas, tamanho, fator, prioridade}`
- `proximoStatusAuto(projeto, evento)`: as transições automáticas da seção 2.2
- `horasPorEtapa(linhasAgregadas, eventos, etapas)`: a regra C
- `tempoPorPapel(eventos, agora)` → dias por papel e número de retornos

---

## 4. Fora da primeira versão
- Datas por etapa, cronograma ou Gantt.
- Dependência entre projetos.
- Notificações por e-mail.
- Mais de um fluxo por workspace.
- Votação ou curtidas em ideias.
- Anexos no projeto.
- Exportação ou relatório de portfólio.
- Criar projetos no Redmine (só lemos o pai da OS).
- Critérios de pontuação configuráveis.

## 5. Casos de borda
1. **Etapa desativada:** projetos que estão nela continuam lá, com aviso no cartão, até alguém movê-los. Ela não aparece para projetos novos.
2. **Papel renomeado:** o histórico guarda o `papel_id`; a tela mostra o nome atual.
3. **Pausada com OS em andamento:** só um aviso no cartão; o status não muda.
4. **Pai do Redmine:** nunca troca o projeto de uma OS que já tem projeto; não revincula OS desvinculada à mão.
5. **Hora sem etapa possível:** vai para "Sem etapa" e conta no total.
6. **Esforço só como total ou tamanho:** a prioridade funciona; o estimado × realizado por etapa só aparece depois que houver horas por etapa.
7. **Responsável que saiu do workspace:** o nome fica guardado em `responsavel_nome` ao atribuir e aparece como "(ex-membro)".
8. **Sem `gerir_projetos`:** cria ideias e edita só as próprias enquanto estão em "Ideia".
9. **Função de totais:** não membro recebe vazio; nunca devolve dados por pessoa.

## 6. Testes
- **Unitários (Node, scripts como na tarefa do ponto):** `calcPrioridade` (faixas P/M/G/GG, ordem de preferência das horas, nula sem notas), `proximoStatusAuto` (as duas transições automáticas e o caso Pausada), `horasPorEtapa` (com detalhamento, sem detalhamento, tipo não ligado, antes da 1ª etapa), `tempoPorPapel` (retornos, etapa atual em aberto).
- **Banco:** depois da migration, conferir quem vê o quê (membro, não membro, admin), que eventos não aceitam update ou delete, e a função de horas agregadas (membro recebe totais; não membro recebe vazio).
- **Roteiro manual (porta 8080, login real):** criar ideia → pontuar (vira Em avaliação) → aprovar → vincular OS → pôr a OS em andamento (projeto vira Em execução na 1ª etapa) → mover etapas, incluindo um retorno → concluir → vincular OS nova (reabre).

---

## Pontos que eu decidi ao escrever (revisar)
- **Notas da ideia dadas por quem sugeriu** ficam como sugestão e **não** mudam o status; só a pontuação de quem tem `gerir_projetos` leva de Ideia para Em avaliação. Isso concilia o "notas iniciais opcionais" da Parte 1 com a regra 9 da Parte 4.
- **`esforco_tamanho`** entrou como coluna, porque a Parte 2 permite informar só o tamanho e a Parte 3 não tinha onde guardar.
- **A função do banco devolve horas agregadas por data e tipo de atividade, não totais por etapa.** Assim a regra C fica no JavaScript (testável) e continua sem expor ninguém.
- **Um tipo de atividade fica ligado a no máximo uma etapa**, para a regra C não ficar ambígua.
