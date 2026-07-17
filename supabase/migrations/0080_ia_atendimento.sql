-- ============================================================
-- Contatia — Migration 0080 (IA de atendimento: Suporte + Vendas)
--
-- Duas IAs de 1ª camada, comandadas por prompt editável no painel:
--   support → dentro do app (cliente logado); escala virando support_ticket.
--   sales   → pública, no site; escala virando um lead (conversa com contato).
-- Ambas: log de conversa, aviso por e-mail + badge no painel, guardas de custo.
--
-- Escrita das conversas é feita pelo app com service role; leitura/gestão é
-- restrita a superadmin. Idempotente, non-breaking.
-- ============================================================

-- CONFIG das duas IAs (o "cérebro" e o comportamento — editável no painel)
create table if not exists public.ai_assistants (
  kind         text primary key check (kind in ('support','sales')),
  enabled      boolean not null default true,
  model        text,                        -- null = usa env ANTHROPIC_CHAT_MODEL
  greeting     text not null default '',
  brain        text not null default '',    -- persona + conhecimento base (system)
  notify_email text,                         -- pra onde avisar (null = fallback env/owner)
  updated_at   timestamptz not null default now()
);

-- CONVERSAS
create table if not exists public.ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('support','sales')),
  tenant_id     uuid references public.tenants(id) on delete set null, -- suporte: do cliente; vendas: null
  visitor_name  text,
  visitor_email text,
  visitor_phone text,
  status        text not null default 'active' check (status in ('active','escalated','resolved')),
  handled       boolean not null default false,   -- você já deu o retorno?
  source        text,                              -- 'app' | 'site'
  ticket_id     uuid references public.support_tickets(id) on delete set null,
  msg_count     int not null default 0,
  created_at    timestamptz not null default now(),
  last_at       timestamptz not null default now()
);
create index if not exists ai_conv_kind_idx on public.ai_conversations(kind, status, handled, last_at desc);

create table if not exists public.ai_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists ai_msg_conv_idx on public.ai_messages(conversation_id, created_at);

-- RLS: só superadmin lê/gerencia; a escrita do app usa service role (bypassa RLS).
alter table public.ai_assistants   enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages     enable row level security;

drop policy if exists ai_assistants_admin on public.ai_assistants;
create policy ai_assistants_admin on public.ai_assistants for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin));

drop policy if exists ai_conv_admin on public.ai_conversations;
create policy ai_conv_admin on public.ai_conversations for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin));

drop policy if exists ai_msg_admin on public.ai_messages;
create policy ai_msg_admin on public.ai_messages for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin));

-- SEED — cérebros iniciais (edite no painel /dashboard/superadmin/ia)
insert into public.ai_assistants (kind, enabled, greeting, brain) values
(
  'support', true,
  'Oi! Sou a assistente do Contatia. Posso ajudar com cadência, e-mail, WhatsApp, Radar da Receita, pipeline e configuração. Qual é a sua dúvida?',
  'Você é a assistente de SUPORTE do Contatia — uma ferramenta de prospecção B2B (cadência multicanal de e-mail e WhatsApp, pipeline, Radar de CNPJs da Receita, IA que monta cadência, agendamento). Fale em português do Brasil, com tom prestativo e direto. Responda SOMENTE com base na Base de Conhecimento fornecida e no funcionamento do produto; NUNCA invente passos, preços ou políticas. Se não tiver certeza, se o problema for uma conta específica (cobrança, bug, dado do cliente) ou se a pessoa pedir um humano, PEÇA o nome e o melhor contato (e-mail ou WhatsApp) e encerre encaminhando para o time.'
),
(
  'sales', true,
  'Oi! Posso te explicar como o Contatia funciona e ajudar a escolher o plano. Me conta: o que você vende e como prospecta hoje?',
  E'Você é a assistente de VENDAS do Contatia. Fale em português do Brasil, consultiva e sem pressão — valor primeiro, nunca venda dura. O Contatia é a máquina de prospecção B2B: cadência multicanal (e-mail + WhatsApp), pipeline, fila "quem precisa de você hoje", Radar de CNPJs da Receita, IA que monta a cadência, WhatsApp com captura de resposta, agendamento e propostas rastreadas.\n\nPLANOS (todos com tudo + IA inclusa):\n- Individual: R$ 127/mês, 1 usuário.\n- Equipes: R$ 147/assento/mês, mínimo 3 assentos, com gestão de time (papéis, dashboard, roteamento, múltiplas caixas).\nCobrança por usuário, nunca por lead. Teste grátis sem cartão. Pagamento via Asaas.\n\nFORMAÇÃO CONTATIA (curso, à parte): R$ 397 ou 12× R$ 39, com 1 mês do Contatia incluso.\n\nREGRAS: não invente números nem prometa o que não está aqui. Se a pessoa demonstrar interesse real, tiver uma dúvida que você não resolve, ou pedir para falar com alguém, PEÇA o nome e o melhor contato (e-mail ou WhatsApp) para o time dar sequência e fechar.'
)
on conflict (kind) do nothing;
