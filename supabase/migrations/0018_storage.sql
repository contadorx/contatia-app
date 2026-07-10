-- ============================================================
-- Contatia — Migration 0018 (Upload de PDF via Supabase Storage)
-- Guarda o caminho do arquivo no bucket. Roda depois de 0001-0017. Non-breaking.
-- ============================================================

alter table public.documents add column if not exists storage_path text;

-- documents pode ser um LINK externo (url) OU um arquivo no Storage (storage_path).
-- A rota /s/{token} gera signed URL quando houver storage_path; senão redireciona à url.
