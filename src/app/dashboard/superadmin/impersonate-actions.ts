"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function startImpersonation(tenantId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = await supabase.from("profiles").select("is_superadmin").eq("id", user?.id ?? "").maybeSingle();
  if (!(prof as any)?.is_superadmin) return { error: "Apenas superadmin." };

  const { error } = await supabase.rpc("impersonate_start", { p_tenant: tenantId });
  if (error) return { error: error.message };

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

export async function stopImpersonation() {
  const supabase = createClient();
  await supabase.rpc("impersonate_stop");
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/superadmin");
}
