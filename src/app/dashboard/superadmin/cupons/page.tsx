import { createClient } from "@/lib/supabase/server";
import CouponManager from "@/components/CouponManager";

export const dynamic = "force-dynamic";

export default async function CuponsSuperadmin() {
  const supabase = createClient();

  // gate: só superadmin
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(me as any)?.is_superadmin) {
    return <p className="text-sm text-subtle">Acesso restrito.</p>;
  }

  const { data: coupons } = await supabase
    .from("platform_coupons")
    .select("id, code, percent_off, duration_months, max_redemptions, redeemed_count, is_active, expires_at")
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl font-bold">Cupons</h1>
      <p className="mt-1 mb-6 text-sm text-subtle">
        Descontos aplicáveis no checkout. Com “meses” definido, o desconto reverte sozinho ao preço cheio depois do prazo.
      </p>
      <CouponManager coupons={(coupons as any[]) || []} />
    </div>
  );
}
