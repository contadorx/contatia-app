-- ============================================================
-- Contatia — Migration 0120 (fechamento com confirmação, e o que sobra para aprender)
--
-- DUAS COISAS, e elas se encontram: o fechamento produz o desfecho, e o desfecho é a
-- matéria-prima do aprendizado.
--
-- ---------- F3: a proposta que espera um "sim" ----------
--
-- A espec é literal: *"Cobrança Asaas só sai depois de 'sim' explícito do lead a um
-- resumo fechado (produto, valor, vencimento)."* Isso exige guardar O QUE foi proposto,
-- porque senão "sim" não tem a que se referir — e um modelo perguntado "ele concordou?"
-- responderia pelo que lembra da conversa, que é exatamente o lugar onde não se pode
-- confiar em lembrança.
--
-- `proposta_pendente` é o contrato: gravado quando o agente propõe, conferido quando ele
-- tenta fechar. O valor da cobrança sai DAQUI, nunca do que o modelo digitou na hora de
-- fechar. Se os dois discordarem, quem manda é o que o lead leu.
--
-- `proposta_em` existe para a proposta VENCER. Um "sim" três semanas depois de um resumo
-- que ninguém lembra não é aceite — é confusão virando cobrança.
--
-- ---------- F5: o que o destilador já leu ----------
--
-- `destilado_em` evita que a mesma conversa vire exemplo toda noite. Sem isso, uma venda
-- boa entraria no banco de exemplos sete vezes por semana e dominaria o few-shot — o
-- agente aprenderia uma conversa, não um padrão.
--
-- Roda depois de 0001-0119. Idempotente. Non-breaking.
-- ============================================================

alter table public.agent_conversas add column if not exists proposta_pendente jsonb;
alter table public.agent_conversas add column if not exists proposta_em       timestamptz;
alter table public.agent_conversas add column if not exists destilado_em      timestamptz;

comment on column public.agent_conversas.proposta_pendente is
  'O resumo exato que o lead leu: {plano, valor, vencimento, produto_id}. A cobranca usa ESTE valor, nunca o que o modelo digitar na hora de fechar. Nulo = nao ha proposta na mesa.';
comment on column public.agent_conversas.proposta_em is
  'Quando a proposta foi apresentada. Proposta velha expira: um "sim" a um resumo que ninguem lembra nao e aceite.';
comment on column public.agent_conversas.destilado_em is
  'Ultima vez que o destilador leu esta conversa. Impede a mesma venda de virar exemplo toda noite e dominar o few-shot.';

-- O destilador varre por aqui: encerradas, com desfecho, ainda não lidas.
create index if not exists agent_conversas_destilar_idx
  on public.agent_conversas (tenant_id, ultima_msg_em desc)
  where desfecho is not null and destilado_em is null;

-- ============================================================
-- A venda que o agente fechou precisa ser rastreável até a cobrança.
--
-- Sem estas duas colunas, "o agente fechou" e "a cobrança existe" seriam dois fatos sem
-- ligação — e reconciliar isso à mão, depois, é o tipo de trabalho que ninguém faz.
-- ============================================================
alter table public.opportunities add column if not exists asaas_payment_id text;
alter table public.opportunities add column if not exists asaas_link       text;
alter table public.opportunities add column if not exists origem           text;

comment on column public.opportunities.origem is
  'Quem criou a oportunidade: null/manual = pessoa; agente = o motor fechou sozinho. Separa o resultado do agente do resultado do time no relatorio.';

create index if not exists opportunities_origem_idx
  on public.opportunities (tenant_id, origem, created_at desc)
  where origem is not null;
