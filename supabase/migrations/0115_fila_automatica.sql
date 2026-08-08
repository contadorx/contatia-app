-- ============================================================
-- Contatia — Migration 0115 (a fila anda sozinha, com o navegador fechado)
--
-- POR QUE: a 0114 deu ritmo à fila (teto por hora + horário comercial) e a tela passou a
-- retomar sozinha quando a janela abre — mas só COM A ABA ABERTA. Isso resolve a tarde
-- de trabalho e não resolve o dia: quem tem 800 toques e 100/h precisa de 8 horas de
-- aba aberta, e ninguém deixa.
--
-- O QUE ENTRA:
--   tenants.fila_automatica  boolean → o cron pode enviar por este workspace
--   tenants.fila_auto_em     timestamptz → quando o cron passou por aqui pela última vez
--
-- `fila_auto_em` não é enfeite: é o que faz o cron ser JUSTO. Com vários workspaces e um
-- orçamento de 60 segundos por rodada, atender sempre na mesma ordem faria o último da
-- lista nunca ser atendido. Ordenando pelo mais antigo, todo mundo entra.
--
-- Nasce FALSE de propósito. Envio automático é a única função do sistema que fala com o
-- cliente do cliente sem ninguém olhando — isso se liga por escolha explícita, nunca por
-- migration.
-- ============================================================

alter table public.tenants add column if not exists fila_automatica boolean not null default false;
alter table public.tenants add column if not exists fila_auto_em timestamptz;

comment on column public.tenants.fila_automatica is
  'true = o cron /api/cron/fila-envio pode disparar os toques de e-mail vencidos deste workspace, respeitando horário comercial, teto por hora e limite diário.';
comment on column public.tenants.fila_auto_em is
  'Última passagem do cron da fila por este workspace. Usado para dar a vez a quem esperou mais.';

-- Ordem de atendimento do cron: quem está ligado, do mais antigo para o mais recente.
create index if not exists tenants_fila_auto_idx
  on public.tenants (fila_auto_em nulls first)
  where fila_automatica;
