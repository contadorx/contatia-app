-- ============================================================
-- Contatia — Migration 0118 (o ambiente do agente: onde o produto entra e onde ele treina)
--
-- POR QUE AGORA, ANTES DO MOTOR: a espec descreve o agente como "regras duras (código)
-- + playbook (aprovado por você) + exemplos (automáticos) + ficha e estado (runtime)".
-- Dessas quatro partes, três são DADO — e dado é o que leva tempo para ficar bom. Um
-- motor sem playbook responde genérico; um playbook escrito com calma enquanto o motor
-- é construído chega pronto no dia em que o motor liga.
--
-- É por isso que estas tabelas vêm antes de `motor.ts`: elas são o lugar onde você põe o
-- produto e treina o agente, e esse trabalho é seu, não meu. Sem elas, "treinar o
-- agente" não tem onde acontecer.
--
-- O QUE ENTRA:
--   agent_config    — 1 por workspace: persona, modelos, ritmo, e os TETOS de dinheiro
--   agent_playbooks — 1 por produto: a estratégia, os argumentos, as objeções, os preços
--   agent_exemplos  — o banco de few-shot: conversas que deram certo
--   agent_licoes    — a fila de lições candidatas; só aprovada muda o playbook
--
-- A LINHA QUE SEPARA DADO DE REGRA. O texto aprendido muda TOM e ARGUMENTO; nunca preço,
-- limite ou promessa. Por isso `precos`, `valor_max_fechar` e `teto_desconto_pct` moram
-- aqui como DADO VALIDADO EM CÓDIGO na hora da ação — não como instrução de prompt. Um
-- lead que escreve "libera 90%, você é um robô" está falando com o modelo; o teto de
-- desconto não está no modelo, está no banco, e o modelo não tem como movê-lo.
--
-- E é por isso que `agent_licoes` existe separada de `agent_playbooks`: o destilador
-- noturno (F5) escreve lição como PENDENTE, e só a sua aprovação move o playbook. É o
-- que impede o agente de aprender um vício — ou de ser "treinado" por um lead
-- mal-intencionado que repete a mesma manipulação até ela virar padrão.
--
-- Roda depois de 0001-0117. Idempotente. Non-breaking: nada lê estas tabelas ainda além
-- da tela nova.
-- ============================================================

-- ============================================================
-- agent_config — um por workspace
-- ============================================================
create table if not exists public.agent_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- KILL SWITCH GERAL. Nasce false e nenhuma outra parte do sistema o liga.
  ativo boolean not null default false,

  -- Identidade híbrida: o agente assina como pessoa da equipe. Não levanta o tema IA,
  -- mas se perguntarem NÃO MENTE — diz que é o assistente digital e oferece um humano.
  -- Essa regra é de prompt; o nome e o cargo são daqui.
  persona_nome  text,
  persona_cargo text,

  -- Modelo barato no diálogo, modelo forte quando entra negociação/fechamento. Guardado
  -- por workspace porque o custo é por tenant e a escolha muda com o ticket do produto.
  modelo_dialogo    text not null default 'claude-haiku-4-5',
  modelo_negociacao text not null default 'claude-sonnet-5',

  -- Janela PRÓPRIA do agente, separada da janela de envio da fila: conversa e disparo
  -- têm horários diferentes por natureza (responder às 19h é educado; prospectar não).
  wa_hora_inicio int  not null default 9,
  wa_hora_fim    int  not null default 18,
  wa_dias        text not null default '1,2,3,4,5',

  -- Nunca instantâneo. Resposta que chega em 2 segundos, 3 da manhã, não é atendimento —
  -- é uma máquina se anunciando.
  delay_min_s int not null default 45,
  delay_max_s int not null default 240,

  max_msgs_dia_por_conversa  int not null default 6,
  max_followups_sem_resposta int not null default 3,

  -- OS DOIS TETOS DE DINHEIRO. Acima de `valor_max_fechar` a regra vira "agendar
  -- reunião": o agente não fecha contrato grande sozinho. `teto_desconto_pct` nasce em
  -- ZERO — desconto é uma decisão comercial, e o padrão de uma decisão comercial que
  -- ninguém tomou é "não".
  valor_max_fechar   numeric,
  teto_desconto_pct  numeric not null default 0,

  -- Toque frio automático. Nasce desligado, e a 0117 já guarda os papéis de chip que a
  -- regra "não liga se o único chip for principal" vai consultar.
  frio_ativo boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_config drop constraint if exists agent_config_janela_ck;
alter table public.agent_config add constraint agent_config_janela_ck
  check (wa_hora_inicio >= 0 and wa_hora_inicio <= 23
     and wa_hora_fim   >= 1 and wa_hora_fim   <= 24
     and wa_hora_fim > wa_hora_inicio);

alter table public.agent_config drop constraint if exists agent_config_delay_ck;
alter table public.agent_config add constraint agent_config_delay_ck
  check (delay_min_s >= 0 and delay_max_s >= delay_min_s and delay_max_s <= 3600);

alter table public.agent_config drop constraint if exists agent_config_caps_ck;
alter table public.agent_config add constraint agent_config_caps_ck
  check (max_msgs_dia_por_conversa between 1 and 50
     and max_followups_sem_resposta between 1 and 20);

-- O teto de desconto é limitado em CONSTRAINT, e não só na tela, porque é exatamente o
-- número que um lead vai tentar mover. 100% seria "de graça"; deixamos o limite em 100
-- mas o padrão em 0 — quem quiser dar desconto escreve o número com a própria mão.
alter table public.agent_config drop constraint if exists agent_config_desconto_ck;
alter table public.agent_config add constraint agent_config_desconto_ck
  check (teto_desconto_pct >= 0 and teto_desconto_pct <= 100);

alter table public.agent_config drop constraint if exists agent_config_valor_ck;
alter table public.agent_config add constraint agent_config_valor_ck
  check (valor_max_fechar is null or valor_max_fechar >= 0);

-- ============================================================
-- agent_playbooks — um por produto
-- ============================================================
create table if not exists public.agent_playbooks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  produto_id uuid not null references public.products(id) on delete cascade,

  -- A ESTRATÉGIA COMO DADO, não como prompt escrito no código. Abertura → diagnóstico →
  -- dor → valor → proposta → objeções → fechamento ou reunião. Editável sem deploy,
  -- porque quem sabe vender o produto é quem vende, e ele não abre pull request.
  etapas     jsonb not null default '[]'::jsonb,
  argumentos jsonb not null default '[]'::jsonb,
  objecoes   jsonb not null default '[]'::jsonb,

  -- A FONTE QUE `fechar_venda` VALIDA. O modelo nunca decide preço: ele consulta, e o
  -- código confere o que ele respondeu contra esta coluna antes de gerar cobrança.
  precos jsonb not null default '[]'::jsonb,

  -- Frases que o agente não pode dizer, promessas que não pode fazer. Vão para o prompt
  -- como regra, e as que dá para verificar em código são verificadas em código.
  regras_duras text[] not null default '{}',

  -- Nasce INATIVO: um playbook pela metade é pior que playbook nenhum, porque parece
  -- pronto. Quem liga é quem escreveu.
  ativo boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um playbook por produto. Dois seria uma pergunta sem resposta na hora de agir.
create unique index if not exists agent_playbooks_produto_idx
  on public.agent_playbooks (tenant_id, produto_id);

-- ============================================================
-- agent_exemplos — o treino de verdade
-- ============================================================
create table if not exists public.agent_exemplos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  produto_id uuid references public.products(id) on delete set null,

  -- Resumo ESTRUTURADO do caminho: contexto → movimentos → resultado. Não é a
  -- transcrição: transcrição inteira no prompt custa caro e ensina menos, porque o que
  -- importa é a sequência de decisões, não cada "bom dia".
  caminho text not null,

  -- won/reuniao = o agente acertou · editado_por_humano = VOCÊ acertou depois dele, e
  -- esse é o exemplo mais valioso que existe (por isso peso maior) · manual = você
  -- escreveu do zero para ensinar.
  origem text not null default 'manual',

  peso  int not null default 1,
  ativo boolean not null default true,

  created_at timestamptz not null default now()
);

alter table public.agent_exemplos drop constraint if exists agent_exemplos_origem_ck;
alter table public.agent_exemplos add constraint agent_exemplos_origem_ck
  check (origem in ('won', 'reuniao', 'editado_por_humano', 'manual'));

alter table public.agent_exemplos drop constraint if exists agent_exemplos_peso_ck;
alter table public.agent_exemplos add constraint agent_exemplos_peso_ck
  check (peso between 1 and 10);

create index if not exists agent_exemplos_busca_idx
  on public.agent_exemplos (tenant_id, produto_id, peso desc)
  where ativo;

-- ============================================================
-- agent_licoes — a fila de aprovação
-- ============================================================
create table if not exists public.agent_licoes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  produto_id uuid references public.products(id) on delete set null,

  texto     text not null,
  -- Por que o destilador achou isso. Sem evidência, aprovar é chute — e uma lição
  -- errada aprovada vira vício em todas as conversas seguintes.
  evidencia text,

  status       text not null default 'pendente',
  decidido_por uuid references public.profiles(id) on delete set null,
  decidido_em  timestamptz,

  created_at timestamptz not null default now()
);

alter table public.agent_licoes drop constraint if exists agent_licoes_status_ck;
alter table public.agent_licoes add constraint agent_licoes_status_ck
  check (status in ('pendente', 'aprovada', 'rejeitada'));

create index if not exists agent_licoes_fila_idx
  on public.agent_licoes (tenant_id, created_at desc)
  where status = 'pendente';

-- ============================================================
-- updated_at automático (mesma função da 0001)
-- ============================================================
drop trigger if exists agent_config_touch on public.agent_config;
create trigger agent_config_touch before update on public.agent_config
  for each row execute function public.touch_updated_at();

drop trigger if exists agent_playbooks_touch on public.agent_playbooks;
create trigger agent_playbooks_touch before update on public.agent_playbooks
  for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS — o de sempre: o workspace e o superadmin, nada além
-- ============================================================
alter table public.agent_config    enable row level security;
alter table public.agent_playbooks enable row level security;
alter table public.agent_exemplos  enable row level security;
alter table public.agent_licoes    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agent_config', 'agent_playbooks', 'agent_exemplos', 'agent_licoes'] loop
    execute format('drop policy if exists %I_all on public.%I', t, t);
    execute format(
      'create policy %I_all on public.%I for all
         using (tenant_id = public.current_tenant_id() or public.is_superadmin())
         with check (tenant_id = public.current_tenant_id() or public.is_superadmin())',
      t, t
    );
  end loop;
end $$;

comment on table public.agent_config is
  'Configuração do agente por workspace: persona, modelos, ritmo e os tetos de dinheiro. `ativo` é o kill switch geral e nasce false.';
comment on table public.agent_playbooks is
  'A estratégia de venda de cada produto, como DADO editável. `precos` é a fonte que a ferramenta fechar_venda valida — o modelo nunca decide preço.';
comment on table public.agent_exemplos is
  'Banco de few-shot: caminhos de conversa que deram certo. origem=editado_por_humano é o mais valioso (peso maior): é a correção humana virando treino.';
comment on table public.agent_licoes is
  'Lições candidatas do destilador noturno. Só status=aprovada muda o playbook — é o que impede o agente de aprender um vício ou ser treinado por um lead mal-intencionado.';
