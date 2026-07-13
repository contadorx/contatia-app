-- ============================================================
-- Contatia — Migration 0053 (WhatsApp: o NÍVEL é escolha do cliente)
--
-- O cliente escolhe entre TRÊS níveis de canal, por trade-off de risco:
--   'assistido' → link wa.me: a mensagem cai pronta na fila, o cliente clica e
--                 envia do PRÓPRIO WhatsApp. ZERO risco de bloqueio. É o default.
--   'evolution' → API NÃO-OFICIAL (Baileys): envia da fila e captura resposta,
--                 mas viola o ToS do WhatsApp e tem risco REAL de ban. Exige
--                 ACEITE de risco registrado (data + usuário) antes de ativar.
--   'meta'      → API OFICIAL da Meta (Cloud API): sem risco de ban. ROADMAP de
--                 produtização — ainda não disponível no app.
--
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

alter table public.tenants add column if not exists whatsapp_mode text not null default 'assistido';
alter table public.tenants add column if not exists whatsapp_risk_ack_at timestamptz;
alter table public.tenants add column if not exists whatsapp_risk_ack_by uuid;

-- Quem JÁ conectou uma instância antes desta migration escolheu o modo Evolution
-- conscientemente — preserva o comportamento atual (não tira o botão de envio dele)
-- e registra o aceite para não bloquear os envios em curso.
update public.tenants t
   set whatsapp_mode = 'evolution',
       whatsapp_risk_ack_at = coalesce(t.whatsapp_risk_ack_at, now())
 where exists (select 1 from public.whatsapp_accounts w where w.tenant_id = t.id);
