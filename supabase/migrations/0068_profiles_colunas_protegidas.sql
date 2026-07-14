-- ============================================================
-- Contatia — Migration 0068 (Proteção de colunas privilegiadas em profiles) — CRÍTICA
--
-- BUG C1: a política profiles_update_self trava a LINHA (id = auth.uid()) mas não as
-- COLUNAS. Como o app usa a anon-key no navegador, qualquer usuário autenticado podia
-- rodar `update profiles set is_superadmin=true` (ou role/tenant_id) na própria linha e
-- escalar privilégio / pular de workspace — quebra total do isolamento multi-tenant.
--
-- CORREÇÃO: no Postgres, um GRANT de UPDATE em nível de TABELA cobre todas as colunas.
-- Aqui revogamos o UPDATE amplo de anon/authenticated e concedemos UPDATE APENAS nas
-- colunas seguras (full_name, email). As colunas sensíveis (role, team_role, tenant_id,
-- is_active, is_superadmin, impersonating_tenant_id, pre_impersonation_tenant_id) deixam
-- de ser graváveis pelo cliente do navegador.
--
-- Por que NÃO quebra os fluxos legítimos:
--  - accept_invite() é SECURITY DEFINER (roda como dono da função, com todos os
--    privilégios) → continua gravando tenant_id/role/is_active normalmente.
--  - setupWorkspace, syncTenantSeats, impersonação e a nova troca de papel usam o
--    admin client (service_role), que tem privilégios próprios e não é afetado.
--
-- Roda depois das anteriores. Idempotente. Segura para reaplicar.
-- ============================================================

-- 1) tira o UPDATE amplo (nível de tabela) das roles do cliente
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

-- 2) devolve UPDATE só nas colunas seguras (o usuário ainda edita o próprio nome/e-mail).
--    A RLS profiles_update_self continua limitando à própria linha.
grant update (full_name, email) on public.profiles to authenticated;

-- Observação: SELECT/INSERT/DELETE não são tocados. INSERT de perfil no cadastro é feito
-- por trigger/So RPC SECURITY DEFINER e pelo admin client, não pelo cliente do navegador.
