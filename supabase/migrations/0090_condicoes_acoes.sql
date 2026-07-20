-- ============================================================
-- Contatia — Migration 0090 (Condições/guardas + ações — multi-produto)
--
-- Permite "quando o gatilho acontecer, E for deste produto / deste dono / com
-- esta tag, ENTÃO faça". As guardas são avaliadas ANTES da ação; se qualquer uma
-- falhar, a regra não dispara (e a avaliação segue para a próxima regra).
--
-- Guardas: product_id (já existe — contato ligado ao produto) · cond_owner_id
-- (contato deste responsável) · cond_has_tag / cond_not_tag · cond_state (já existe).
-- Ações novas: assign_owner (troca o dono) · set_product (troca o produto da
-- oportunidade aberta).
--
-- Roda depois de 0001-0089. Idempotente. Non-breaking.
-- ============================================================

alter table public.automations add column if not exists cond_owner_id  uuid references public.profiles(id) on delete set null;
alter table public.automations add column if not exists cond_has_tag   uuid references public.tags(id) on delete set null;
alter table public.automations add column if not exists cond_not_tag   uuid references public.tags(id) on delete set null;
alter table public.automations add column if not exists action_owner   uuid references public.profiles(id) on delete set null;
alter table public.automations add column if not exists action_product uuid references public.products(id) on delete set null;
