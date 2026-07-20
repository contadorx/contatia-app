-- ============================================================
-- Contatia — Migration 0087 (Triagem de respostas — Fase 1, Increment 2)
--
-- Toda resposta de um contato conhecido é CLASSIFICADA por palavra-chave
-- (parar / adiar / interesse / outro) e cai numa FILA DE DECISÃO. Você confirma
-- em 1 clique: suprimir, inscrever numa cadência (transição limpa) ou anotar a
-- retomada. Palavra-chave sugere; a decisão é humana (regra combinada).
--
-- Roda depois de 0001-0086. Idempotente. Non-breaking.
-- ============================================================

create table if not exists public.reply_triage (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  channel      text not null default 'whatsapp',   -- whatsapp | email
  text         text,
  intent       text not null default 'outro',       -- parar | adiar | interesse | outro
  status       text not null default 'pending',     -- pending | done | dismissed
  resolution   text,                                 -- o que você escolheu
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id) on delete set null
);
-- uma fila por contato: no máx. 1 item PENDENTE por contato (o novo texto atualiza o existente)
create unique index if not exists reply_triage_one_pending
  on public.reply_triage(tenant_id, contact_id) where status = 'pending';
create index if not exists reply_triage_tenant_idx on public.reply_triage(tenant_id, status, created_at desc);

alter table public.reply_triage enable row level security;
create policy reply_triage_all on public.reply_triage for all
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

-- Campo de data de retomada (usado ao "anotar retomada"); guardado no contato.
-- (Fica em coluna própria para a retomada agendada da Fase 2 poder consultá-la.)
alter table public.contacts add column if not exists retomar_em date;
create index if not exists contacts_retomar_em_idx on public.contacts(tenant_id, retomar_em);
