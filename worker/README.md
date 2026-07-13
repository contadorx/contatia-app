# Contatia — Worker de e-mail (SMTP probe)

Serviço isolado que faz a conversa SMTP para descobrir/verificar e-mails. Roda no **VPS**
(não no Vercel), porque o Vercel bloqueia a porta 25 de saída. O app Contatia chama este worker
via `WORKER_URL` + `WORKER_TOKEN`.

## Por que o resultado dava "não existe" quando o e-mail existia (falso negativo)

A causa quase nunca é o e-mail — é a **conversa SMTP ser recusada**. Dois motivos clássicos,
ambos resolvidos por config de infra (não por código):

1. **rDNS/PTR ausente ou desalinhado.** O IP do VPS precisa ter DNS reverso (PTR) apontando para
   um hostname, e o worker precisa anunciar **esse mesmo hostname** no EHLO/HELO (`WORKER_HELO_HOST`).
   Sem isso, muitos servidores derrubam a conversa antes do RCPT — e o código antigo lia isso como
   "não existe". Agora o worker devolve `blocked` (não `not_found`) quando a conversa é recusada.
2. **Greylisting.** O servidor responde `4xx` ("tente de novo mais tarde"). O worker agora trata
   `4xx` como **`uncertain`** (não como inválido), evitando o falso negativo.

Além disso o worker detecta **catch-all** (servidor que aceita qualquer endereço → `uncertain`) e
**provedores não verificáveis** (Google Workspace / Microsoft 365 → `blocked`).

## Requisitos de infra (IMPORTANTES)

- Porta 25 de **saída** liberada no VPS (peça ao provedor; alguns bloqueiam por padrão).
- **PTR/rDNS** do IP configurado (ex.: `mail.seudominio.com.br`).
- `WORKER_HELO_HOST` = exatamente esse hostname.
- SPF do domínio incluindo o IP (ajuda a reputação do MAIL FROM).

## Variáveis de ambiente

| Var | Descrição |
|-----|-----------|
| `PORT` | porta HTTP (padrão 8080) |
| `WORKER_TOKEN` | token Bearer; **o mesmo** valor vai no `WORKER_TOKEN` do app |
| `WORKER_HELO_HOST` | hostname anunciado no EHLO/HELO — bate com o PTR do IP |
| `WORKER_MAIL_FROM` | remetente do envelope (ex.: `verify@seudominio.com.br`) |
| `WORKER_SMTP_TIMEOUT_MS` | timeout por conexão SMTP (padrão 12000) |

## Rodar

```bash
cd worker
WORKER_TOKEN=troque-isto \
WORKER_HELO_HOST=mail.seudominio.com.br \
WORKER_MAIL_FROM=verify@seudominio.com.br \
node server.js
```

Recomendado atrás de um proxy HTTPS (Caddy/Nginx) e sob systemd/pm2. No app, aponte
`WORKER_URL=https://worker.seudominio.com.br` e `WORKER_TOKEN=<o mesmo token>`.

## Endpoints

- `GET  /health` → `{ ok: true }`
- `POST /discover` `{ nome, dominio }` → `{ email, status, tentativas[] }`
  - `status`: `valid | not_found | uncertain | blocked | invalid`
- `POST /verify` `{ email }` → `{ status, reason? }`

## Ética / limites

Só faz `RCPT TO` — **nunca envia** mensagem (não chega no `DATA`). Ainda assim, use com
parcimônia: rode em baixo volume, respeite opt-out e não sonde domínios em massa. O objetivo é
confirmar um e-mail antes de uma cadência, não varrer listas.
