-- ============================================================
-- Contatia — Migration 0084 (Automações: escopo por PRODUTO + novos gatilhos)
-- Roda depois de 0001-0083. Non-breaking (só adiciona colunas opcionais).
--
-- POR QUÊ: um mesmo lead pode ser trabalhado para VÁRIOS produtos. Regras de
-- tempo (ex.: "sem atividade há X dias", "terminou a cadência") precisam olhar
-- para a atividade NAQUELE produto, não a atividade global do contato. E o
-- usuário quer encadear cadências: terminou a cadência A → em N dias, entra na
-- cadência B (recuperação). Estas colunas suportam isso.
-- ============================================================

-- Escopo opcional por produto. NULL = regra geral (qualquer produto).
alter table public.automations add column if not exists product_id uuid references public.products(id) on delete cascade;

-- Cadência de ORIGEM do gatilho "cadence_completed" (qual cadência ao terminar
-- dispara a regra). NULL = qualquer cadência (respeitando product_id, se houver).
alter table public.automations add column if not exists source_seq uuid references public.sequences(id) on delete set null;

-- Tag da ação "add_tag" (aplicar uma tag ao contato).
alter table public.automations add column if not exists action_tag uuid references public.tags(id) on delete set null;

create index if not exists automations_product_idx on public.automations(product_id);
create index if not exists automations_source_seq_idx on public.automations(source_seq);

-- ============================================================
-- NOVOS GATILHOS (trigger_type é TEXT — não precisa alterar enum):
--   cadence_completed   — terminou uma cadência e ficou trigger_value DIAS sem
--                         novas ações (no produto/na cadência de origem) → age.
--   opportunity_lost    — oportunidade [do produto] perdida há trigger_value dias.
--   opportunity_won     — oportunidade [do produto] ganha há trigger_value dias
--                         (cross-sell: inscrever em cadência de OUTRO produto).
--   no_activity_days    — agora com product_id opcional: "sem atividade NAQUELE
--                         produto há X dias" (não a atividade global).
-- NOVA AÇÃO:
--   add_tag             — aplica action_tag ao contato.
-- ============================================================
