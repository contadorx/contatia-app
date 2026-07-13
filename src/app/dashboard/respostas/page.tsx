import { createClient } from "@/lib/supabase/server";
import RespostasInbox, { type Thread } from "@/components/RespostasInbox";

export const dynamic = "force-dynamic";

export default async function Respostas() {
  const supabase = createClient();

  const { data: tenant } = await supabase.from("tenants").select("whatsapp_mode").maybeSingle();
  const canReply = (((tenant as any)?.whatsapp_mode as string) || "assistido") === "evolution";

  const { data: msgs } = await supabase
    .from("whatsapp_messages")
    .select("id, contact_id, phone, direction, text, media_type, read_at, created_at, contacts(name)")
    .order("created_at", { ascending: false })
    .limit(1000);

  // agrupa em conversas por contato (ou por telefone, quando não há contato)
  const map = new Map<string, Thread>();
  for (const m of ((msgs as any[]) || []).slice().reverse()) {
    const key = m.contact_id ? `c:${m.contact_id}` : `p:${m.phone || "?"}`;
    let th = map.get(key);
    if (!th) {
      th = {
        key,
        contactId: m.contact_id || null,
        name: m.contacts?.name || m.phone || "Número desconhecido",
        phone: m.phone || "",
        messages: [],
        unread: 0,
        lastAt: m.created_at,
      };
      map.set(key, th);
    }
    th.messages.push({ id: m.id, direction: m.direction, text: m.text || "", mediaType: m.media_type || null, created_at: m.created_at, read: !!m.read_at });
    if (!th.phone && m.phone) th.phone = m.phone;
    if (m.direction === "in" && !m.read_at) th.unread++;
    th.lastAt = m.created_at;
  }

  const threads = Array.from(map.values()).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Respostas</h1>
      <p className="mt-1 text-sm text-subtle">
        Tudo que chega pelo WhatsApp fica aqui — não precisa mais abrir o celular para ler o que o lead respondeu.
      </p>
      <div className="mt-6">
        <RespostasInbox threads={threads} canReply={canReply} />
      </div>
    </div>
  );
}
