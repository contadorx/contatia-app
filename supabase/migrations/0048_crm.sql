-- ============================================================
-- Contatia — Migration 0048 (Integrações com CRM)
-- POSICIONAMENTO: o Contatia NÃO é um CRM — ele ALIMENTA o CRM do cliente.
-- Fluxo: prospecção (cadência → resposta → reunião) acontece aqui; quando o lead
-- esquenta, o negócio é EMPURRADO para o CRM do cliente. E o que muda lá (ganhou,
-- perdeu, etapa) volta para cá, para a cadência parar de perseguir quem já fechou.
--
-- Dois modos:
--   (a) webhook genérico  → dispara JSON para qualquer URL (Zapier, n8n, Make,
--       ERPs, qualquer CRM). Cobre TODO o mercado sem integração dedicada.
--   (b) pipedrive         → integração nativa (API token), push e pull.
-- Roda depois das anteriores. Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- Conexões de CRM por workspace
-- ------------------------------------------------------------
create table if not exists public.crm_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  provider      text not null,               -- 'webhook' | 'pipedrive'
  is_active     boolean not null default true,

  -- webhook genérico
  webhook_url   text,
  webhook_secret text,                       -- enviado no header X-Contatia-Signature

  -- pipedrive
  api_token     text,                        -- token pessoal da API
  company_domain text,                       -- ex.: minhaempresa (de minhaempresa.pipedrive.com)
  pipeline_id   text,                        -- funil de destino
  stage_id      text,                        -- etapa de entrada dos negócios criados

  -- comportamento
  push_on       text not null default 'replied',  -- 'replied' | 'meeting' | 'both'
  pull_enabled  boolean not null default true,    -- traz de volta ganho/perda/etapa
  last_pull_at  timestamptz,

  created_at    timestamptz not null default now()
);

create unique index if not exists crm_conn_tenant_provider_idx
  on public.crm_connections(tenant_id, provider);

-- ------------------------------------------------------------
-- Espelho: liga o registro daqui ao registro de lá (evita duplicar e permite o pull)
-- ------------------------------------------------------------
create table if not exists public.crm_links (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  connection_id  uuid not null references public.crm_connections(id) on delete cascade,
  entity         text not null,              -- 'contact' | 'opportunity'
  local_id       uuid not null,              -- id no Contatia
  remote_id      text not null,              -- id no CRM
  remote_status  text,                       -- último status conhecido lá
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create unique index if not exists crm_links_unique_local
  on public.crm_links(connection_id, entity, local_id);
create index if not exists crm_links_remote_idx
  on public.crm_links(connection_id, entity, remote_id);

-- ------------------------------------------------------------
-- Fila de sincronia (o cron processa; falhas ficam registradas e são retentadas)
-- ------------------------------------------------------------
create table if not exists public.crm_sync_queue (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  connection_id  uuid not null references public.crm_connections(id) on delete cascade,
  direction      text not null default 'push',   -- 'push' | 'pull'
  entity         text not null,                  -- 'contact' | 'opportunity'
  local_id       uuid,
  payload        jsonb,
  status         text not null default 'pending', -- 'pending' | 'done' | 'error'
  attempts       int not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  processed_at   timestamptz
);

create index if not exists crm_queue_pending_idx
  on public.crm_sync_queue(status, created_at) where status = 'pending';

-- ------------------------------------------------------------
-- RLS: tudo isolado por workspace (mesmo padrão do resto do app)
-- ------------------------------------------------------------
alter table public.crm_connections enable row level security;
alter table public.crm_links       enable row level security;
alter table public.crm_sync_queue  enable row level security;

drop policy if exists crm_conn_all on public.crm_connections;
create policy crm_conn_all on public.crm_connections for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists crm_links_all on public.crm_links;
create policy crm_links_all on public.crm_links for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists crm_queue_all on public.crm_sync_queue;
create policy crm_queue_all on public.crm_sync_queue for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ------------------------------------------------------------
-- GATILHO DE PUSH: quando um contato responde (status vira 'replied') ou uma
-- reunião é marcada, enfileira o envio para o CRM conectado.
-- ------------------------------------------------------------
create or replace function public.crm_enqueue_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_gatilho text;
begin
  -- qual evento disparou
  if tg_table_name = 'contacts' then
    v_gatilho := 'replied';
  else
    v_gatilho := 'meeting';
  end if;

  for c in
    select * from public.crm_connections
     where tenant_id = new.tenant_id
       and is_active
       and (push_on = v_gatilho or push_on = 'both')
  loop
    insert into public.crm_sync_queue (tenant_id, connection_id, direction, entity, local_id, payload)
    values (
      new.tenant_id, c.id, 'push',
      case when tg_table_name = 'contacts' then 'contact' else 'opportunity' end,
      new.id,
      jsonb_build_object('trigger', v_gatilho, 'table', tg_table_name)
    );
  end loop;

  return new;
end;
$$;

-- contato passou a 'replied' → empurra
drop trigger if exists crm_push_on_reply on public.contacts;
create trigger crm_push_on_reply
  after update of status on public.contacts
  for each row
  when (new.status = 'replied' and coalesce(old.status,'') <> 'replied')
  execute function public.crm_enqueue_push();

-- reunião criada → empurra
drop trigger if exists crm_push_on_meeting on public.meetings;
create trigger crm_push_on_meeting
  after insert on public.meetings
  for each row
  execute function public.crm_enqueue_push();

-- ============================================================
-- O cron (/api/cron/check-replies) processa a fila:
--   push → webhook (POST JSON assinado) ou Pipedrive (cria pessoa + negócio)
--   pull → Pipedrive: lê negócios ganhos/perdidos e encerra a cadência aqui
-- ============================================================
