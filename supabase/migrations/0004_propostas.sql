-- ============================================================
-- Contatia — Migration 0004 (Fase 3 · Propostas com tracking)
-- Documento como LINK externo (sem exigir Storage no MVP). O share já existe
-- (0002) com token + total_opens + first_open_at. Roda depois de 0001-0003.
-- ============================================================

alter table public.documents add column if not exists url text;

-- ============================================================
-- NOTA: o rastreio de abertura é feito por um endpoint PÚBLICO (/s/{token})
-- que roda com a SERVICE ROLE KEY (fora do RLS), pois o destinatário não tem
-- sessão. Configure SUPABASE_SERVICE_ROLE_KEY no ambiente (server-only, NUNCA
-- com prefixo NEXT_PUBLIC). Sem ela, o link de rastreio não resolve.
-- ============================================================
