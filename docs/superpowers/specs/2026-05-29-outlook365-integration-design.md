# Design: Integração Outlook 365 / Microsoft Graph

**Data:** 2026-05-29  
**Status:** Aprovado pelo usuário  
**Branch alvo:** homologacao

---

## Problema

Usuários precisam cadastrar o mesmo evento de calendário duas vezes: uma vez no Outlook (onde recebem convites e gerenciam a agenda corporativa) e outra na Agenda do VersionSuite (para que o Resumo do Dia rastreie o tempo e inclua no plano de apropriação). A integração elimina essa duplicação.

---

## Decisões de escopo

| Pergunta | Decisão |
|---|---|
| Direção do sync | Somente Outlook → VS (VS não cria eventos no Outlook) |
| Gatilho de sync | Polling periódico a cada 5 min enquanto o app está aberto |
| Janela de eventos | Hoje + futuros (sem retroativo) |
| Autenticação | OAuth popup MSAL PKCE → tokens armazenados server-side |
| Eventos no VS | Totalmente editáveis (vincular OS, tipo de atividade) |
| Deleção no Outlook | Remove da agenda do VS também |

---

## Arquitetura

### Componentes novos

| Componente | Descrição |
|---|---|
| Tabela Supabase `user_tokens` | Armazena refresh_token criptografado por usuário. RLS: só o próprio `auth.uid()` acessa. |
| Edge Function `outlook-sync` | Recebe JWT do usuário → valida → busca refresh_token → renova access_token → chama Graph API → retorna lista de eventos. Tokens Microsoft nunca saem da Edge Function. |
| Seção "Integrações" em Preferências | Botão "Conectar Microsoft", estado conectado/desconectado, última sincronização. |
| `initOutlookSync()` em index.html | Inicia setInterval de 5 min ao carregar o app. Cada tick chama a Edge Function e faz upsert na agenda local. |

### Componentes sem mudança

- `renderAgenda()` — exibe eventos normalmente; badge "Outlook" adicionado via campo `outlookId`
- `getTodayAgendaEvents()` — já percorre todos os eventos da agenda; inclui eventos Outlook automaticamente
- Resumo do Dia / fluxo de apropriação — nenhuma alteração necessária

---

## Fluxo de autenticação (uma vez por usuário)

```
Browser                  Microsoft              Edge Function          Supabase
  |                          |                        |                    |
  |-- "Conectar" clicado --> |                        |                    |
  |<-- popup OAuth (PKCE) -- |                        |                    |
  |-- consent do usuário --> |                        |                    |
  |<-- authorization_code -- |                        |                    |
  |-- POST /outlook-sync/auth (code) ---------------> |                    |
  |                          |<-- troca code por tokens ----------------> |
  |                          |                        |-- INSERT user_tokens (criptografado) --> |
  |<-- { connected: true } --|                        |                    |
```

O `authorization_code` é válido por 10 minutos e de uso único. Após a troca, o browser nunca mais recebe tokens Microsoft.

---

## Fluxo de sincronização periódica

```
Browser                         Edge Function              Microsoft Graph
  |                                  |                           |
  |-- GET /outlook-sync (JWT) -----> |                           |
  |                                  |-- busca refresh_token do Supabase
  |                                  |-- POST token endpoint --> |
  |                                  |<-- access_token (novo) -- |
  |                                  |-- GET /me/calendarView -> |
  |                                  |<-- lista de eventos ------ |
  |<-- [ {id, subject, start, end} ] |                           |
  |-- upsert em localStorage         |                           |
```

---

## Modelo de evento (extensão do existente)

Campo `outlookId` adicionado ao modelo `vs_agenda_events` em localStorage:

```json
{
  "id": "uuid-local",
  "outlookId": "AAMkAGI...",
  "title": "Review Sprint 14",
  "startDate": "2026-05-29",
  "startTime": "10:30",
  "endTime": "11:30",
  "osId": null,
  "activityTypeId": null,
  "recurrence": { "type": "none" }
}
```

Eventos sem `outlookId` são eventos criados diretamente no VS — comportamento atual inalterado.

---

## Regras de sincronização

| Cenário | Comportamento |
|---|---|
| Novo evento no Outlook | Inserido na agenda VS com `outlookId`. Badge "Outlook" visível. |
| Evento editado no Outlook (título, horário) | Atualiza `title`, `startDate`, `startTime`, `endTime`. Preserva `osId`, `activityTypeId` definidos pelo usuário no VS. |
| Evento deletado no Outlook | Removido da agenda VS (mesmo que tenha OS vinculada). |
| Usuário edita evento Outlook no VS | Pode associar OS, tipo de atividade, descrição. Na próxima sync apenas agenda/título são reconciliados. |

---

## Segurança

| Requisito | Implementação |
|---|---|
| Tokens nunca no browser | Edge Function faz todas as chamadas ao Graph. Front recebe apenas dados de eventos. |
| Criptografia em repouso | refresh_token criptografado com AES-256-GCM antes de salvar no Supabase. Chave = `ENCRYPT_KEY` armazenada como Supabase Secret (env var da Edge Function), nunca em código. |
| Acesso restrito | RLS em `user_tokens`: `auth.uid() = user_id`. |
| Escopo mínimo | `Calendars.Read` (somente leitura). |
| Refresh token rotation | A cada renovação, o token antigo é descartado e o novo salvo. |
| client_secret protegido | Armazenado como variável de ambiente na Edge Function (Supabase Secrets). Nunca no código ou no front. |

**Argumento para o TI:** modelo idêntico ao usado por ERPs e ferramentas corporativas para integrações OAuth. O Azure AD App é registrado e controlado pelo próprio TI (client_id + client_secret fornecidos por eles).

---

## Pré-requisito externo

O TI precisa registrar um **Azure AD App** com:
- Permission: `Calendars.Read` (delegated)
- Redirect URI: `http://localhost:8080` (dev) + URL de produção
- Fornecer: `client_id` e `tenant_id` (configurados nas variáveis da Edge Function)

Sem este registro o fluxo OAuth não pode ser iniciado. É o bloqueio já conhecido.

---

## UI

### Preferências → Integrações

- **Estado desconectado:** botão "Conectar" azul ao lado do logo Microsoft
- **Estado conectado:** email da conta conectada em verde, última sync, botão "Desconectar"

### Agenda

- Eventos do Outlook exibem badge `Outlook` azul ao lado do título
- Editáveis normalmente (vincular OS, tipo de atividade)
- Nenhum indicador de "read-only"

---

## Fora de escopo

- Criação/edição de eventos do VS no Outlook
- Sync de Teams meetings com link de videochamada
- Notificações em tempo real (webhooks Graph) — polling é suficiente
- Calendários compartilhados (só calendário pessoal do usuário autenticado)
