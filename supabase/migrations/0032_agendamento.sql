-- ============================================================
-- Contatia — Migration 0032 (Link público de agendamento)
-- Config de disponibilidade no tenant + origem pública da reunião.
-- Roda depois de 0001-0031. Non-breaking.
-- ============================================================

alter table public.tenants add column if not exists booking_enabled boolean default false;
alter table public.tenants add column if not exists booking_duration_min int default 30;
alter table public.tenants add column if not exists booking_days text default '1,2,3,4,5';  -- 0=dom..6=sáb
alter table public.tenants add column if not exists booking_start_hour int default 9;         -- hora local início (BRT)
alter table public.tenants add column if not exists booking_end_hour int default 18;          -- hora local fim
alter table public.tenants add column if not exists booking_title text;                        -- título padrão da reunião

-- marca reuniões vindas do link público
alter table public.meetings add column if not exists source text default 'manual';             -- manual | booking

-- ============================================================
-- FLUXO: o cliente ativa em Config→Agendamento (dias/horário/duração). A página pública
-- /agendar/[inbound_token] mostra os horários livres (respeitando reuniões já marcadas) e,
-- ao confirmar, cria o contato (se novo), a reunião (source='booking') e o evento no Google
-- Calendar (se a caixa Gmail estiver conectada). Reduz vai-e-vem e no-show.
-- ============================================================
