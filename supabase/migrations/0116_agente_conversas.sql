-- ============================================================
-- Contatia — Migration 0116 (o estado da conversa vira registro)
--
-- POR QUE: hoje o WhatsApp tem MENSAGENS (`whatsapp_messages`) e não tem CONVERSA. A
-- caixa de Respostas monta o fio na memória, a cada carregamento de página, agrupando
-- mensagens por contato. Isso serve para LER, e só. Não há onde escrever que esta
-- conversa está com você, que aquela já foi para reunião, que a outra levou três
-- follow-ups sem resposta. O estado existe na cabeça de quem atende — e some quando a
-- aba fecha.
--
-- Enquanto o atendimento é humano isso é um incômodo. Quando o agente entrar (F2), é
-- um impedimento: um motor que responde sozinho precisa saber, ANTES de falar, se
-- alguém assumiu esta conversa, quantas mensagens já saíram hoje e em que etapa da
-- estratégia ela está. Sem esse registro, o agente responde por cima do humano.
--
-- O QUE ENTRA: `agent_conversas` — uma linha por CONVERSA, não por mensagem.
--
-- A CHAVE É (workspace, chip, telefone), não (workspace, contato).
-- Duas razões:
--   1. Metade das conversas chega de número DESCONHECIDO — `whatsapp_messages.contact_id`
--      é nulo e continua nulo até alguém cadastrar. Chavear por contato jogaria fora
--      justamente as conversas novas, que são as que mais precisam de estado.
--   2. O mesmo lead falando com dois chips são duas conversas de verdade: históricos
--      diferentes, e quando um chip cair só as dele morrem. É o "contato × chip" da
--      espec, escrito do jeito que o dado permite.
-- Quando o contato é cadastrado depois, `contact_id` é preenchido na linha que já existe
-- (a conversa não recomeça).
--
-- STATUS NASCE 'humano' DE PROPÓSITO. Não existe agente ainda, e mesmo depois que
-- existir, entregar uma conversa viva a um robô é decisão de quem opera — nunca efeito
-- colateral de uma migration. Mesma regra do `fila_automatica` (0115) e do
-- `frio_ativo` da espec: o que fala com o cliente do cliente sem ninguém olhando se
-- liga por escolha explícita.
--
-- Roda depois de 0001-0115. Idempotente. Non-breaking: nada lê esta tabela ainda além
-- da tela nova; a caixa de Respostas segue funcionando exatamente como hoje.
-- ============================================================

create table if not exists public.agent_conversas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- o chip por onde a conversa corre. `set null` e não `cascade`: quando um chip cai
  -- (e cai — "chip de frio é consumível"), a conversa é justamente o que precisa
  -- sobreviver para alguém retomar de outro número.
  account_id  uuid references public.whatsapp_accounts(id) on delete set null,
  contact_id  uuid references public.contacts(id) on delete cascade,
  phone       text not null,

  status      text not null default 'humano',
  etapa_atual text,
  objetivo    text,

  -- Contexto compacto para o prompt do agente (F2). A transcrição inteira nunca entra:
  -- custa caro e piora a resposta. Nasce nulo — quem escreve aqui é o motor.
  resumo_rolante text,

  -- Teto de mensagens por dia (`max_msgs_dia_por_conversa`). O contador só faz sentido
  -- com a DATA junto: sem ela, "6 mensagens" seria um teto vitalício e a conversa
  -- morreria no sexto balão de todos os tempos. Quem lê compara `msgs_hoje_em` com hoje
  -- e trata data velha como zero.
  msgs_hoje      integer not null default 0,
  msgs_hoje_em   date,

  followups_sem_resposta integer not null default 0,
  desfecho    text,

  ultima_msg_em      timestamptz,
  ultima_msg_direcao text,

  -- Quando o LEAD falou pela última vez — e só ele. Diferente de `ultima_msg_em`, que
  -- anda também quando somos nós que mandamos. A distinção separa "conversa ativa" de
  -- "monólogo": três follow-ups nossos deixam `ultima_msg_em` recente e não mudam nada
  -- sobre o silêncio dele. É por aqui que o desfecho 'silencio' e a reativação de
  -- parados vão se decidir. Saudação de central automática NÃO conta como resposta.
  ultima_resposta_em timestamptz,

  -- Quem assumiu, e quando. Guardado na conversa (e não só no log) porque a tela
  -- precisa mostrar "com a Ana" sem varrer auditoria.
  assumida_por uuid references public.profiles(id) on delete set null,
  assumida_em  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- identidade da conversa ----------
-- `coalesce` no account_id em vez de "unique nulls not distinct": duas linhas com
-- account_id nulo são a MESMA conversa (mesmo telefone, chip não identificado), e o
-- unique comum deixaria as duas passarem, porque em SQL null nunca é igual a null.
-- Fazer por expressão funciona em qualquer versão do Postgres.
create unique index if not exists agent_conversas_chave_idx
  on public.agent_conversas (tenant_id, phone, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ordem da tela: a que falou por último primeiro
create index if not exists agent_conversas_recentes_idx
  on public.agent_conversas (tenant_id, ultima_msg_em desc nulls last);

-- filtro por estado (e o que o motor do F2 vai varrer)
create index if not exists agent_conversas_status_idx
  on public.agent_conversas (tenant_id, status);

create index if not exists agent_conversas_contato_idx
  on public.agent_conversas (tenant_id, contact_id);

-- ---------- valores permitidos ----------
-- Em constraint, não em prompt. Toda regra dura do agente mora no banco ou no código:
-- é o que impede um lead de "convencer" o modelo a inventar um estado novo.
alter table public.agent_conversas drop constraint if exists agent_conversas_status_ck;
alter table public.agent_conversas
  add constraint agent_conversas_status_ck
  check (status in ('agente', 'humano', 'sombra', 'pausada', 'encerrada'));

alter table public.agent_conversas drop constraint if exists agent_conversas_desfecho_ck;
alter table public.agent_conversas
  add constraint agent_conversas_desfecho_ck
  check (desfecho is null or desfecho in ('reuniao', 'venda', 'recusa', 'silencio', 'opt_out'));

alter table public.agent_conversas drop constraint if exists agent_conversas_direcao_ck;
alter table public.agent_conversas
  add constraint agent_conversas_direcao_ck
  check (ultima_msg_direcao is null or ultima_msg_direcao in ('in', 'out'));

-- ---------- updated_at automático (mesma função da 0001) ----------
drop trigger if exists agent_conversas_touch on public.agent_conversas;
create trigger agent_conversas_touch
  before update on public.agent_conversas
  for each row execute function public.touch_updated_at();

-- ---------- RLS ----------
alter table public.agent_conversas enable row level security;

-- Leitura e escrita ficam no workspace. O webhook não passa por aqui: ele usa o
-- admin client (service role) e carimba o tenant na mão — mesma lição do envioEmail.
drop policy if exists agent_conversas_select on public.agent_conversas;
create policy agent_conversas_select on public.agent_conversas for select
  using (tenant_id = public.current_tenant_id() or public.is_superadmin());

drop policy if exists agent_conversas_insert on public.agent_conversas;
create policy agent_conversas_insert on public.agent_conversas for insert
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

drop policy if exists agent_conversas_update on public.agent_conversas;
create policy agent_conversas_update on public.agent_conversas for update
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

-- Sem policy de DELETE de propósito: conversa se ENCERRA (status), não some. O que
-- apaga de verdade é a exclusão do contato ou do workspace, pelo cascade.

comment on table public.agent_conversas is
  'Estado de cada conversa de WhatsApp (workspace × chip × telefone). Guarda quem está conduzindo, em que etapa, quantas mensagens saíram hoje e como terminou. Base do agente (F2) e da tela Conversas.';
comment on column public.agent_conversas.status is
  'agente = o motor responde sozinho · humano = alguém assumiu (o agente cala) · sombra = o motor rascunha sem enviar · pausada = ninguém conduz · encerrada = acabou, ver desfecho.';
comment on column public.agent_conversas.msgs_hoje_em is
  'Dia a que se refere msgs_hoje. Data diferente de hoje = contador zerado (o teto é por dia, não vitalício).';
