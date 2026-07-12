import { createClient } from "@/lib/supabase/server";
import type { Uso } from "@/components/UsageLimits";

// ============================================================
// Plano, features e limites — a fonte da verdade das telas.
// Durante o TRIAL tudo é liberado (o cliente precisa sentir o produto completo
// antes de escolher). Depois, o plano manda.
// ============================================================

/** O plano do workspace inclui esta feature? */
export async function hasFeature(feature: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("has_feature", { p_feature: feature });
  if (error) return true; // em caso de falha, não trava o cliente
  return !!data;
}

/** Uso × limites de todos os recursos. */
export async function getUsage(): Promise<Uso[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("usage_limits");
  if (error || !data) return [];
  return (data as any[]).map((u) => ({
    recurso: u.recurso,
    usado: Number(u.usado || 0),
    limite: u.limite ?? null,
    percentual: Number(u.percentual || 0),
    bloqueado: !!u.bloqueado,
    plano_atual: u.plano_atual || "—",
    plano_sugerido: u.plano_sugerido || "—",
  }));
}

/** Posso criar mais um? (chamar ANTES da ação) */
export async function canCreate(recurso: "contatos" | "cadencias" | "caixas" | "usuarios"): Promise<{
  permitido: boolean;
  usado: number;
  limite: number | null;
  sugerido: string;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("can_create", { p_recurso: recurso });
  const r = Array.isArray(data) ? data[0] : data;
  if (error || !r) return { permitido: true, usado: 0, limite: null, sugerido: "" };
  return {
    permitido: !!(r as any).permitido,
    usado: Number((r as any).usado || 0),
    limite: (r as any).limite ?? null,
    sugerido: (r as any).plano_sugerido || "",
  };
}

/** Mensagem padrão de bloqueio (usada nas actions). */
export function mensagemLimite(
  recurso: string,
  usado: number,
  limite: number | null,
  sugerido: string
): string {
  const nomes: Record<string, string> = {
    contatos: "contatos",
    cadencias: "cadências",
    caixas: "caixas de e-mail",
    usuarios: "usuários",
  };
  return `Seu plano permite ${limite} ${nomes[recurso] || recurso} e você já tem ${usado}. Para continuar, mude para o plano ${sugerido} em Planos.`;
}
