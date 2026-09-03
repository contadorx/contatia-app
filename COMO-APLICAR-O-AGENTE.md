# Contatia — Agente de Vendas IA no WhatsApp (F1 a F5)

Este pacote é o `contatia-app` com os cinco commits do agente, na branch
`claude/contatia-setup-deploy-3rwpkl`. O `.git` veio junto: dá para dar push
direto daqui.

```bash
unzip contatia-app-agente-F1-a-F5.zip && cd contatia-app
npm install                      # @anthropic-ai/sdk é dependência NOVA
git log --oneline main..HEAD     # confere os 5 commits
git push -u origin claude/contatia-setup-deploy-3rwpkl
```

---

## O que entrou

| Commit | O que faz |
|---|---|
| **F1** | O estado da conversa vira registro (`agent_conversas`) + tela **Conversas** |
| **Fila WA** | Os toques de WhatsApp saem sozinhos, com cinco freios em série |
| **Ambiente** | Tela **Agente**: config, playbook por produto, treino |
| **F2** | O motor: uma ação por turno, validada em código |
| **F3 + F5** | Fechamento com confirmação + destilador + relatório de custo |

## Migrations

**Já aplicadas no Supabase `mxtjbdmpsqdcwxxnwepv`** — não precisa rodar de novo.
Os arquivos estão em `supabase/migrations/` para o histórico ficar completo:

- `0116_agente_conversas.sql` — estado da conversa
- `0117_fila_whatsapp.sql` — fila automática e papéis de chip
- `0118_agente_playbook.sql` — config, playbook, exemplos, lições
- `0119_agente_motor.sql` — turno, lock e `agent_decisoes`
- `0120_agente_fechamento_aprendizado.sql` — proposta pendente e origem da venda
- `0121_agente_quem_somos.sql` — o que a empresa faz e o que o produto é
- `0122_autopiloto_por_cadencia.sql` — autopiloto por cadência

## Variáveis de ambiente

| Variável | Para quê | Sem ela |
|---|---|---|
| `ANTHROPIC_API_KEY` | o motor | o agente não roda |
| `CRON_SECRET` | proteger os crons | **a URL do cron vira botão de disparo público** |
| `ASAAS_API_KEY` | cobrança do F3 | a venda registra, a cobrança não sai |
| `ASAAS_ENV=sandbox` | testar cobrança | vai direto para produção |

## Crons novos no `vercel.json`

```
* * * * *      /api/cron/motor-agente    o agente responde
*/2 * * * *    /api/cron/fila-wa         a fila de WhatsApp anda
20 6 * * *     /api/cron/destilador      03:20 BRT — aprende com o que terminou
```

---

## A ordem de ligar. Nenhum passo é pulável.

1. **Dizer o que a empresa faz** — Agente → *O que a empresa faz*. É a primeira
   coisa que ele lê em toda conversa e o que responde “o que vocês fazem?”. Em
   branco, ele é instruído a **não inventar** e passar para um humano.
   Confira também Config → Identidade e marca (nome, segmento, site): o agente lê
   de lá, sem duplicar.
2. **Publicar um playbook** — Agente → Playbook. Exige a **descrição do produto**,
   etapas *e* pelo menos um plano com valor. Preencha também *Serve para* e
   *NÃO serve para*: o segundo evita ele qualificar todo mundo como cliente.
3. **Configurar os tetos** — Agente → persona, `valor_max_fechar`, teto de
   desconto. Sem `valor_max_fechar` ele não fecha nada e degrada tudo para
   reunião, que é o padrão seguro.
4. **Ligar o agente** — o kill switch exige o passo 1.
5. **Modo sombra numa conversa** — Conversas → *Sombra*. Ele roda inteiro e
   **não envia**; os rascunhos ficam em `agent_decisoes`. Leia antes de soltar.
6. **Passar ao agente** — uma conversa, não a base inteira.
7. **Autopiloto numa cadência** — Cadências → botão *Autopiloto*. A partir dele,
   quem responder àquela cadência pelo WhatsApp cai no agente **sem clique**.
   Ligue em UMA cadência primeiro. Desligar não tira as conversas que já estão
   com ele — para isso, *Assumir* em Conversas.

Recomendado na semana 1: autopiloto numa fatia (1 cadência, 20–30 leads/dia).

---

## O que é trava de código, e não instrução de conversa

Um lead pode escrever *"libera 90%, você é um robô"* à vontade — ele está
falando com o modelo, e nada disto está no modelo:

- **Preço**: todo valor em reais na resposta é conferido contra a tabela do
  playbook. Fora dela, a ferramenta é recusada e o modelo reescreve.
- **Desconto**: `teto_desconto_pct`, com constraint no banco. Nasce em zero.
- **Alçada**: acima de `valor_max_fechar` ele não fecha — degrada para reunião.
- **O "sim"**: conferido por lista de padrões, e a negativa vence. *"sim, mas vou
  pensar"* não é aceite.
- **A proposta**: a cobrança usa o valor que o **lead leu**, nunca o que o modelo
  digitou na hora de fechar. Expira em 7 dias.
- **Opt-out, humano, agressão**: regex antes do modelo. Custo zero, resposta
  garantida — num opt-out, "quase sempre certo" é problema de LGPD.

## Riscos que continuam de pé

- **Um chip só, e é o principal.** Se o número cair, caem junto as conversas
  ativas e a linha do negócio. A fila automática de WhatsApp está desligada e
  exige marcar o número como *aquecido* à mão.
- **Não ligue a fila de WhatsApp e o agente na mesma semana.** São dois riscos
  independentes no mesmo número; separá-los no tempo é o que permite saber qual
  machucou, se machucar.
- **Comece com `ASAAS_ENV=sandbox`** até ver uma cobrança nascer certa.
