-- ============================================================
-- Contatia — Migration 0062 (Gestão de mensagens do WhatsApp + mídia)
--
-- Adiciona à caixa de Respostas: bloqueio de número (LGPD/pessoal), e o registro
-- do TIPO de mídia recebida. O binário da mídia NÃO é guardado — é buscado sob
-- demanda no Evolution quando você abre a conversa (custo + LGPD).
--
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

-- tipo/mime da mídia recebida (image|audio|video|document|sticker)
alter table public.whatsapp_messages add column if not exists media_type text;
alter table public.whatsapp_messages add column if not exists media_mime text;

-- lista de bloqueio por número (o webhook ignora; e some da caixa)
create table if not exists public.whatsapp_blocklist (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  phone       text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, phone)
);

alter table public.whatsapp_blocklist enable row level security;
drop policy if exists wablock_all on public.whatsapp_blocklist;
create policy wablock_all on public.whatsapp_blocklist for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
