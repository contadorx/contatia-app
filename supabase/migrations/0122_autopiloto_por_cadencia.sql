-- ============================================================
-- Contatia — Migration 0122 (o autopiloto: quem responde a cadência cai no agente)
--
-- O QUE FALTAVA: a espec pede, no F2, *"autopiloto em quem RESPONDE cadência"*. Estava
-- construída só a porta manual — o botão "Passar ao agente", uma conversa por vez. Isso
-- serve para calibrar e não escala: com 30 respostas por dia, alguém teria que clicar 30
-- vezes, e o agente que responde em 45 segundos esperaria horas por um clique.
--
-- POR QUE POR CADÊNCIA, E NÃO UMA CHAVE GERAL: a própria espec recomenda começar por uma
-- fatia — "1 cadência, 20–30 leads/dia, não na base inteira". Uma chave global obrigaria
-- a decisão a ser tudo-ou-nada justamente na semana em que ninguém ainda sabe se o
-- playbook está bom. Por cadência, ligar numa e observar é o caminho natural, e desligar
-- é local: uma cadência ruim não contamina as outras.
--
-- Nasce FALSE, como tudo que fala com o cliente do cliente sem ninguém olhando.
--
-- AS TRAVAS FICAM NO CÓDIGO (`lib/agente/autopiloto.ts`), não aqui, porque dependem do
-- estado no instante da resposta: agente ligado, playbook publicado, contato sem
-- opt-out, e — a mais sutil — ninguém tendo assumido a conversa à mão. Esta última
-- importa porque TODA conversa nasce com status 'humano': o que distingue "ninguém pegou
-- ainda" de "é minha, não encoste" é `assumida_por`.
--
-- Roda depois de 0001-0121. Idempotente. Non-breaking.
-- ============================================================

alter table public.sequences add column if not exists agente_autopiloto boolean not null default false;

comment on column public.sequences.agente_autopiloto is
  'true = quando um lead responder a esta cadencia pelo WhatsApp, a conversa passa para o agente automaticamente. Nasce false. Por cadencia, e nao global, para dar para ligar numa fatia e observar antes de ampliar.';

-- O webhook consulta por aqui, no caminho quente de toda resposta recebida.
create index if not exists sequences_autopiloto_idx
  on public.sequences (tenant_id)
  where agente_autopiloto;
