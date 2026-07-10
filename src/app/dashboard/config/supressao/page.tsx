import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SuppressionTools } from "@/components/SuppressionTools";

export const dynamic = "force-dynamic";

const REASON: Record<string, { l: string; c: string }> = {
  hard_bounce: { l: "Bounce definitivo", c: "bg-danger/10 text-danger" },
  complaint: { l: "Marcou como spam", c: "bg-danger/10 text-danger" },
  unsubscribe: { l: "Descadastrou", c: "bg-warn/10 text-warn" },
  invalid: { l: "Inválido", c: "bg-muted text-subtle" },
  manual: { l: "Manual", c: "bg-muted text-subtle" },
};

export default async function Supressao() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("email_suppressions")
    .select("id, email, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  const list = (rows as any[]) || [];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-subtle">
        <Link href="/dashboard/config" className="hover:text-ink">Configurações</Link>
        <span>/</span>
        <span className="text-ink">Lista de supressão</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold">Lista de supressão</h1>
      <p className="mt-1 text-sm text-subtle">E-mails que a Contatia <b>não</b> envia mais — bloqueados automaticamente quando devolvem (bounce), marcam como spam ou pedem descadastro. Isso protege a reputação do seu domínio e a entregabilidade da sua base.</p>

      <div className="mt-6">
        <SuppressionTools rows={list} reasonMap={REASON} />
      </div>
    </div>
  );
}
