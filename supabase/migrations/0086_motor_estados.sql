-- ============================================================
-- Contatia — Migration 0086 (Motor de estados — Fundação da Fase 1 Quotaria)
--
-- Evolui o motor de "lista de regras independentes" para uma MÁQUINA DE ESTADOS:
--   • prioridade + "parar no 1º match" (avaliação ordenada)
--   • transição limpa: inscrever ENCERRANDO a cadência atual
--   • estado único do contato (novo/em_P/em_A/.../dormente/suprimido/ativo)
--   • supressão permanente (o contato suprimido some de TODA automação)
--
-- Roda depois de 0001-0085. Idempotente. Non-breaking.
-- ============================================================

-- ---- Regras: ordenação e semântica de transição ----
alter table public.automations add column if not exists priority      int not null default 100;  -- menor = avaliada antes
alter table public.automations add column if not exists stop_on_match boolean not null default false; -- se disparar, para de avaliar as demais
alter table public.automations add column if not exists end_current   boolean not null default false; -- ao inscrever, encerra a cadência atual antes
alter table public.automations add column if not exists set_state     text;  -- estado a gravar no contato após a ação (opcional)
create index if not exists automations_priority_idx on public.automations(tenant_id, trigger_type, priority);

-- ---- Contato: estado da máquina + carimbo de quando entrou nele ----
-- (suprimido reaproveita contacts.opted_out como bloqueio duro; auto_state dá o rótulo)
alter table public.contacts add column if not exists auto_state    text;
alter table public.contacts add column if not exists auto_state_at timestamptz;
create index if not exists contacts_auto_state_idx on public.contacts(tenant_id, auto_state);

-- ============================================================
-- NOTAS:
-- • Nova AÇÃO 'suppress' (no código): encerra tudo, marca opted_out=true e
--   auto_state='suprimido'. A partir daí NENHUMA automação toca o contato.
-- • 'set_state' grava o rótulo do estado (ex.: 'em_A') para as guardas/relatórios
--   da Fase 2. A avaliação por prioridade + stop_on_match dá o "para no 1º match".
-- ============================================================
