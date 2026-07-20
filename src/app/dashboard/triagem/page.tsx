import { createClient } from "@/lib/supabase/server";
import TriageInbox from "@/components/TriageInbox";

export const dynamic = "force-dynamic";

export default async function Triagem() {
  const supabase = createClient();
  const [{ data: items }, { data: sequences }] = await Promise.all([
    supabase
      .from("reply_triage")
      .select("id, contact_id, channel, text, intent, created_at, contacts(name, phone, email)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("sequences").select("id, name").eq("is_active", true).order("created_at", { ascending: false }),
  ]);

  const list = ((items as any[]) || []).map((i) => ({
    id: i.id,
    contactId: i.contact_id,
    channel: i.channel,
    text: i.text || "",
    intent: i.intent,
    createdAt: i.created_at,
    name: i.contacts?.name || i.contacts?.phone || i.contacts?.email || "Contato",
  }));
  const seqs = ((sequences as any[]) || []).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl font-bold">Triagem de respostas</h1>
      <p className="mt-1 text-sm text-subtle">
        Quem respondeu cai aqui, já classificado. Você decide em 1 clique: suprimir, aprofundar numa cadência (encerrando a atual) ou anotar a retomada. A palavra-chave sugere — a decisão é sua.
      </p>
      <div className="mt-6">
        <TriageInbox items={list} sequences={seqs} />
      </div>
    </div>
  );
}
