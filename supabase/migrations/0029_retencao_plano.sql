-- ============================================================
-- Contatia — Migration 0029 (Retenção fixa por plano)
-- A retenção de arquivos passa a ser POLÍTICA DO PLANO (não editável pelo cliente).
-- O tenant herda file_retention_months do plano. Roda depois de 0001-0028.
-- ============================================================

-- 1) retenção definida no plano
alter table public.platform_plans add column if not exists file_retention_months int not null default 6;

update public.platform_plans set file_retention_months = 3  where name = 'Essencial';
update public.platform_plans set file_retention_months = 6  where name = 'Profissional';
update public.platform_plans set file_retention_months = 12 where name = 'Time';

-- 2) sincroniza a retenção do tenant a partir do plano (quando o tenant tem plano definido)
update public.tenants t
set file_retention_months = p.file_retention_months
from public.platform_plans p
where t.plan_id = p.id;

-- 3) trigger: sempre que o plano do tenant mudar, herda a retenção do plano
create or replace function public.sync_tenant_retention() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan_id is not null then
    select file_retention_months into new.file_retention_months
    from public.platform_plans where id = new.plan_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_tenant_retention on public.tenants;
create trigger trg_sync_tenant_retention
  before insert or update of plan_id on public.tenants
  for each row execute function public.sync_tenant_retention();

-- ============================================================
-- Efeito: o cliente NÃO edita mais a retenção; ela vem do plano. O app mostra a política
-- (só leitura) e avisa quando um arquivo está próximo de expirar. O cron continua expurgando
-- pelos meses de file_retention_months do tenant (agora herdado do plano).
-- ============================================================
