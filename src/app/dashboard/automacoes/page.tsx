import { createClient } from "@/lib/supabase/server";
import AutomationsPanel from "@/components/AutomationsPanel";

export const dynamic = "force-dynamic";

export default async function Automacoes() {
  // Automações incluídas em TODOS os planos (Individual e Equipes) — sem gate.
  const supabase = createClient();

  const [{ data: automations }, { data: sequences }, { data: allSeqs }, { data: stages }, { data: logs }, { data: tags }, { data: products }, { data: allProducts }, { data: members }] = await Promise.all([
    // SEM embeds: automations tem DUAS FKs para sequences (action_seq e source_seq), o que
    // torna qualquer embed "sequences(...)" ambíguo e quebra a consulta inteira (lista vazia).
    // Buscamos as colunas cruas e resolvemos os nomes com mapas no painel — à prova de embed.
    supabase.from("automations").select("id, name, trigger_type, trigger_value, action_type, is_active, product_id, cond_state, set_state, action_seq, action_stage, source_seq, action_tag, cond_owner_id, cond_has_tag, cond_not_tag, action_owner, action_product, priority, stop_on_match, end_current").order("priority", { ascending: true }).order("created_at", { ascending: false }),
    supabase.from("sequences").select("id, name").eq("is_active", true),
    supabase.from("sequences").select("id, name"),
    supabase.from("pipeline_stages").select("id, name").order("position", { ascending: true }),
    supabase.from("automation_logs").select("detail, created_at, contacts(name)").order("created_at", { ascending: false }).limit(15),
    supabase.from("tags").select("id, name").order("name", { ascending: true }),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
    supabase.from("products").select("id, name"),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
  ]);

  const rules = (automations as any[]) || [];
  const logList = (logs as any[]) || [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Automações</h1>
      <p className="mt-1 text-sm text-subtle">Regras &ldquo;quando isso acontecer, faça aquilo&rdquo; — o contato reage sozinho ao comportamento.</p>

      <div className="mt-6">
        <AutomationsPanel
          rules={rules}
          sequences={(sequences as any[]) || []}
          allSeqs={(allSeqs as any[]) || []}
          stages={(stages as any[]) || []}
          tags={(tags as any[]) || []}
          products={(products as any[]) || []}
          allProducts={(allProducts as any[]) || []}
          members={(members as any[]) || []}
        />
      </div>

      {logList.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-display text-lg font-bold">Atividade recente</h2>
          <div className="card divide-y divide-line">
            {logList.map((l, i) => (
              <div key={i} className="flex items-center justify-between p-3 text-sm">
                <span>{l.contacts?.name || "Contato"} · <span className="text-subtle">{l.detail}</span></span>
                <span className="text-xs text-subtle">{new Date(l.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
