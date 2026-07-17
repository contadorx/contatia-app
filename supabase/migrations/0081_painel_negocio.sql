-- ============================================================
-- Contatia — Migration 0081 (Painel do negócio: réguas editáveis, e-mails, feedback)
--
-- 1) business_messages: os textos das RÉGUAS, editáveis no painel (antes fixos no
--    código). track 'comunicacao' (ciclo de vida) e 'cobranca' (dunning).
-- 2) business_message_sends: dedup de envio por (tenant, key).
-- 3) email_log: registro do que a plataforma enviou (Central de E-mails).
-- 4) feedback: NPS/coleta do cliente.
-- Tudo restrito a superadmin; escrita do sistema via service role. Idempotente.
-- Tokens nos textos: {{ola}} (Olá, Nome!) e {{app}} (URL do app).
-- ============================================================

create table if not exists public.business_messages (
  key          text primary key,
  track        text not null check (track in ('comunicacao','cobranca')),
  label        text not null,
  enabled      boolean not null default true,
  trigger_days int not null default 0,   -- comunicacao: idade; cobranca: dias de atraso
  subject      text not null default '',
  body         text not null default '',
  sort         int not null default 0,
  updated_at   timestamptz not null default now()
);

create table if not exists public.business_message_sends (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  key        text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table if not exists public.email_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid references public.tenants(id) on delete set null,
  to_email   text,
  subject    text,
  kind       text,                 -- 'comunicacao' | 'cobranca' | 'suporte' | 'vendas' | 'outro'
  status     text not null default 'sent',   -- 'sent' | 'error'
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists email_log_idx on public.email_log(created_at desc);
create index if not exists email_log_kind_idx on public.email_log(kind, created_at desc);

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references public.tenants(id) on delete set null,
  user_id    uuid,
  score      int not null check (score between 0 and 10),
  comment    text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_idx on public.feedback(created_at desc);

-- RLS
alter table public.business_messages       enable row level security;
alter table public.business_message_sends  enable row level security;
alter table public.email_log               enable row level security;
alter table public.feedback                enable row level security;

drop policy if exists bmsg_admin on public.business_messages;
create policy bmsg_admin on public.business_messages for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin));

drop policy if exists elog_admin on public.email_log;
create policy elog_admin on public.email_log for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin));

-- feedback: o cliente insere o próprio; superadmin lê tudo.
drop policy if exists fb_insert on public.feedback;
create policy fb_insert on public.feedback for insert to authenticated with check (true);
drop policy if exists fb_admin_read on public.feedback;
create policy fb_admin_read on public.feedback for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin));

-- ============================================================
-- SEED — RÉGUA DE COMUNICAÇÃO (ciclo de vida) — os textos que já rodavam
-- ============================================================
insert into public.business_messages (key, track, label, trigger_days, sort, subject, body) values
('life_welcome','comunicacao','Boas-vindas (na entrada)',0,1,
 'Bem-vindo à Contatia 🚀',
 E'{{ola}}\n\nQue bom ter você na Contatia. Ela foi feita para uma coisa: transformar prospecção em reunião, com cadência e método — sem virar uma planilha caótica.\n\nPrimeiro passo (2 minutos): conecte sua caixa de e-mail para começar a disparar cadências.\n{{app}}/dashboard/config\n\nQualquer dúvida, é só responder este e-mail ou clicar no botão de ajuda (?) dentro do sistema.\n\nEquipe Contatia'),
('life_onboard_email','comunicacao','Onboarding — conectar e-mail (D+1, sem caixa)',1,2,
 'Falta 1 passo para você começar a prospectar',
 E'{{ola}}\n\nVi que você ainda não conectou uma caixa de e-mail. É por ali que a Contatia dispara suas cadências — e leva só 2 minutos.\n\nConectar agora:\n{{app}}/dashboard/config\n\nDica: ao conectar, a Contatia já ativa o "Envio Seguro" (aquecimento automático) para proteger a reputação do seu domínio desde o primeiro dia.\n\nEquipe Contatia'),
('life_onboard_cadence','comunicacao','Onboarding — primeira cadência (D+3, sem cadência)',3,3,
 'Sua caixa está pronta. Que tal a primeira cadência?',
 E'{{ola}}\n\nCaixa conectada, ótimo! Agora o coração da Contatia: crie sua primeira cadência (a sequência de toques que transforma um contato frio em reunião).\n\nCriar cadência:\n{{app}}/dashboard/cadencias\n\nComece simples: e-mail no dia 0, um follow-up no dia 3, um toque de WhatsApp no dia 6. O método importa mais que o volume.\n\nEquipe Contatia'),
('life_reengage','comunicacao','Reengajamento (D+14, parado)',14,4,
 'Podemos ajudar a destravar sua prospecção?',
 E'{{ola}}\n\nNotamos que faz um tempo desde sua última atividade na Contatia. Prospecção trava por muitos motivos — e a gente quer ajudar a destravar.\n\nSe faltou tempo para configurar, responda este e-mail dizendo onde você parou. Se foi alguma dúvida, o botão de ajuda (?) dentro do sistema tem respostas rápidas.\n\nSeu pipeline está esperando:\n{{app}}/dashboard\n\nEquipe Contatia')
on conflict (key) do nothing;

-- ============================================================
-- SEED — RÉGUA DE COBRANÇA (dunning) — D+1 lembrete, D+5 aviso, D+10 suspensão
-- ============================================================
insert into public.business_messages (key, track, label, trigger_days, sort, subject, body) values
('dun_d1','cobranca','Lembrete (D+1 de atraso)',1,1,
 'Sua fatura da Contatia venceu — vamos resolver?',
 E'{{ola}}\n\nNotamos que a fatura da sua assinatura da Contatia venceu. Pode ser só um detalhe do cartão ou do boleto.\n\nRegularize em 1 minuto:\n{{app}}/dashboard/planos\n\nSe já pagou, pode ignorar este e-mail. Qualquer coisa, responda aqui que a gente ajuda.\n\nEquipe Contatia'),
('dun_d5','cobranca','Aviso — acesso em risco (D+5)',5,2,
 'Aviso: seu acesso à Contatia está em risco',
 E'{{ola}}\n\nSua fatura segue em aberto há alguns dias. Para não interromper suas cadências e perder o ritmo da prospecção, regularize o pagamento:\n{{app}}/dashboard/planos\n\nSe houver qualquer problema com a cobrança, responda este e-mail — a gente resolve junto.\n\nEquipe Contatia'),
('dun_d10','cobranca','Suspensão (D+10)',10,3,
 'Sua conta na Contatia foi suspensa',
 E'{{ola}}\n\nComo a fatura permaneceu em aberto, sua conta foi suspensa temporariamente. Seus dados estão seguros — nada foi apagado.\n\nPara reativar na hora, basta regularizar o pagamento:\n{{app}}/dashboard/planos\n\nAssim que o pagamento for confirmado, seu acesso volta automaticamente. Precisa de ajuda? Responda este e-mail.\n\nEquipe Contatia')
on conflict (key) do nothing;
