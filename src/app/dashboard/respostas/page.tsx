import { createClient } from "@/lib/supabase/server";
import RespostasInbox, { type Thread } from "@/components/RespostasInbox";

export const dynamic = "force-dynamic";

export default async function Respostas() {
  const supabase = createClient();

  const { data: tenant } = await supabase.from("tenants").select("whatsapp_mode").maybeSingle();
  const canReply = (((tenant as any)?.whatsapp_mode as string) || "assistido") === "evolution";

  const [{ data: msgs }, { data: emails }] = await Promise.all([
    supabase
      .from("whatsapp_messages")
      .select("id, contact_id, phone, direction, text, media_type, read_at, created_at, contacts(name)")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("email_messages")
      .select("id, contact_id, email, direction, subject, text, read_at, created_at, contacts(name)")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const map = new Map<string, Thread>();

  // conversas de WHATSAPP (por contato, ou por telefone quando não há contato)
  for (const m of ((msgs as any[]) || []).slice().reverse()) {
    const key = m.contact_id ? `w:c:${m.contact_id}` : `w:p:${m.phone || "?"}`;
    let th = map.get(key);
    if (!th) {
      th = { key, channel: "whatsapp", contactId: m.contact_id || null, name: m.contacts?.name || m.phone || "Número desconhecido", phone: m.phone || "", messages: [], unread: 0, lastAt: m.created_at };
      map.set(key, th);
    }
    th.messages.push({ id: m.id, direction: m.direction, text: m.text || "", mediaType: m.media_type || null, created_at: m.created_at, read: !!m.read_at });
    if (!th.phone && m.phone) th.phone = m.phone;
    if (m.direction === "in" && !m.read_at) th.unread++;
    th.lastAt = m.created_at;
  }

  // conversas de E-MAIL (por contato, ou por endereço quando não há contato)
  for (const m of ((emails as any[]) || []).slice().reverse()) {
    const key = m.contact_id ? `e:c:${m.contact_id}` : `e:a:${(m.email || "?").toLowerCase()}`;
    let th = map.get(key);
    if (!th) {
      th = { key, channel: "email", contactId: m.contact_id || null, name: m.contacts?.name || m.email || "E-mail desconhecido", phone: "", email: m.email || "", messages: [], unread: 0, lastAt: m.created_at };
      map.set(key, th);
    }
    if (m.subject) th.subject = m.subject; // guarda o assunto mais recente
    if (!th.email && m.email) th.email = m.email;
    th.messages.push({ id: m.id, direction: m.direction, text: m.text || (m.subject ? `(assunto) ${m.subject}` : ""), mediaType: null, created_at: m.created_at, read: !!m.read_at });
    if (m.direction === "in" && !m.read_at) th.unread++;
    th.lastAt = m.created_at;
  }

  const threads = Array.from(map.values()).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Respostas</h1>
      <p className="mt-1 text-sm text-subtle">
        Caixa única das respostas dos leads — WhatsApp e e-mail no mesmo lugar. Não precisa abrir o celular nem a caixa de e-mail para ver o que responderam.
      </p>
      <div className="mt-6">
        <RespostasInbox threads={threads} canReply={canReply} />
      </div>
    </div>
  );
}
