-- ============================================================
-- Contatia — Migration 0088 (Dormente + Retomada — fecha a Fase 1 Quotaria)
--
-- Fecha o ciclo da máquina de estados:
--   • fim de cadência → estado 'dormente' (ação 'mark_state')
--   • dormente há 90 dias → cadência de retomada E (gatilho 'state_days')
--   • chegou a data anotada (retomar_em) → cadência C (gatilho 'date_reached')
--
-- Roda depois de 0001-0087. Idempotente. Non-breaking.
-- ============================================================

-- Estado exigido pelo gatilho 'state_days' (ex.: 'dormente' há N dias).
alter table public.automations add column if not exists cond_state text;

-- ============================================================
-- NOTAS (implementado no código, sem enum a alterar):
-- • Ação 'mark_state': só grava auto_state (via set_state) — para carimbar 'dormente'
--   no fim de uma cadência (gatilho cadence_completed, 0 dias).
-- • Gatilho 'state_days': contatos com auto_state = cond_state há >= trigger_value dias.
-- • Gatilho 'date_reached': contatos com contacts.retomar_em <= hoje; ao disparar,
--   limpa retomar_em (permite novo adiamento no futuro).
-- ============================================================
