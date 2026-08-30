-- ============================================================
-- Contatia — Migration 0119 (o turno do agente, e a testemunha)
--
-- A 0116 guardou o ESTADO da conversa. Falta o que faz o motor rodar: quando o próximo
-- turno vence, quem está processando ele agora, e o registro do que foi decidido.
--
-- O QUE ENTRA:
--
-- agent_conversas ganha:
--   due_at      → quando este turno pode ser processado (agora + jitter humanizado)
--   lock_em     → uma rodada pegou este turno às HH:MM. É o que impede duas respostas.
--   lock_por    → qual execução do cron pegou (para depurar lock preso)
--   turno_erros → falhas seguidas neste turno; no teto, para de tentar
--
-- agent_decisoes (nova) — cada turno: o que entrou, que ferramenta foi chamada, com que
--   argumentos, o que saiu, quantos tokens, e por quê.
--
-- POR QUE `lock_em` E NÃO "processando bool": um booleano trava para sempre quando a
-- rodada morre no meio — e a Vercel mata a função em 60s sem avisar. Com o INSTANTE,
-- um lock velho é lock morto: a rodada seguinte o ignora depois do prazo e assume o
-- turno. Um flag exigiria alguém para destravar; um timestamp se destrava sozinho.
--
-- POR QUE `agent_decisoes` NÃO É `action_log`: o action_log registra o que o OPERADOR
-- fez. Este registra o que o MODELO decidiu, e existe para responder três perguntas que
-- ninguém mais responde — "por que ele disse isso ao meu cliente?", "quanto custou?" e
-- "isso foi ele ou fui eu?". É a única testemunha de uma conversa que aconteceu sem
-- ninguém olhando, e é a base da cobrança por uso quando isso virar feature vendida.
--
-- Roda depois de 0001-0118. Idempotente. Non-breaking.
-- ============================================================

-- ---------- o turno ----------
alter table public.agent_conversas add column if not exists due_at      timestamptz;
alter table public.agent_conversas add column if not exists lock_em     timestamptz;
alter table public.agent_conversas add column if not exists lock_por    text;
alter table public.agent_conversas add column if not exists turno_erros integer not null default 0;

comment on column public.agent_conversas.due_at is
  'Quando o próximo turno pode ser processado. Nulo = não há turno pendente. O motor só olha para due_at <= agora — é aqui que mora o delay humanizado e a espera pela janela comercial.';
comment on column public.agent_conversas.lock_em is
  'Instante em que uma rodada assumiu este turno. Lock com mais de alguns minutos é lock morto (a função foi morta) e pode ser tomado. Timestamp e não booleano: um booleano preso exigiria alguém para destravar.';

-- A varredura do motor: quem tem turno vencido, do mais antigo para o mais novo. O
-- índice é PARCIAL porque a esmagadora maioria das conversas não tem turno pendente —
-- indexar todas seria pagar por linha que nunca é lida.
create index if not exists agent_conversas_turno_idx
  on public.agent_conversas (due_at)
  where due_at is not null;

-- ---------- a testemunha ----------
create table if not exists public.agent_decisoes (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  -- `set null` e não cascade: a decisão SOBREVIVE à conversa apagada. Um log que some
  -- junto com o que ele registra não é log.
  conversa_id uuid references public.agent_conversas(id) on delete set null,
  contact_id  uuid references public.contacts(id) on delete set null,

  entrada     text,          -- a mensagem do lead que provocou o turno
  ferramenta  text,          -- responder | agendar_reuniao | ... | (gatilho) | (erro)
  argumentos  jsonb not null default '{}'::jsonb,
  saida       text,          -- o que efetivamente foi enviado/feito
  motivo      text,          -- por que esta ação, em português

  modelo      text,
  tokens_in   integer,
  tokens_out  integer,
  ms          integer,       -- quanto o turno levou ponta a ponta

  -- Turno que falhou também é registro. Sem isto, "o agente não respondeu" não tem
  -- explicação em lugar nenhum.
  erro        text,

  created_at timestamptz not null default now()
);

create index if not exists agent_decisoes_tenant_idx
  on public.agent_decisoes (tenant_id, created_at desc);
create index if not exists agent_decisoes_conversa_idx
  on public.agent_decisoes (conversa_id, created_at desc);

alter table public.agent_decisoes enable row level security;

-- Só leitura e inserção, igual ao action_log: log não se reescreve. Sem policy de
-- update nem de delete, de propósito — nem o dono reescreve a trilha do que o agente
-- disse ao cliente dele.
drop policy if exists agent_decisoes_select on public.agent_decisoes;
create policy agent_decisoes_select on public.agent_decisoes for select
  using (tenant_id = public.current_tenant_id() or public.is_superadmin());

drop policy if exists agent_decisoes_insert on public.agent_decisoes;
create policy agent_decisoes_insert on public.agent_decisoes for insert
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

comment on table public.agent_decisoes is
  'Cada turno do agente: entrada, ferramenta chamada, argumentos, saída, tokens e motivo. Só INSERT e SELECT. É a única testemunha de uma conversa que aconteceu sem ninguém olhando — e a base da cobrança por uso.';
