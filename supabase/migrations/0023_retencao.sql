-- ============================================================
-- Contatia — Migration 0023 (Retenção/expurgo de arquivos)
-- Define por quanto tempo os PDFs de proposta ficam no Storage antes de expurgo.
-- Roda depois de 0001-0022. Non-breaking.
-- ============================================================

-- retenção em meses por workspace (0/null = nunca expurga)
alter table public.tenants add column if not exists file_retention_months int default 6;

-- ============================================================
-- O expurgo roda no cron diário: para cada documento com storage_path cujo
-- created_at ultrapassou a retenção do tenant, apaga o arquivo do bucket e limpa
-- o storage_path (mantém o registro do documento, sem o arquivo). LGPD + custo.
-- O delete manual (na tela Propostas) remove documento + arquivo na hora.
-- ============================================================
