import { createClient } from "@/lib/supabase/server";
import ContactTools from "@/components/ContactTools";
import ContactsTable from "@/components/ContactsTable";

export const dynamic = "force-dynamic";

export default async function Contatos() {
  const supabase = createClient();

  const [{ data: contacts }, { data: sequences }, { data: members }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, email, phone, company, origin, status, score, assigned_to, created_at")
      .order("score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("sequences").select("id, name").eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
  ]);

  const seqs = (sequences as { id: string; name: string }[]) || [];
  const memberList = (members as { id: string; full_name: string | null; email: string }[]) || [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Contatos</h1>
      <p className="mt-1 text-sm text-subtle">Sua base de prospecção e relacionamento. Selecione vários para inscrever ou atribuir em lote.</p>

      <div className="mt-6">
        <ContactTools />
      </div>

      <div className="mt-6">
        <ContactsTable contacts={(contacts as any[]) || []} sequences={seqs} members={memberList} />
      </div>
    </div>
  );
}
