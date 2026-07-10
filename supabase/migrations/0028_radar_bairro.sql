-- ============================================================
-- Contatia — Migration 0028 (Bairro + capital no Radar)
-- Roda depois de 0001-0027. Non-breaking.
-- ============================================================

alter table public.radar_leads add column if not exists bairro text;
alter table public.radar_leads add column if not exists is_capital boolean default false;

create index if not exists radar_bairro_idx on public.radar_leads(tenant_id, bairro);

-- ============================================================
-- O importador mapeia a coluna de bairro do CSV; a busca do Radar filtra por bairro
-- e por capital. is_capital pode vir do CSV ou ser derivado do município.
-- ============================================================
