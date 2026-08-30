-- ============================================================
-- Contatia — Migration 0117 (a fila de WhatsApp anda sozinha — e os freios dela)
--
-- ISTO REVERTE UMA DECISÃO REGISTRADA. A 0115 e o cron `fila-envio` dizem, por escrito,
-- que só e-mail sai sozinho: *"WhatsApp/Instagram/LinkedIn são assistidos por decisão de
-- produto: automatizar o disparo desses é o caminho curto para perder a conta"*. Essa
-- frase continua verdadeira. O que muda é que o dono do número pediu a fila automática
-- sabendo do preço, com UM chip só — e um chip só significa que, quando ele cair, caem
-- junto as conversas ativas e a linha do negócio. Não há plano B.
--
-- Por isso esta migration é mais freio do que motor. Nada aqui liga nada: `fila_wa_
-- automatica` nasce false, `aquecido` nasce false, e o cron recusa trabalhar sem os
-- dois. O que ela entrega é a instrumentação sem a qual o disparo automático é cego.
--
-- O QUE ENTRA:
--
-- tenants
--   fila_wa_automatica  bool → o cron pode disparar toques de WhatsApp deste workspace
--   fila_wa_auto_em     timestamptz → última passagem do cron (justiça entre workspaces)
--   fila_wa_proximo_em  timestamptz → O JITTER. Ver abaixo; é a coluna mais importante.
--
-- whatsapp_accounts
--   papel            text → 'principal' | 'conversa' | 'frio'
--   aquecido         bool → marcado À MÃO. O app não tem como saber se um chip está
--                    aquecido; fingir que sabe seria pior que perguntar.
--   falhas_seguidas  int  → saúde de entrega. 3 seguidas e o chip se pausa sozinho.
--   pausado_em       timestamptz → quando parou (null = ativo)
--   pausa_motivo     text → por quê, em português, para a tela dizer
--
-- POR QUE `fila_wa_proximo_em` E NÃO "N POR RODADA":
-- O que queima um número não é o total do dia — é a CADÊNCIA. Quarenta mensagens
-- espalhadas em dez horas é um humano trabalhando; quarenta em quatro minutos é um
-- robô, e o WhatsApp lê isso em minutos. Um teto por rodada não resolve: o cron roda a
-- cada minuto e "5 por rodada" vira 300 por hora. Guardando o INSTANTE do próximo envio
-- permitido, com um intervalo sorteado a cada vez, o ritmo fica irregular como o de
-- gente — e é irregularidade, não lentidão, o que o outro lado procura.
--
-- O intervalo vive no código (`lib/agente/ritmoWhatsapp.ts`), não aqui: é regra de
-- operação e vai ser calibrada com o número na mão.
--
-- Roda depois de 0001-0116. Idempotente. Non-breaking: sem ninguém ligar a fila, o
-- comportamento de hoje (envio de WhatsApp só no clique) continua idêntico.
-- ============================================================

-- ---------- workspace ----------
alter table public.tenants add column if not exists fila_wa_automatica boolean not null default false;
alter table public.tenants add column if not exists fila_wa_auto_em    timestamptz;
alter table public.tenants add column if not exists fila_wa_proximo_em timestamptz;

comment on column public.tenants.fila_wa_automatica is
  'true = o cron /api/cron/fila-wa pode disparar os toques de WhatsApp vencidos deste workspace, respeitando janela, cap diário, jitter e saúde do chip. Nasce false: envio automático de WhatsApp é a função de maior risco do sistema.';
comment on column public.tenants.fila_wa_proximo_em is
  'Instante em que o próximo disparo automático pode sair. Reescrito com intervalo SORTEADO a cada envio — é o que dá ritmo humano à fila. Enquanto now() < este valor, o cron não manda nada.';

create index if not exists tenants_fila_wa_idx
  on public.tenants (fila_wa_auto_em nulls first)
  where fila_wa_automatica;

-- ---------- chip ----------
alter table public.whatsapp_accounts add column if not exists papel           text not null default 'principal';
alter table public.whatsapp_accounts add column if not exists aquecido        boolean not null default false;
alter table public.whatsapp_accounts add column if not exists falhas_seguidas integer not null default 0;
alter table public.whatsapp_accounts add column if not exists pausado_em      timestamptz;
alter table public.whatsapp_accounts add column if not exists pausa_motivo    text;

alter table public.whatsapp_accounts drop constraint if exists whatsapp_accounts_papel_ck;
alter table public.whatsapp_accounts
  add constraint whatsapp_accounts_papel_ck
  check (papel in ('principal', 'conversa', 'frio'));

-- `principal` como padrão é deliberado: é o papel mais PROTEGIDO. Um chip que ninguém
-- classificou tem que herdar a regra mais cuidadosa, não a mais permissiva — o default
-- é o que vale para quem nunca abriu a tela.
comment on column public.whatsapp_accounts.papel is
  'principal = a linha do negócio, nunca usada para toque frio; conversa = responde quem já respondeu; frio = dedicado a primeiro toque, descartável. Default principal: chip não classificado herda a regra mais protegida.';
comment on column public.whatsapp_accounts.aquecido is
  'Marcado À MÃO depois de 2-4 semanas de uso real. O app não tem como medir isto — e fingir que mede é pior que perguntar.';
comment on column public.whatsapp_accounts.falhas_seguidas is
  'Falhas de envio consecutivas. Zera a cada sucesso. Chegando ao teto, o chip se pausa sozinho: melhor perder um dia de fila do que o número.';
comment on column public.whatsapp_accounts.pausado_em is
  'Quando o chip parou de aceitar fila automática (null = liberado). Pausa não desliga o número: responder à mão continua funcionando.';

-- O cron varre por aqui: chips liberados, do mais antigo para o mais novo.
create index if not exists whatsapp_accounts_fila_idx
  on public.whatsapp_accounts (tenant_id, is_active, pausado_em);
