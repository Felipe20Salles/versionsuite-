# Design: Plano por capacidade (roadmap de demandas distribuído pelas versões)

**Data:** 2026-10-28
**Arquivos alvo:** `index.html`, `projetos-core.js` (+ testes em `tests/`), migrations novas em `supabase/migrations/`
**Substitui em parte:** `2026-10-14-backlog-projetos-design.md` (avaliação por notas 1–5 e quadro por etapas)
**Mockup aprovado (visual e interação):** `.superpowers/brainstorm/82-1793221540/content/plano-no-vs-v4.html`, já dentro da casca do VS. As horas por versão e por papel e o realizado lá são de exemplo.
**Dados reais de referência:** `C:\Users\costa\OneDrive\Área de Trabalho\Siacon\2026.xlsx` (planilha do cliente Siacon, 115 chamados)

---

## 1. Intenção

O VS sempre controlou a operação: versões, OSs, kanban e horas. Este módulo cobre a camada de cima, **o plano**:

- A gestão (nível tático) avalia as demandas e monta o plano.
- A diretoria (nível estratégico) decide no que a equipe vai trabalhar, porque o esforço disponível não basta para tudo.
- O VS mostra **o que cabe em cada versão** e acompanha o plano contra o realizado.

Hoje isso vive numa planilha (`2026.xlsx`) com dados reais mas soltos, sem ligação com as OSs e as horas que o VS já registra. O usuário quer esses dados **guardados no VS e ligados à operação**, numa forma **simples**, mais fácil de mexer e de visualizar que a planilha, e **impressionante para apresentar à diretoria**.

### Princípios
- **O plano mede a execução, não manda nela.** A demanda nunca cria, move ou altera OS. As OSs são as tarefas de cada pessoa; o plano só lê o que elas consomem.
- **O VS é genérico.** Ele atende empresas de qualquer ramo, multi-workspace. Nada de tema do cliente (sem silo nem agro). Os termos são de gestão, neutros, e os critérios de avaliação são configuráveis por workspace.
- **Simples.** Sem Gantt, sem dependências, sem alocação por pessoa.
- **Visual do próprio VS:** tokens de `:root` do `index.html`, violeta `--accent`, DM Sans. A tela é o momento "uau" do produto, com movimento que responde às ações (seção 6).

### Anti-objetivos (seria falha mesmo funcionando)
- A tela parecer feita para um ramo específico.
- O plano alterar OSs, versões ou apontamentos.
- Virar uma ferramenta pesada de PMO, com campos e etapas que ninguém preenche.

---

## 2. Vocabulário (decidido com o usuário)

| Conceito | Termo na interface |
|---|---|
| Item do roadmap (chamado pai no Redmine) | **Demanda** |
| Aguardando análise da gestão | **Em triagem** |
| Avaliada, aguardando decisão | **Em pauta** |
| Aprovada | **No plano** |
| Stand by | **Adiada** |
| Não aprovada | **Descartada** |
| Botões de decisão | **Incluir no plano · Adiar · Descartar** |
| Score / viabilidade | **Prioridade** (0 a 24): alta, média, baixa |
| Destaque do gráfico | **Alto retorno, pouco esforço** |

Critérios padrão (editáveis por workspace, seção 3.3):

| Critério | Pergunta | Opções (pontos base 0–3) | Peso |
|---|---|---|---|
| Facilidade de execução | Há barreiras para fazer? | Bloqueada · Difícil · Possível · Simples | 1 |
| Alinhamento estratégico | Contribui com os objetivos? | Nenhum · Pouco · Bastante · Total | 2 |
| Impacto no negócio | Quanto melhora o resultado? | Nenhum · Baixo · Médio · Alto | 2 |
| Alcance | Quantos são beneficiados? | Poucos · Alguns · Muitos · Todos | 3 |

**Prioridade** = Σ(pontos × peso), de 0 a 24. Faixas padrão: 0–8 baixa, 9–16 média, 17–24 alta. Esses são exatamente os pesos e faixas da aba Parametrizações da planilha. Sem os 4 critérios preenchidos, a demanda fica sem prioridade.

---

## 3. Dados

Reaproveita a tabela `projetos` (cada linha passa a ser uma **demanda**), o vínculo `oss.projeto_id`, o vínculo automático por `pai_redmine`, `pode_gerir_projetos()` e as funções de horas de `2026-10-14_02_projetos_horas.sql`.

### 3.1 `projetos` (demanda)
**Colunas novas:**
- `crit smallint[4]`: pontos base (0–3) de cada critério, na ordem do workspace; `null` = não preenchido.
- `posicao numeric`: **ordem manual no plano**; menor = mais prioritário. Corresponde ao "Valor de Negócio" da planilha. Nulo fora do plano.
- `produto text`, `solicitante text`: livres. "Solicitante" é o "Cliente" da planilha; neutro para outros ramos.
- `horas_papeis jsonb`: estimativa por papel, `[{papel_id, horas}]`, sempre editável no VS (seções 3.3 e 5).
- `horas_origem text`, com os valores `vs` ou `redmine` (padrão `vs`). Diz se o Sincronizar pode sobrescrever `horas_papeis`.
- `horas_redmine jsonb`: última leitura do Redmine, guardada mesmo quando a origem é `vs`, para permitir "voltar a usar o Redmine" sem nova busca.
- `estimativa text`, com os valores `completa`, `parcial` ou `sem`. Calculada: `sem` = 0h; `parcial` = algum papel interno ativo sem horas; `completa` = todos os papéis internos ativos com horas.
- `decisao_obs text`, `decidido_em timestamptz`, `decidido_por uuid`.
- `entregue_em timestamptz`.

**`status` passa a ser:** `triagem`, `pauta`, `plano`, `adiada`, `descartada`, `entregue`.
- `triagem` → `pauta`: automático, quando os 4 critérios ficam preenchidos.
- `pauta`, `adiada` → `plano` / `adiada` / `descartada`: decisão manual (`gerir_projetos`). Descartar e adiar pedem observação opcional; incluir no plano dá a `posicao` = última + 1.
- `plano` → `entregue`: manual, pelo gestor. A interface sugere quando todas as OSs vinculadas estão concluídas, mas não fecha sozinha.
- `entregue` → `plano`: manual (reabrir).
- **Situação de execução** (só exibição, não gravada): *Prevista* (sem horas realizadas), *Em andamento* (com horas realizadas), *Entregue*.

**Colunas que deixam de ser usadas:** `nota_impacto`, `nota_urgencia`, `nota_alinhamento`, `legal`, `esforco_tamanho`, `prioridade`, `etapa_id`, `data_alvo`. Saem da interface. Apagar no banco fica a critério do construtor, que pode deixar para uma migration posterior.

**Migração de status existentes:** `ideia` vira `triagem`; `avaliacao` vira `pauta`; `aprovada`, `execucao` e `pausada` viram `plano`; `concluida` vira `entregue`; `recusada` e `cancelada` viram `descartada`.

O trigger `projetos_guarda_update` precisa ser reescrito para os status novos. Sem `gerir_projetos`, um membro só cria demanda em `triagem` e edita título e descrição das próprias demandas em `triagem`.

### 3.2 Versões
`versoes` ganha:
- **Capacidade por papel:** tabela `versao_capacidade (workspace_id, versao_id, papel_id, horas)`, com as horas que cada papel reserva para o plano naquela versão. Não é a carga total da equipe, porque ela também atende suporte e bugs. A **capacidade da versão** é a soma dos papéis; não existe um total gravado à parte, então as duas visões sempre batem.
- Um jeito de marcar a versão como **planejada** (futura, ainda não iniciada), separada de ativa e encerrada. A representação fica com o construtor. A ordem das versões é por `data`, que passa a ser **obrigatória** para versões planejadas.

As versões planejadas aparecem na tela de versões existente com essa marca e podem ser criadas com antecedência.

**Iniciar versão** (*decisão minha*): ação nova na tela de versões que passa uma versão de planejada para ativa. Criar uma versão já ativa, como hoje, equivale a criar e iniciar.

**Várias versões ativas ao mesmo tempo** (*decisão minha*): o VS hoje permite, e isso continua. Na cascata, todas as ativas entram antes das planejadas, em ordem de `data`. Cada uma desconta o próprio realizado (seção 4) e mostra realizado e restante no pote. Não se cria restrição de "uma ativa por workspace".

### 3.3 Critérios por workspace
Tabela `plano_config` com uma linha por workspace: os 4 critérios (nome, pergunta, 4 rótulos de opção, peso), as faixas de prioridade e as faixas de esforço. O seed tem os valores da seção 2. Escrita só por admin. **Nesta versão são sempre 4 critérios com 4 opções.** Nos critérios, só textos, pesos e faixas são editáveis.

**Papéis no lugar de fases** (decidido com o usuário): as horas da demanda se dividem pelos **papéis** que já existem em Preferências → Plataforma (`projeto_papeis`; o seed tem Analista, Cliente, Desenvolvedor e Testador). Não se cria uma lista nova de fases. Cada papel ganha:
- `trackers text[]`: trackers do Redmine cujas tarefas filhas caem nesse papel.
- `tipos_atividade text[]`: tipos de atividade cujas apropriações contam como realizado do papel. Hoje essa ligação está nas etapas, que saem; ela passa para o papel.
- `ativo boolean`: desativar não apaga; as horas antigas continuam no total.

Regras (*decisões minhas*):
- Papel marcado como `externo` (o Cliente, no seed) não aparece na estimativa nem na capacidade: o plano mede o esforço da equipe.
- Tracker não mapeado cai no **papel padrão**, escolhido em Preferências → Plano.
- Mudar pesos recalcula a prioridade de todas as demandas, porque ela é calculada no cliente, não gravada.

Fica em **Preferências → Plataforma → Plano**, que também lista os papéis com seus trackers e tipos de atividade e substitui a seção "Fluxo de projetos". As etapas saem; os papéis ficam.

### 3.4 Linha de base
Tabela `plano_linha_base (workspace_id, versao_id, projeto_id, horas_previstas, posicao)`. Ela é gravada **quando a versão é iniciada** (seção 3.2), com o resultado da distribuição (seção 4) naquele momento para aquela versão. É só inserção e não muda depois. É o compromisso assumido com a diretoria.

Regras (*decisões minhas*):
- Grava uma vez por versão. Se a versão já tem linha de base, não grava de novo.
- Reativar uma versão encerrada mantém a linha de base que ela já tinha.
- Versões que já estão ativas na implantação ficam sem linha de base. O resumo da seção 6.5 mostra "sem linha de base" para elas.
- A gravação pode ser feita pelo cliente, junto com a ação de iniciar. Uma restrição única `(versao_id, projeto_id)` garante que não duplique.

### 3.5 Horas realizadas
Realizado da demanda = soma das apropriações nas OSs vinculadas (`projetos_horas_totais` já faz isso). Para o relatório por versão é preciso o realizado **por versão**: estender a função para agrupar também por versão do apontamento (`pontos.versao_id`), sem expor pessoas. O realizado **por papel** é o mesmo cálculo agrupado pelo papel do tipo de atividade.

---

## 4. Distribuição pelas versões (cascata)

Função pura `distribuirPlano(demandas, versoes, realizadoPorDemanda)` em `projetos-core.js`, testada no Node:

1. **Entrada:** demandas com `status = plano`, ordenadas por `posicao` ascendente, depois prioridade descendente, depois ID do Redmine (ou data de criação) ascendente. As versões são a **ativa** mais as **planejadas**, em ordem de `data`.
2. **Horas que a demanda ainda ocupa** = máx(estimada − realizada, 0). Demandas sem estimativa ocupam 0 e vão para o grupo "sem horas estimadas", fora dos potes.
3. **Espaço de cada versão:**
   - Versão planejada: a capacidade da versão (soma dos papéis).
   - Versão ativa: a capacidade da versão menos o realizado já apontado nela (*decisões minhas*):
     - Conta as horas de OSs vinculadas a **qualquer** demanda, em qualquer status. Hora gasta é capacidade consumida; se a demanda sair do plano depois, o espaço não volta.
     - "Apontado nela" = versão do apontamento (`pontos.versao_id`), não a versão da OS.
     - O restante de cada demanda (passo 2) usa o realizado **total**, inclusive o de versões anteriores.
4. **Preenchimento em ordem.** Quando uma demanda não cabe inteira no espaço restante da versão, **ela é dividida**: o que cabe fica nessa versão, o resto passa para a próxima (*decisão minha*). A demanda mostra "Fevereiro → Março".
5. O que não cabe em nenhuma versão vai para **"Sem versão ainda"**, com total de horas e número de demandas.
6. **Saída:** por versão, a lista de `{demanda, horas}` e as horas livres; por demanda, as versões previstas.
7. **Por papel** (*decisões minhas*): a cascata usa a capacidade **total** da versão. Depois, as horas que cada demanda tem naquela versão são repartidas pelos papéis na proporção das horas restantes dela em cada papel; o realizado de cada papel desconta do próprio papel. Se um papel passa da sua capacidade, a versão ganha um aviso ("Desenvolvedor acima"), mas **a cascata não muda por isso**: a previsão não pula de versão por causa de um papel só. Resolver é decisão do gestor: aumentar a capacidade do papel, reordenar ou mexer nas horas.

A distribuição é **sempre automática**. Não existe fixar demanda em versão nesta fase. Para mudar a previsão, mude a ordem ou as horas da versão.

---

## 5. Origem dos dados

**O VS é autossuficiente.** Toda demanda nasce, é avaliada, estimada e planejada dentro do VS. O Redmine é uma fonte opcional de estimativas, nunca obrigatória.

### 5.0 Esforço no próprio VS
- A ficha da demanda tem, para cada papel interno ativo, um campo de horas com − e +. O total e a bolha da demanda se atualizam na hora, e o plano redistribui.
- "+ Nova demanda" abre a ficha em branco: título, produto, solicitante, horas por papel. Não precisa de chamado.
- **Demanda ligada a um chamado** (`pai_redmine` preenchido) mostra a escolha "Definido no VS / Do Redmine #id":
  - Em "Do Redmine", o Sincronizar sobrescreve `horas_papeis` com a soma das filhas.
  - Se alguém altera as horas de qualquer papel na ficha, a origem passa a `vs` e o Sincronizar deixa de sobrescrever (só atualiza `horas_redmine`). O histórico registra quem ajustou.
  - Clicar em "Do Redmine" volta a origem e copia `horas_redmine` para `horas_papeis` (*decisão minha*).
- **Faixas de esforço** (Pequeno até 40h, Médio 41–120h, Grande acima de 120h) são padrão e configuráveis em Preferências → Plano, junto das faixas de prioridade (*decisão minha*).

### 5.1 Redmine (quando o workspace usa)
- **Demanda = chamado pai.** As **tarefas filhas**, uma por etapa do trabalho (Análise, Dev, QA…), têm cada uma o seu `estimated_hours` e são o trabalho que vira OS no VS.
- **Estimativa da demanda** = soma do `estimated_hours` das filhas, agrupada por papel.
- **Papel de cada filha:** pelo tracker do Redmine, mapeado no papel (seção 3.3). Tracker não mapeado vai para o papel padrão.
- **Entrada de demandas:** "Adicionar do Redmine" por ID do chamado pai, mais um botão "Sincronizar" que atualiza as estimativas de todas as demandas que têm `pai_redmine` (*decisão minha*). Não há importação automática por filtro nesta fase.
- **Atualização:** ao abrir a tela de Plano, se a última sincronização tiver mais de 1 hora, e no botão. Usa o `redmine-proxy.js` existente.
- **Quem sincroniza** (*decisão minha*): só quem tem `gerir_projetos` **e** o Redmine configurado no próprio navegador (a configuração do Redmine é por usuário). A sincronização automática ao abrir roda só para essas pessoas; os demais veem os dados da última sincronização. Não precisa de RPC nova: a gravação de `horas_papeis` segue a regra de `gerir_projetos`. A data da última sincronização fica no workspace (`plano_config`) e aparece no topo da tela.
- O vínculo automático de OSs pelo `pai_redmine` continua como está (seção 2.4 do design de 2026-10-14).

### 5.2 Sem Redmine
Tudo pela seção 5.0. A tela não mostra Sincronizar nem a escolha de origem.

### 5.3 Carga inicial da planilha
Importação única dos 115 chamados de `2026.xlsx` (aba "Análise de viabilidade") para o workspace da Siacon: ID do chamado → `pai_redmine`, título, produto, solicitante, os 4 critérios, posição (Valor de Negócio), decisão, observação e data da decisão. As horas vêm depois, pela sincronização com o Redmine. Na planilha, as colunas de horas mapeiam assim (*decisão minha*): Análise → Analista, Dev → Desenvolvedor, QA → Testador, Implantação → Analista, como a etapa Implantação do fluxo padrão. É feita com um **script avulso** (*decisão minha*), não como funcionalidade do produto.

Mapeamento dos textos da planilha para pontos: as listas da aba Parametrizações (por exemplo, "Não temos nenhuma limitação" = 3; "Somos totalmente limitados" = 0). "Valor de Negócio" 0 ou vazio = sem posição.

---

## 6. Telas

Menu **Projetos** (seção "Estratégico", `canMenu('projetos')`) passa a se chamar **Plano**, com a tela abaixo. O **quadro por etapas** e o **backlog de ideias** atuais saem.

### 6.1 Tela "Plano"
Topo: título com o período (por exemplo, "Plano 2026/27") e **filtros em pílula** pela situação, com contagem (Todas, Em triagem, Em pauta, No plano, Adiadas, Descartadas). Botões: **+ Nova demanda**, **Sincronizar** e **Apresentar**.

**Área "Projetos"** (como no mockup):
- Grade de **prioridade × esforço**. Linhas: prioridade alta, média, baixa e sem avaliação (faixas de prioridade). Colunas: Pequeno, Médio, Grande e Sem estimativa (faixas de esforço, seção 5.0).
- Cada demanda é uma **bolha** dentro da sua célula; as bolhas de uma célula ficam agrupadas, sem eixo contínuo. Tamanho da bolha = horas estimadas (raiz quadrada, com raio mínimo para a demanda pequena continuar visível). Sem horas = bolha tracejada.
- Célula "Alto retorno, pouco esforço" (alta × pequeno) destacada; cada célula mostra a contagem.
- Cor por situação. Em pauta = anel âmbar; No plano = violeta.
- Passar o mouse mostra título, ID, horas, prioridade e versões previstas.
- Filtros de situação apagam as bolhas que não batem, sem mudar posições. Busca e filtro por produto acima.
- Arrastar uma bolha para um pote inclui no plano (seção 6.3).

**Área "Capacidade por versão"**:
- **Filtro de versão**, igual ao "Filtrar métricas por versão" do Dashboard: "Todas as versões" ou uma versão. Clicar no nome de uma versão no pote também troca para ela.
- **"Todas as versões" (longo prazo):** uma fileira de potes, um por versão (ativas + planejadas), na ordem das datas, com rolagem horizontal se não couber. A capacidade de cada pote é a soma dos papéis. Se algum papel passa da capacidade naquela versão, o rodapé do pote mostra "⚠ Desenvolvedor acima".
- **Uma versão (curto prazo):** um pote **por papel interno** naquela versão. As bolhas são a parte de cada demanda que cabe ao papel; a mesma demanda aparece em vários potes, e passar o mouse destaca todas. O que passa da capacidade do papel aparece acima da borda, em vermelho, com "Xh acima da capacidade". Não há pote "Sem versão" nessa visão. Arrastar uma bolha da grade para cá inclui a demanda no fim dessa versão.
- **O líquido é o volume exato** de horas ocupadas (altura = horas); na versão ativa, a faixa de baixo em verde é o realizado.
- **As demandas são bolhas dentro do pote**, com área proporcional às horas daquela parte (raio mínimo e máximo), empilhadas por uma física simples. Bolha grande mostra as horas escritas. Demanda dividida entre versões aparece como bolha tracejada em cada pote. Na ativa, um arco verde em volta da bolha mostra o realizado da demanda.
- Abaixo de cada pote: "usado de capacidade" e "Xh livres" ou "cheio".
- A **tampa é arrastável** (`gerir_projetos`), gravando ao soltar. Na visão de uma versão, ela muda a capacidade do papel. Na visão de todas, ela muda o total da versão e reparte a diferença entre os papéis na mesma proporção que já tinham (*decisão minha*).
- **Arrastar uma bolha para outro pote** muda a posição no plano: a altura em que se solta define a ordem dentro do pote (mais perto do fundo = antes). Grava `posicao` ao soltar. As setas ↑↓ da ficha continuam como alternativa por teclado.
- No fim da fileira, o pote **"Sem versão ainda"**, tracejado em vermelho com bolhas hachuradas, e a contagem das demandas no plano sem horas.
- Passar o mouse numa bolha do pote destaca a bolha correspondente na grade, e vice-versa.

### 6.2 Ficha da demanda
Painel que abre ao clicar numa bolha (grade ou pote), como no mockup. Mostra:
- ID, produto, solicitante, título e descrição.
- Horas por papel editáveis (− / campo / +), barra por papel, total, a origem (Definido no VS / Do Redmine) e a situação da estimativa (seção 5.0).
- Os 4 critérios em botões segmentados com a pergunta ao lado. A prioridade recalcula e a bolha muda de célula na hora.
- Decisão: **Incluir no plano · Adiar · Descartar**, mais a observação.
- No plano: posição com ↑ e ↓, versões previstas ("prevista para Fevereiro" ou "Fevereiro → Março") e a situação de execução.
- OSs vinculadas, com status, e o botão "Vincular OS".
- Horas estimadas × realizadas.
- Histórico, aproveitando `projeto_eventos` com os tipos novos `decisao`, `criterios`, `posicao` e `entrega`.
- Botão **Marcar como entregue**.

Sem `gerir_projetos`, a ficha é só leitura, exceto para o autor de uma demanda em triagem.

### 6.3 Movimento (parte do pedido do usuário: "inovador, animado")
- **Ao abrir:** as bolhas da grade aparecem em sequência e as bolhas caem nos potes, a primeira do plano primeiro. É o único movimento que não depende de ação do usuário.
- **Incluir no plano** (botão ou arrastar): a bolha cai no pote em que foi prevista.
- **Mudar critério ou horas:** a bolha desliza para a nova célula e muda de tamanho.
- **Mudar posição, arrastar a tampa ou mudar horas:** o plano redistribui e as bolhas que mudam de versão caem no pote novo. A diretoria precisa *ver* a demanda mudar de versão.
- A superfície do líquido ondula de leve.
- Respeitar `prefers-reduced-motion`: tudo aparece já assentado, sem animação.

### 6.4 Modo Apresentar
Tela cheia com a mesma tela, sem controles de edição e com letras maiores. Mostra também o **resumo da última versão encerrada** (seção 6.5). Sai com Esc.

### 6.5 Plano × realizado (ao encerrar uma versão)
Resumo automático, comparando com a linha de base da versão:
- **Cumprimento:** horas previstas × realizadas no plano, e demandas previstas × entregues.
- **Herdadas:** demandas previstas que não foram entregues e seguem para as próximas versões.
- **Precisão das estimativas:** estimado × realizado das demandas entregues.
- **Capacidade sugerida:** média do realizado do plano nas últimas 3 versões encerradas, por papel, mostrada como sugestão ao preencher a capacidade de uma versão planejada.

Aparece no encerramento da versão (tela de versões existente), no modo Apresentar e numa seção recolhível da tela de Plano.

### 6.6 Telas existentes
- **Versões:** campo "Horas para o plano", marca de versão planejada e o resumo da seção 6.5 nas encerradas.
- **Modal da OS e cartão do kanban:** o campo e o selo "Projeto" passam a se chamar "Demanda". Aceitam vínculo só demandas `plano` ou `entregue`. Vincular a uma entregue não reabre a demanda (*decisão minha*); o gestor reabre se quiser.
- **Preferências → Plataforma:** "Fluxo de projetos" vira **"Plano"** (critérios, faixas e papéis com trackers e tipos de atividade).
- **Papéis:** a permissão `gerir_projetos` passa a ser exibida como "Gerir o plano". O menu `projetos` mantém a chave.

---

## 7. Permissões
- **Todos do workspace:** ver o Plano e o modo Apresentar, criar demanda (entra em triagem), editar as próprias demandas em triagem e vincular as próprias OSs.
- **`gerir_projetos`:** avaliar, decidir, ordenar, ajustar horas das versões, sincronizar, marcar entregue e reabrir.
- **Admin:** editar `plano_config`.
- Tudo checado no banco (RLS e trigger), como no padrão atual, além do `can()` no cliente.

---

## 8. Fora de escopo
Gantt e datas por demanda; dependências entre demandas; alocação por pessoa; fixar demanda em versão; mais ou menos de 4 critérios; custo financeiro (a planilha tinha R$ 120/h, que fica de fora nesta fase); importação automática de chamados do Redmine por filtro; tema visual por ramo.

## 9. Fica com o construtor
- Representação da versão "planejada" (seção 3.2).
- Remover ou manter no banco as colunas e tabelas antigas (etapas e configuração por etapa; os papéis continuam em uso).
- Layout responsivo da fileira de potes e parâmetros da física das bolhas; detalhes visuais dentro do estilo do mockup.
- Formato do script de importação da planilha.
- Testes: funções puras no Node (`distribuirPlano`, prioridade, situação da estimativa, transições de status) e as policies/trigger no padrão das migrations atuais.
