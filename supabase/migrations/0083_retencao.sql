-- ============================================================
-- Contatia — Migration 0083 (Régua de retenção / arquivamento LGPD)
--
-- Depois da suspensão (D+10), o ciclo de retenção — sempre com porta de volta:
--   D+30 suspenso → e-mail "última chance" (com link de reativação).
--   D+60 suspenso → ARQUIVA a conta e APAGA os dados dos leads (LGPD), mas MANTÉM
--                   a conta e as faturas. Reativável: se voltar, é só reimportar.
-- Contagem a partir de suspended_at. Idempotente.
-- ============================================================

alter table public.tenants add column if not exists suspended_at timestamptz;
alter table public.tenants add column if not exists archived_at  timestamptz;

-- permite a track 'retencao' em business_messages
alter table public.business_messages drop constraint if exists business_messages_track_check;
alter table public.business_messages
  add constraint business_messages_track_check check (track in ('comunicacao','cobranca','retencao'));

-- mensagens da régua de retenção (trigger_days = dias DESDE a suspensão)
insert into public.business_messages (key, track, label, enabled, trigger_days, sort, subject, body) values
('ret_last_chance','retencao','Última chance (30 dias suspenso)', true, 30, 1,
 'Última chance de reativar sua conta na Contatia',
 E'{{ola}}\n\nSua conta está pausada há um tempo. Antes de arquivá-la, queríamos dar um último aviso: seus dados ainda estão aqui e é rápido voltar.\n\nReative agora:\n{{app}}/dashboard/planos\n\nSe não reativar, em cerca de 30 dias vamos arquivar a conta e remover os dados dos seus leads (por boa prática de privacidade). Sua conta e o histórico de faturas continuam guardados — e você pode voltar quando quiser.\n\nQualquer dúvida, é só responder este e-mail.\n\nEquipe Contatia'),
('ret_archived','retencao','Conta arquivada (60 dias suspenso)', true, 60, 2,
 'Sua conta na Contatia foi arquivada',
 E'{{ola}}\n\nComo sua conta ficou pausada por bastante tempo, ela foi arquivada e removemos os dados dos leads que estavam nela (boa prática de privacidade — LGPD).\n\nMas a porta continua aberta: sua conta e suas faturas seguem guardadas. Se quiser voltar, é só reativar e reimportar sua base — a gente te ajuda no que precisar.\n\nVoltar agora:\n{{app}}/dashboard/planos\n\nEquipe Contatia')
on conflict (key) do update set
  track = excluded.track, label = excluded.label, trigger_days = excluded.trigger_days,
  sort = excluded.sort, subject = excluded.subject, body = excluded.body;
