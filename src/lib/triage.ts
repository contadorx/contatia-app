import "server-only";
import { classifyReply } from "@/lib/replyIntent";

// Cria/atualiza o item de TRIAGEM da resposta de um contato conhecido.
// Mantém no máximo 1 pendente por contato (o índice único garante) — o texto/intenção
// novo atualiza o item aberto em vez de empilhar. Nunca quebra o fluxo do chamador.
export async function upsertReplyTriage(
  db: any,
  input: { tenantId: string; contactId: string; channel: "whatsapp" | "email"; text?: string | null }
) {
  try {
    if (!input.contactId) return;
    // contato suprimido não precisa de triagem (já saiu de tudo)
    const { data: c } = await db.from("contacts").select("opted_out").eq("id", input.contactId).maybeSingle();
    if ((c as any)?.opted_out) return;

    const intent = classifyReply(input.text);
    const text = (input.text || "").slice(0, 500);

    const { data: aberto } = await db
      .from("reply_triage")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("contact_id", input.contactId)
      .eq("status", "pending")
      .maybeSingle();

    if (aberto) {
      await db.from("reply_triage").update({ channel: input.channel, text, intent }).eq("id", (aberto as any).id);
    } else {
      await db.from("reply_triage").insert({
        tenant_id: input.tenantId,
        contact_id: input.contactId,
        channel: input.channel,
        text,
        intent,
        status: "pending",
      });
    }
  } catch {
    /* triagem nunca deve quebrar a captura da resposta */
  }
}
