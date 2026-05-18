# Daily Flow System — Design Spec

**Date:** 2026-05-18  
**Status:** Approved  
**Scope:** VersionSuite `index.html` (single-file app) + Nova Agenda

---

## Visão Geral

Conjunto de 7 funcionalidades integradas que transformam o VersionSuite em um sistema de gestão de fluxo diário. O objetivo é dar ao desenvolvedor visibilidade completa sobre o que planejou, o que fez e quanto tempo levou — fechando o ciclo planejamento → foco → apropriação → exportação.

As 7 partes foram agrupadas em 3 fases de implementação:

| Fase | Partes | Foco |
|------|--------|------|
| 1 | 1, 2, 3 | Alertas + Peso Inteligente + Planejamento do Dia |
| 2 | 4, 5 | Foco / Timer + Resumo do Dia |
| 3 | 6, 7 | Nova Agenda + Exportação Redmine |

---

## Parte 1 — Sistema de Alertas (Sino na Topbar)

### Comportamento

O ícone de sino na topbar substitui o banner de alertas. Ele anima (ring animation) quando há alertas não lidos e exibe um badge com a contagem. Clicando abre um dropdown com a lista de alertas.

### Cinco alertas temporais

Todos baseados nos horários configurados nas preferências do usuário (entrada, almoço, retorno, saída). Os horários são por usuário (localStorage, chave `vs_schedule`).

| Alerta | Gatilho | Mensagem |
|--------|---------|---------|
| Início do expediente | No horário de entrada | "Bom dia! Hora de planejar seu dia. Que tal começar pelo planejamento?" |
| Almoço | No horário de almoço | "Hora do almoço! Não se esqueça de registrar o ponto antes de sair." |
| Retorno | No horário de retorno (auto-detectado após pausa >30min) | "Bem-vindo de volta! Reveja o planejamento — o que ainda falta para hoje?" |
| Fim do expediente | 15 min antes da saída | "Expediente quase no fim. Hora de fechar as OSs do dia e apropriar as horas." |
| Hora extra | 30 min após horário de saída | "Ainda por aqui? Você é muito dedicado! Não esqueça de registrar tudo antes de sair." |

### Persistência
- Alertas armazenados em `vs_alerts_YYYY-MM-DD` (array de objetos `{type, firedAt, readAt}`)
- Alertas marcados como lidos ao abrir o dropdown
- Cada tipo dispara no máximo uma vez por dia
- Verificação via `setInterval` a cada 60 segundos

### Sino — Estados
- **Sem alertas não lidos**: sino cinza, estático
- **Alerta não lido**: sino animando (ring), badge laranja com contagem
- **Dropdown aberto**: lista de alertas, mais antigos primeiro, botão "Marcar todos como lidos"

---

## Parte 2 — Peso Inteligente (OS Size)

### Conceito

Substitui o checklist de "Entregas Aplicáveis" (removido). Cada OS tem um campo de estimativa de horas que determina automaticamente seu porte (badge).

### Slider de estimativa

- Slider horizontal de 1h a 24h com marcações em: 1h · 2h · 6h · 14h · 24h
- Campo numérico sempre editável (aceita valores > 24h digitando diretamente)
- Badge exibido automaticamente conforme o valor:

| Horas | Badge |
|-------|-------|
| ≤ 2h | Rápida (verde) |
| > 2h e ≤ 6h | Normal (azul) |
| > 6h e ≤ 14h | Grande (âmbar) |
| > 14h | Épico (roxo) |

### Peso Inteligente

Sistema de velocidade por desenvolvedor que ajusta estimativas futuras:

- `vs_velocity_factor` em localStorage (float, default 1.0)
- Fórmula: `horas_reais / horas_estimadas` (média dos últimos 30 dias com pelo menos 5 OSs)
- Ao criar nova OS: `estimativa_sugerida = estimativa_base / velocity_factor`
- Fator exibido discretamente na tela de estimativa: "Seu fator de velocidade atual: 0.87 (você tende a subestimar)"

---

## Parte 3 — Planejamento do Dia

### Gatilho

Modal abre automaticamente ao fazer login no dia (ou ao clicar na notificação de "Início do expediente"). Só abre uma vez por dia — estado em `vs_dayplan_YYYY-MM-DD` (localStorage).

### Conteúdo do modal

1. **Saudação** com data e dia da semana
2. **OSs sugeridas** — lista de OSs "Em andamento" priorizadas por:
   - Urgência (data de vencimento)
   - Porte (Épico > Grande > Normal > Rápida)
3. **Seleção e estimativa**: usuário seleciona quais OSs vai trabalhar hoje e define quantas horas para cada uma (campo editável, pré-preenchido com estimativa do Peso Inteligente)
4. **Total de horas planejadas** com indicador visual (verde se ≤ carga-diária configurada, âmbar se até 15% acima, vermelho se além)
5. **Botão "Começar o dia"** — persiste o plano e fecha o modal

### Estrutura de dados

```js
vs_dayplan_YYYY-MM-DD = {
  createdAt: ISO8601,
  confirmedAt: ISO8601 | null,
  entries: [
    { osId, osTitle, plannedHours, actualHours, status }
  ]
}
```

---

## Parte 4 — OS em Foco (Timer na Topbar)

### Pill de foco

Widget persistente na topbar (entre logo e notificações). Três estados:

| Estado | Visual | Descrição |
|--------|--------|-----------|
| Sem foco | Borda neutra, texto cinza "Nenhuma OS em foco" | Nenhum timer rodando |
| Em foco | Borda verde, ponto verde pulsante, timer verde | Timer ativo |
| Pausado | Borda âmbar, ponto âmbar fixo, texto "pausado" | Timer pausado |

### Dropdown ao clicar

- OS atual (com tempo acumulado hoje)
- Lista "Trocar para" — apenas OSs do plano do dia corrente
- Botões: **Pausar foco** / **Concluir OS**

### Timer e persistência

- Timer baseado em timestamps, não em `setInterval` — resiste a refresh
- `vs_focus_state` em localStorage: `{ osId, startedAt, pausedAt, accumulated }`
- `vs_time_log_YYYY-MM-DD` em localStorage: array de sessões `{ osId, start, end, duration }`

### WIP Limit

Ao mover OS para "Em andamento" no Kanban e limite atingido (configurável, default 3):
- Modal de aviso lista as 3 OSs em andamento com botão "Concluir" em cada uma
- Botão "Forçar mesmo assim" (confirma sem concluir)

---

## Parte 5 — Resumo do Dia

### Gatilho

Modal abre automaticamente ao registrar a 4ª marcação de ponto (saída). Se fechado sem confirmar, reabre no próximo login do mesmo dia.

### Conteúdo

1. **Stats hero**: Planejado · Rastreado · Diferença (verde se positivo, âmbar se negativo)
2. **Por OS**: tabela planejado vs rastreado vs campo "Apropriar" (pré-preenchido com rastreado, editável)
3. **OSs fora do plano**:
   - Auto-incluídas se timer > 5 min na OS (marcadas como "⚡ fora do plano")
   - Adicionáveis manualmente via busca inline (para OSs trabalhadas mas não rastreadas)
4. **Total a apropriar** (soma dinâmica dos campos "Apropriar")
5. **Footer**: "Ajustar depois" (fecha sem confirmar) · "Confirmar e apropriar" (persiste e encerra sessão do dia)

### Persistência

```js
vs_dayresume_YYYY-MM-DD = {
  confirmedAt: ISO8601 | null,
  entries: [
    { osId, plannedHours, trackedHours, approvedHours, inPlan: bool }
  ]
}
```

### Feedback emocional

- Dia acima ou no plano: "🎯 Plano cumprido!"
- Dia abaixo do plano: "📊 Dia desafiador — tudo bem." com mensagem encorajadora

---

## Parte 6 — Nova Agenda

### Dois tipos de entrada

| Tipo | Descrição |
|------|-----------|
| **Período** | Existente — bloco de horário sem hora específica (ex: "Manhã: OS X") |
| **Evento pontual** | Novo — compromisso com hora de início e fim (reunião, alinhamento, etc.) |

### Formulário de evento pontual

Campos:
- Título (obrigatório)
- Tipo de Atividade (dropdown — usa lista Redmine configurada)
- OS vinculada (optional — busca por número/título; se preenchida, entra na exportação Redmine)
- Data + hora início + hora fim
- Descrição (opcional)
- Recorrência: Não repete · Semanal (checkboxes por dia) · Mensal (grid de dias do mês)

### Edição de evento recorrente

Ao editar ocorrência de evento recorrente, modal pergunta:
- "Só este" — edita apenas essa ocorrência (cria exceção)
- "Este e os próximos" — edita a partir desta data
- "Todos" — edita todas as ocorrências

### Estrutura de dados

```js
vs_agenda_events = [
  {
    id, title, activityType, osId, osTitle,
    startDate, startTime, endTime, description,
    recurrence: { type: 'none'|'weekly'|'monthly', days: [], dayOfMonth: int },
    exceptions: { [date]: { ...overrides } | null }  // null = cancelled
  }
]
```

### Visualização

- Períodos: barras coloridas horizontais (existente)
- Eventos pontuais: sobrepostos nas barras com horário + badge de OS vinculada
- Eventos sem OS exibem nota: "Não entra na exportação Redmine"

---

## Parte 7 — Exportação Redmine

### CSV gerado

Nome: `redmine_horas_YYYYMMDD.csv`  
Formato: `Numero OS;Data;Tempo;Atividade`

| Linha | Origem | Cor na preview |
|-------|--------|----------------|
| OS rastreadas no dia | `vs_dayresume` com `approvedHours` | Verde |
| Eventos pontuais com OS vinculada | `vs_agenda_events` com `osId` preenchido | Roxo |
| Eventos sem OS | Exibidos riscados na preview | Riscado (não incluídos no CSV) |

### Fluxo de exportação

1. Usuário clica "Exportar para Redmine" (na tela de Agenda ou no Resumo do Dia)
2. Preview do CSV exibida (tabela visual com cores)
3. Botão "Baixar CSV" faz download do arquivo
4. Botão "Lançar via proxy" (quando proxy ativo) faz POST direto na API Redmine

---

## Componentes Afetados

| Arquivo | Mudança |
|---------|---------|
| `index.html` | Todas as 7 partes — JS, CSS e HTML inline |
| `redmine-proxy.js` | Nenhuma mudança necessária para MVP |

---

## Dados em localStorage

| Chave | Conteúdo |
|-------|---------|
| `vs_schedule` | Horários do usuário (entrada, almoço, retorno, saída) |
| `vs_alerts_YYYY-MM-DD` | Alertas disparados/lidos no dia |
| `vs_velocity_factor` | Fator de velocidade individual |
| `vs_dayplan_YYYY-MM-DD` | Plano do dia (OSs + horas planejadas) |
| `vs_focus_state` | Estado atual do foco (OS, timestamps) |
| `vs_time_log_YYYY-MM-DD` | Log de sessões de foco do dia |
| `vs_dayresume_YYYY-MM-DD` | Resumo/apropriação do dia |
| `vs_agenda_events` | Todos os eventos pontuais (todas as datas) |

---

## Fases de Implementação

### Fase 1 — Alertas + Peso + Planejamento
1. Adicionar `vs_schedule` config nas preferências (horários)
2. Implementar sino na topbar com ring animation e badge
3. Implementar verificador de alertas (`setInterval` 60s)
4. Remover checklist "Entregas Aplicáveis"
5. Adicionar slider + campo de estimativa na tela de OS
6. Calcular e exibir badge automaticamente
7. Implementar cálculo de `vs_velocity_factor`
8. Implementar modal de Planejamento do Dia

### Fase 2 — Foco + Resumo
1. Implementar pill de foco na topbar (3 estados)
2. Implementar dropdown de foco com troca de OS
3. Implementar timer baseado em timestamps
4. Implementar WIP Limit check no drag do Kanban
5. Implementar modal de Resumo do Dia
6. Lógica de reabertura se fechado sem confirmar
7. Cálculo de velocity após confirmação

### Fase 3 — Nova Agenda + Exportação
1. Adicionar toggle Período / Evento pontual no formulário de agenda
2. Implementar campos de evento pontual (tipo, OS, horário, recorrência)
3. Implementar lógica de exceções em recorrências
4. Atualizar visualização da agenda
5. Implementar preview e download do CSV Redmine
6. (Opcional) Lançamento via proxy

---

## Não incluído neste escopo

- Sincronização entre dispositivos de alertas/plano (localStorage é por dispositivo — adequado pois o mesmo PC é compartilhado por pessoa)
- Relatórios históricos de velocidade
- Integração bidirecional com Redmine (apenas exportação CSV/POST)
