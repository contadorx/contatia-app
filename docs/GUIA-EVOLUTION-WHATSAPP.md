# Levar a integração Evolution (WhatsApp) para outro app

Guia de transplante. Escrito a partir do código que roda no Contatia hoje — inclusive
das armadilhas que ele já pagou, que é a parte que não está na documentação da Evolution.

> **Não confunda com a pasta `worker/`.** Aquilo é um probe SMTP que descobre e valida
> e-mail, e mora no VPS porque o Vercel bloqueia a porta 25. Serviço diferente, que por
> acaso divide o mesmo servidor.

---

## 1. O que você leva

| Arquivo | Linhas | O que é |
|---|---:|---|
| `src/lib/whatsapp.ts` | 400 | **O núcleo.** Cliente da Evolution: enviar, QR, status, webhook, presence, mídia, verificar número, apagar instância. |
| `src/app/api/whatsapp/webhook/[token]/route.ts` | 311 | Entrada. Recebe `MESSAGES_UPSERT` e `CONNECTION_UPDATE`. |
| `src/lib/instanciaWa.ts` | 80 | Qual número usar quando há mais de um (próprio → do workspace → compartilhado). |
| `src/lib/waModo.ts` | 62 | Os quatro modos: assistido, híbrido, automático, meta. |
| `src/lib/waVerify.ts` | 39 | Verificação em massa: monta as variantes e pergunta tudo numa chamada. |
| `src/lib/envioManual.ts` | 157 | Captura o que você mandou do seu próprio celular (`fromMe`). |
| `src/components/WhatsAppConnect.tsx` | 460 | A tela de conectar (QR, status, remover). |

**O mínimo que funciona:** `whatsapp.ts` + o webhook. O resto resolve problemas que talvez
o outro app não tenha.

---

## 2. Schema mínimo

```sql
create table public.whatsapp_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,              -- troque pelo dono do outro app
  evolution_url text not null,
  api_key       text not null,
  instance      text not null,              -- nome da instância na Evolution
  is_active     boolean not null default true,
  daily_cap     integer not null default 40,
  -- o token vai na URL do webhook: é ele que diz de QUEM é a mensagem que chegou
  inbound_token text not null default replace(gen_random_uuid()::text, '-', ''),
  status        text,                       -- 'open' | 'close' | 'connecting'
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table public.whatsapp_messages (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  account_id     uuid references public.whatsapp_accounts(id),
  contact_id     uuid,                      -- nulo quando o número é desconhecido
  phone          text,
  direction      text not null default 'in',
  text           text,
  wa_message_id  text,
  media_type     text,
  media_mime     text,
  raw            jsonb not null default '{}'::jsonb,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

-- OBRIGATÓRIO: a Evolution reentrega evento. Sem este índice a mesma
-- mensagem entra duas vezes e toda contagem passa a mentir.
--
-- O `where ... is not null` é a forma certa: mensagem gravada pelo próprio app (envio
-- automático) não tem wa_message_id, e o índice PARCIAL deixa essas linhas em paz.
-- (No Contatia existem dois índices equivalentes aqui, `wamsg_waid_idx` e
-- `whatsapp_messages_waid_uniq` — o segundo é redundante, herdado de migration antiga.
-- Não replique os dois: leve só este.)
create unique index whatsapp_messages_dedupe
  on public.whatsapp_messages (tenant_id, wa_message_id)
  where wa_message_id is not null;

create table public.whatsapp_blocklist (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  phone      text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone)
);
```

`raw jsonb` não é enfeite: a Evolution precisa da mensagem crua de volta para entregar a
mídia (`/chat/getBase64FromMediaMessage`). Sem guardar, a foto que o lead mandou não é
recuperável depois.

---

## 3. Variáveis de ambiente

| Var | Para quê |
|---|---|
| `EVOLUTION_URL` | servidor Evolution da plataforma (modo gerenciado) |
| `EVOLUTION_API_KEY` | chave global desse servidor |
| `NEXT_PUBLIC_APP_URL` | usada para montar a URL do webhook ao configurá-lo |

As duas primeiras são **opcionais**: sem elas o app cai no modo "traga seu servidor", e
cada conta guarda `evolution_url` e `api_key` próprios na linha. É o `platformEvolution()`
em `whatsapp.ts` que decide.

---

## 4. O fluxo de conectar um número

```
1. cria a linha em whatsapp_accounts (instance = nome único, ex.: app_<tenant>_<rand>)
2. getQR(acc)          → cria a instância se não existir e devolve o QR
3. usuário escaneia    → a Evolution manda CONNECTION_UPDATE state=open
4. setWebhook(acc, `${APP_URL}/api/whatsapp/webhook/${acc.inbound_token}`)
5. getStatus(acc)      → confirma 'open'
```

O passo 4 é o que quase todo mundo esquece. Sem ele nada volta: você envia e nunca fica
sabendo que responderam.

---

## 5. As armadilhas que este código já pagou

Esta é a parte que justifica copiar em vez de reescrever.

### 5.1 O 9º dígito brasileiro — e o bug que ele esconde

O WhatsApp registra a conta **com ou sem** o nono dígito (`5511987654321` vs
`551187654321`). Mandar no formato errado devolve `400 {"exists":false}`. `brVariants()`
gera as duas formas e `sendText` descobre qual existe antes de enviar.

**A parte cara:** a regra ingênua põe o 9 em qualquer local de 8 dígitos. Aí o fixo
`(11) 2451-1469` vira `(11) 9 2451-1469` — **um celular válido, de outra pessoa, que de
fato tem WhatsApp**. A Evolution responde "existe" com toda a razão, e a mensagem vai
para um estranho. Nada falha, e o resultado está errado.

No Brasil, celular tem 9 dígitos começando em 9 (as faixas 6/7/8 migraram). Fixo começa
em 2–5 e **nunca** ganha o nono. Por isso `INICIO_CELULAR = /^[6-9]/`.

### 5.2 A Evolution v2 exige `integration` na criação

```js
POST /instance/create  { instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }
```

Sem o `integration`, ela cria a instância e **não gera QR nunca**. O sintoma é "QR
indisponível" para sempre, sem mensagem de erro.

### 5.3 O QR vem em dois formatos

Ou `base64` (imagem pronta) ou `code` (o texto do QR). Quando vem texto, gere a imagem
**localmente** com a lib `qrcode` — o código de pareamento é a credencial da sessão do
cliente e não pode sair do seu servidor para um gerador de QR de terceiro.

### 5.4 `setWebhook` mudou de formato entre versões

O código tenta os dois corpos, em ordem, e só falha se ambos falharem. Não simplifique
para um só sem saber qual versão o VPS roda.

### 5.5 Idempotência: a Evolution reentrega

Confie no índice único, não só na checagem prévia. O código faz `select` antes e
`upsert ... ignoreDuplicates` depois — o `select` economiza trabalho no caso comum, o
índice cobre a corrida de duas entregas simultâneas.

### 5.6 O eco do que você mandou (`fromMe`)

Se a sessão está vinculada, tudo que você envia do celular volta como evento. Isso é ouro
— fecha o ciclo do envio manual — e é **perigoso**: quem tem WhatsApp conectado conversa
com família, banco e grupo de escola pelo mesmo número.

Três travas em `envioManual.ts`, e as três importam:

1. **Só contato conhecido.** Telefone que não casa com alguém da base é descartado, nem
   gravado. Conversa pessoal não entra no CRM.
2. **Idempotência por `wa_message_id`.**
3. **Janela de 10 minutos por telefone+texto.** No modo automático o app já gravou a linha
   de saída *sem* `wa_message_id`, e o eco chega logo depois pelo webhook. Só o id não
   resolve: são dois registros da mesma mensagem, com origens diferentes.

### 5.7 A central automática do outro lado

`"Olá! Bem-vindo ao atendimento automático da X"` chega como resposta. Se você tratar como
engajamento, ela pontua o lead, pausa a cadência e cancela os toques seguintes — o robô do
outro lado desliga a sua sequência e o lead nunca mais é tocado, sem nada aparecer em
lugar nenhum.

`respostaAutomatica.ts` classifica pelo texto **e pelo tempo desde o seu envio** (ninguém
lê, decide e escreve em 20 segundos). A mensagem é gravada, mas não pontua nem pausa.

### 5.8 Grupos e broadcast

Filtre `@g.us` e `status@broadcast` logo no começo. Sem isso, cada status que alguém posta
vira uma linha no seu banco.

### 5.9 Remover instância não é só apagar

Faça `logout` **e** `delete`. Só apagar deixa a instância órfã no servidor, e reconectar
com o mesmo nome vem travado.

### 5.10 Mídia: busque sob demanda, não guarde

`getMediaBase64(acc, raw)` traz o binário na hora de exibir. Guardar mídia de WhatsApp em
banco é caro e, quando envolve documento de cliente, é decisão jurídica — não de
arquitetura.

---

## 6. O que arrancar (acoplamento com o Contatia)

O webhook faz muita coisa que é do Contatia, não da Evolution. Ao transplantar, corte:

| Trecho | O que faz | Manter? |
|---|---|---|
| `enrollments` / `tasks` | pausa cadência ao receber resposta | só se o outro app tiver cadência |
| `scoreEvent` / `POINTS` | pontua o contato | só com scoring próprio |
| `upsertReplyTriage` | fila de triagem | opcional |
| `tocarConversa` / `agent_*` | estado da conversa e agente IA | só se levar o agente junto |
| `whatsapp_blocklist` | LGPD | **manter sempre** |
| dedupe por `wa_message_id` | idempotência | **manter sempre** |
| filtro de grupo/broadcast | ruído | **manter sempre** |

O esqueleto que sobra é: autentica pelo token → identifica a conta → filtra grupo → trata
`fromMe` → deduplica → grava → decide o que fazer.

---

## 7. Anti-ban: o que não está no código

A Evolution usa Baileys, uma reimplementação do protocolo do WhatsApp Web. A conta enxerga
isso como **dispositivo vinculado** — um dispositivo não oficial. Some a isso um padrão
robótico de envio (sem digitação, sem presença, intervalo regular) e o número cai.

O que reduz risco de verdade:

- **Cap diário por número** (`daily_cap`, padrão 40).
- **Intervalo irregular** entre envios. O que denuncia máquina não é a velocidade, é a
  regularidade: 30 em 30 segundos cravados é padrão; 4 a 14 minutos sorteados é gente.
- **Horário comercial.** Prospecção que apita às 3h é lida como robô antes de qualquer
  filtro.
- **`sendPresence("composing")`** antes do texto, pelo tempo que digitar aquilo levaria.
- **Nunca o número principal** para primeiro toque em massa. Chip de frio é consumível;
  quando cair, as conversas dele morrem junto.

Nada disso salva um número que dispara 500 mensagens frias por dia. Reduz risco, não
elimina.

---

## 8. Checklist de aceitação

- [ ] `GET /health` da Evolution responde
- [ ] Instância criada com `integration: "WHATSAPP-BAILEYS"`
- [ ] QR aparece e o pareamento leva o status a `open`
- [ ] `setWebhook` retornou ok e a URL tem o `inbound_token` certo
- [ ] Mensagem recebida grava **uma** linha (mande a mesma duas vezes para provar o dedupe)
- [ ] Mensagem de grupo **não** grava nada
- [ ] Envio para número com e sem o 9º dígito funciona
- [ ] Envio para um **fixo** devolve "não tem WhatsApp" (e não acerta um estranho)
- [ ] Número na blocklist é ignorado em silêncio
- [ ] Remover a conta faz `logout` + `delete` e o nome fica reutilizável
