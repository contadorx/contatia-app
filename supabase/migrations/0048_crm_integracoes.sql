-- ============================================================
-- Contatia — Migration 0048 (Integrações com CRMs de mercado)
-- POSICIONAMENTO: o Contatia NÃO é um CRM — ele é a camada de prospecção que
-- ALIMENTA o CRM que a empresa já usa. Quando o lead esquenta (responde, marca
-- reunião, vira oportunidade), o Contatia empurra para o Pipedrive/HubSpot/RD.
-- Isso mata a objeção "já tenho CRM" e transforma o concorrente em complemento.
-- Roda depois das anteriores. Idempotente.
-- ============================================================

create table if not exists public.crm_integrations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  provider      text not null,             -- 'pipedrive' | 'hubspot' | 'rdstation' | 'webhook'
  is_active     boolean not null default true,
  api_token     text,                      -- token/chave da API do CRM do cliente
  api_domain    text,                      -- ex.: subdomínio do Pipedrive (empresa.pipedrive.com)
  webhook_url   text,                      -- para provider='webhook' (Zapier, n8n, Make...)
  -- quando sincronizar (o lead "esquentou")
  on_reply      boolean not null default true,   -- respondeu à cadência
  on_meeting    boolean not null default true,   -- reunião marcada
  on_opportunity boolean not null default true,  -- virou oportunidade no pipeline
  on_new_contact boolean not null default false, -- todo contato novo (mais ruidoso)
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, provider)
);

alter table public.crm_integrations enable row level security;

drop policy if exists crm_int_all on public.crm_integrations;
create policy crm_int_all on public.crm_integrations for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ------------------------------------------------------------
-- Log de sincronização: o que foi enviado, quando, e se deu certo.
-- Evita reenvio duplicado (unique por contato+integração+gatilho).
-- ------------------------------------------------------------
create table if not exists public.crm_syncs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  integration_id  uuid not null references public.crm_integrations(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  trigger         text not null,           -- 'reply' | 'meeting' | 'opportunity' | 'new_contact'
  status          text not null default 'ok',   -- 'ok' | 'error'
  remote_id       text,                    -- id do registro criado no CRM
  error_message   text,
  created_at      timestamptz not null default now(),
  unique (integration_id, contact_id, trigger)
);

alter table public.crm_syncs enable row level security;

drop policy if exists crm_syncs_read on public.crm_syncs;
create policy crm_syncs_read on public.crm_syncs for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists crm_syncs_write on public.crm_syncs;
create policy crm_syncs_write on public.crm_syncs for insert
  with check (tenant_id = public.current_tenant_id());

create index if not exists crm_syncs_tenant_idx on public.crm_syncs(tenant_id, created_at desc);

-- ============================================================
-- COMO FUNCIONA NO APP:
-- src/lib/crm.ts → syncContactToCrm(tenantId, contactId, trigger)
--   1. busca integrações ativas do tenant que escutam aquele gatilho
--   2. monta o payload (nome, e-mail, telefone, empresa, CNPJ, origem, notas)
--   3. envia: Pipedrive (POST /persons + /deals), HubSpot (POST /crm/v3/objects/contacts),
--      RD Station (POST /platform/contacts), Webhook (POST no URL do cliente)
--   4. registra em crm_syncs (unique impede duplicar o mesmo contato/gatilho)
-- Chamado quando: resposta detectada (cron), reunião criada, oportunidade criada.
-- ============================================================
