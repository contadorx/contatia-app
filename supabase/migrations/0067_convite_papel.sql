-- ============================================================
-- Contatia — Migration 0067 (Papel escolhido no convite)
--
-- AUT-03: o convite não perguntava o papel — a pessoa entrava sempre como
-- vendedor e o texto ainda dizia outra coisa. Aqui: coluna team_role no convite
-- para o dono/gestor escolher o papel na hora de gerar o link; o aceite aplica
-- esse papel ao perfil.
--
-- Roda depois das anteriores. Idempotente. Non-breaking (default vendedor).
-- ============================================================

alter table public.tenant_invites
  add column if not exists team_role text
  check (team_role in ('admin', 'gestor', 'sdr', 'vendedor'));

update public.tenant_invites
  set team_role = 'vendedor'
  where team_role is null;
