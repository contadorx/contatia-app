-- ============================================================
-- Contatia — Migration 0070 (Índices únicos de integridade) — M1, M3, M11
--
-- Fecha três bugs de "checa-depois-insere" que geram duplicatas sob corrida:
--   M1  enrollments  — dupla inscrição do mesmo contato na mesma cadência
--   M3  platform_invoices — fatura duplicada (action + webhook correndo juntos)
--   M11 accounts     — empresa duplicada pelo mesmo CNPJ
--
-- Cada bloco DEDUPLICA o que já existe ANTES de criar o índice único (senão a criação
-- falharia em base com duplicatas). Idempotente. Roda depois das anteriores.
-- ============================================================

-- ---------- M1: no máx. UMA inscrição ativa/pausada por (contato, cadência) ----------
with ranked as (
  select id, row_number() over (
           partition by contact_id, sequence_id
           order by started_at asc, id asc
         ) as rn
    from public.enrollments
   where status in ('active', 'paused')
)
update public.enrollments e
   set status = 'stopped'
  from ranked r
 where e.id = r.id and r.rn > 1;

create unique index if not exists enrollments_ativa_uniq
  on public.enrollments (contact_id, sequence_id)
  where status in ('active', 'paused');

-- ---------- M3: no máx. UMA fatura por cobrança do Asaas ----------
with ranked as (
  select id, row_number() over (
           partition by asaas_payment_id
           order by created_at asc, id asc
         ) as rn
    from public.platform_invoices
   where asaas_payment_id is not null
)
delete from public.platform_invoices p
 using ranked r
 where p.id = r.id and r.rn > 1;

-- índice único SIMPLES (não parcial): o Postgres trata NULLs como distintos, então
-- várias faturas sem asaas_payment_id convivem, e o ON CONFLICT (asaas_payment_id) do
-- upsert consegue inferir este índice como árbitro.
create unique index if not exists platform_invoices_asaas_uniq
  on public.platform_invoices (asaas_payment_id);

-- ---------- M11: no máx. UMA empresa por (tenant, CNPJ) ----------
-- Repointa os filhos das duplicatas para a empresa sobrevivente (menor id) e apaga as
-- extras, para então poder criar o índice único.
create temporary table _acc_map on commit drop as
  select a.id as dup_id, k.keep_id
    from public.accounts a
    join (
      select tenant_id, cnpj, min(id) as keep_id
        from public.accounts
       where cnpj is not null and cnpj <> ''
       group by tenant_id, cnpj
    ) k on a.tenant_id = k.tenant_id and a.cnpj = k.cnpj
   where a.id <> k.keep_id;

update public.contacts c      set account_id = m.keep_id from _acc_map m where c.account_id = m.dup_id;
update public.opportunities o set account_id = m.keep_id from _acc_map m where o.account_id = m.dup_id;
update public.events ev       set account_id = m.keep_id from _acc_map m where ev.account_id = m.dup_id;

-- account_tags tem PK (account_id, tag_id): remove o que colidiria, depois repointa.
delete from public.account_tags t
 using _acc_map m
 where t.account_id = m.dup_id
   and exists (select 1 from public.account_tags k where k.account_id = m.keep_id and k.tag_id = t.tag_id);
update public.account_tags t set account_id = m.keep_id from _acc_map m where t.account_id = m.dup_id;

delete from public.accounts a using _acc_map m where a.id = m.dup_id;

create unique index if not exists accounts_tenant_cnpj_uniq
  on public.accounts (tenant_id, cnpj)
  where cnpj is not null and cnpj <> '';
