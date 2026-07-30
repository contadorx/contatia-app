import { createClient } from "@/lib/supabase/server";
import { receitaConfigurada } from "@/lib/receita";
import { workerConfigurado } from "@/lib/emailFinder";
import ProspectarWizard from "@/components/ProspectarWizard";

export const dynamic = "force-dynamic";
// O passo 4 raspa sites e testa SMTP em lote — precisa do teto de 60s da função.
export const maxDuration = 60;

export default async function Prospectar() {
  const supabase = createClient();

  // O que já está ligado muda o texto de cada passo — em vez de prometer o que não
  // vai acontecer, a tela avisa antes o que está desligado e o que fazer.
  const { data: tenant } = await supabase.from("tenants").select("whatsapp_mode").maybeSingle();
  const { data: waAcc } = await supabase
    .from("whatsapp_accounts")
    .select("id, status")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const { data: seqs } = await supabase
    .from("sequences")
    .select("id, name")
    .order("created_at", { ascending: false })
    .limit(100);

  const waPronto = (tenant as any)?.whatsapp_mode === "evolution" && !!waAcc;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Prospectar</h1>
      <p className="mt-1 max-w-3xl text-sm text-subtle">
        O caminho inteiro numa tela: <b>achar a empresa</b> na base da Receita → <b>gravar empresa + sócios</b> já
        enriquecidos → <b>descobrir e-mail e WhatsApp</b> → <b>inscrever numa cadência</b>. Cada passo só libera o
        seguinte, e nada roda escondido: você vê o que foi encontrado e o que ficou na fila.
      </p>

      <ProspectarWizard
        receitaOk={receitaConfigurada()}
        workerOk={workerConfigurado()}
        waPronto={waPronto}
        sequences={((seqs as any[]) || []).map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
