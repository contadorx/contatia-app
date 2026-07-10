-- ============================================================
-- Contatia — Migration 0037 (Link de gravação da reunião)
-- Campo para colar o link da gravação (Loom, Meet, Zoom, YouTube, etc.).
-- Roda após 0001-0036. Non-breaking.
-- ============================================================

alter table public.meetings add column if not exists recording_url text;

-- ============================================================
-- FLUXO: o Meet já é criado automaticamente no evento do Google Calendar. Após a reunião,
-- o usuário cola o link da gravação (Loom/Meet/Zoom) na tela de detalhe. Fica registrado
-- no histórico da reunião — útil para revisar, compartilhar com a equipe e dar contexto
-- ao próximo toque da cadência.
-- ============================================================
