-- ============================================================
-- Contatia — Migration 0034 (Relatório por passo + A/B de assunto)
-- Liga a task ao passo da cadência (para medir conversão por passo) e adiciona a
-- variante B de assunto. Roda após 0001-0033. Non-breaking.
-- ============================================================

-- posição do passo que gerou a task (0-based, casa com sequence_steps.position)
alter table public.tasks add column if not exists step_position int;
-- qual variante de assunto foi usada nesta task: 'a' | 'b'
alter table public.tasks add column if not exists subject_variant text;

-- variante B do assunto (opcional) — quando preenchida, o envio sorteia A ou B
alter table public.sequence_steps add column if not exists subject_b text;

create index if not exists tasks_step_idx on public.tasks(enrollment_id, step_position);

-- ============================================================
-- FLUXO: ao inscrever um contato, cada task guarda a posição do passo. Se o passo tem
-- subject_b, sorteia A/B e grava subject_variant. O relatório da cadência cruza os eventos
-- (email_sent / email_opened / replied) por step_position para mostrar quantos enviados,
-- abertos e respondidos em cada passo — e, no passo com A/B, qual assunto converteu mais.
-- ============================================================
