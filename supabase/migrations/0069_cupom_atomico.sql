-- ============================================================
-- Contatia — Migration 0069 (Resgate de cupom atômico)
--
-- BUG A6: o resgate era ler-e-gravar (redeemed_count + 1), sem atomicidade e sem
-- limite no WHERE → dois checkouts concorrentes furam o max_redemptions; e a troca de
-- plano reincrementava o mesmo cupom. Aqui: RPCs que fazem o incremento CONDICIONAL e
-- atômico (só se ainda houver vaga e o cupom estiver válido) e uma para liberar a
-- reserva se a assinatura falhar.
--
-- SECURITY DEFINER: platform_coupons é superadmin-only na RLS; estas funções rodam com
-- privilégio do dono e são a única porta de escrita do contador de resgates.
--
-- Roda depois das anteriores. Idempotente.
-- ============================================================

-- Reserva 1 resgate do cupom, de forma atômica. Devolve percent_off/duration_months
-- quando conseguiu; nenhuma linha quando o cupom é inválido/expirado/esgotado.
create or replace function public.redeem_coupon(p_code text)
returns table(percent_off int, duration_months int)
language sql security definer set search_path = public as $$
  update public.platform_coupons c
     set redeemed_count = coalesce(c.redeemed_count, 0) + 1
   where c.code = upper(p_code)
     and c.is_active = true
     and (c.expires_at is null or c.expires_at > now())
     and (c.max_redemptions is null or coalesce(c.redeemed_count, 0) < c.max_redemptions)
  returning c.percent_off, c.duration_months;
$$;

-- Libera (devolve) 1 resgate — usado se a assinatura falhar depois da reserva.
create or replace function public.release_coupon(p_code text)
returns void
language sql security definer set search_path = public as $$
  update public.platform_coupons c
     set redeemed_count = greatest(0, coalesce(c.redeemed_count, 0) - 1)
   where c.code = upper(p_code);
$$;

grant execute on function public.redeem_coupon(text) to authenticated, service_role;
grant execute on function public.release_coupon(text) to authenticated, service_role;
