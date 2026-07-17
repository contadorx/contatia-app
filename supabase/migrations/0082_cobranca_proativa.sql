-- ============================================================
-- Contatia — Migration 0082 (Régua de cobrança PRÓ-ATIVA)
--
-- Substitui a régua paga do Asaas: a Contatia passa a avisar a CRIAÇÃO da fatura
-- e a mandar PREVENTIVOS antes do vencimento (D-3, D-1), além do dunning pós-vencimento
-- (D+1, D+5, D+10, com suspensão automática). Baseada na FATURA (platform_invoices),
-- com link de pagamento, valor e vencimento nos e-mails.
--
-- Tokens: {{ola}} {{app}} {{link}} (pagamento) {{valor}} {{venc}}.
-- Idempotente. Reseta a track 'cobranca' para o conjunto novo.
-- ============================================================

-- dedup por FATURA (uma fatura tem sua própria sequência de avisos)
create table if not exists public.invoice_notice_sends (
  invoice_id uuid not null,
  key        text not null,
  created_at timestamptz not null default now(),
  primary key (invoice_id, key)
);
alter table public.invoice_notice_sends enable row level security;
drop policy if exists ins_admin on public.invoice_notice_sends;
create policy ins_admin on public.invoice_notice_sends for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin));

-- reseta a régua de cobrança para o conjunto pró-ativo
delete from public.business_messages where track = 'cobranca';

insert into public.business_messages (key, track, label, enabled, trigger_days, sort, subject, body) values
('bill_created','cobranca','Fatura criada (ao gerar)', true, 0, 1,
 'Sua fatura da Contatia está disponível',
 E'{{ola}}\n\nSua fatura da Contatia foi gerada.\n\nValor: {{valor}}\nVencimento: {{venc}}\n\nPague pelo link (Pix, boleto ou cartão):\n{{link}}\n\nQualquer dúvida, é só responder este e-mail.\n\nEquipe Contatia'),
('bill_pre3','cobranca','Preventivo — vence em 3 dias', true, -3, 2,
 'Lembrete: sua fatura da Contatia vence em 3 dias',
 E'{{ola}}\n\nPassando para lembrar que sua fatura da Contatia vence em breve.\n\nValor: {{valor}}\nVencimento: {{venc}}\n\nAdiante o pagamento e evite qualquer interrupção:\n{{link}}\n\nSe já pagou, pode ignorar. Equipe Contatia'),
('bill_pre1','cobranca','Preventivo — vence amanhã', true, -1, 3,
 'Sua fatura da Contatia vence amanhã',
 E'{{ola}}\n\nSua fatura vence amanhã ({{venc}}). Para manter suas cadências rodando sem interrupção, pague pelo link:\n{{link}}\n\nValor: {{valor}}\n\nSe já pagou, desconsidere. Equipe Contatia'),
('dun_d1','cobranca','Lembrete (D+1 de atraso)', true, 1, 4,
 'Sua fatura da Contatia venceu — vamos resolver?',
 E'{{ola}}\n\nNotamos que a fatura da sua assinatura venceu ({{venc}}). Pode ser só um detalhe do cartão ou do boleto.\n\nRegularize em 1 minuto:\n{{link}}\n\nValor: {{valor}}. Se já pagou, pode ignorar. Equipe Contatia'),
('dun_d5','cobranca','Aviso — acesso em risco (D+5)', true, 5, 5,
 'Aviso: seu acesso à Contatia está em risco',
 E'{{ola}}\n\nSua fatura segue em aberto há alguns dias. Para não interromper suas cadências e perder o ritmo da prospecção, regularize:\n{{link}}\n\nValor: {{valor}} · venceu em {{venc}}. Se houver problema com a cobrança, responda este e-mail. Equipe Contatia'),
('dun_d10','cobranca','Suspensão (D+10)', true, 10, 6,
 'Sua conta na Contatia foi suspensa',
 E'{{ola}}\n\nComo a fatura permaneceu em aberto, sua conta foi suspensa temporariamente. Seus dados estão seguros — nada foi apagado.\n\nReative na hora pagando o link:\n{{link}}\n\nAssim que o pagamento for confirmado, seu acesso volta automaticamente. Equipe Contatia')
on conflict (key) do update set
  track = excluded.track, label = excluded.label, trigger_days = excluded.trigger_days,
  sort = excluded.sort, subject = excluded.subject, body = excluded.body;
