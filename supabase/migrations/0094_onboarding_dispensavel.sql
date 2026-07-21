-- ============================================================
-- Contatia — Migration 0094 (Onboarding dispensável)
--
-- O usuário pode dispensar a caixa "Primeiros passos" do Hoje ("não mostrar mais").
-- Persistido no PERFIL (por usuário, vale em qualquer dispositivo — não é cookie).
-- A caixa já some sozinha quando os 4 passos são concluídos; isto cobre quem
-- simplesmente não quer o roteiro.
--
-- Roda depois de 0001-0093. Idempotente. Non-breaking.
-- ============================================================

alter table public.profiles
  add column if not exists onboarding_hidden boolean not null default false;
