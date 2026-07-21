import { createClient } from "@/lib/supabase/server";
import CadenceStart from "@/components/CadenceStart";
import { SaveAsTemplateButton } from "@/components/TemplateGallery";
import EditSequenceButton from "@/components/EditSequenceButton";
import { CadenceReport } from "@/components/CadenceReport";
import { listTemplates } from "@/app/dashboard/cadencias/actions";
import { channelLabel, type Channel } from "@/lib/cadence";
import { isManager } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Cadencias() {
  const supabase = createClient();

  // Visibilidade por papel: Dono/Admin/Gestor veem as cadências de toda a equipe;
  // Vendedor/SDR veem só as que criaram (decisão do produto).
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles")
    .select("role, team_role")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const gerente = isManager((me as any)?.role, (me as any)?.team_role);

  let seqQuery = supabase
    .from("sequences")
    .select("id, name, audience, is_active, created_at, created_by, product_id, email_account_id, sequence_steps(channel, position), products(name), email_accounts(from_email)")
    .order("created_at", { ascending: false });
  if (!gerente) seqQuery = seqQuery.eq("created_by", user?.id ?? "");

  const [{ data: sequences }, { templates }, { data: products }, { data: accounts }] = await Promise.all([
    seqQuery,
    listTemplates(),
    supabase.from("products").select("id, name").eq("active", true).order("name", { ascending: true }),
    supabase.from("email_accounts").select("id, from_email, display_name").eq("is_active", true).order("created_at", { ascending: true }),
  ]);
  const productOpts = (products as any[]) || [];
  const accountOpts = (accounts as any[]) || [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Cadências</h1>
      <p className="mt-1 text-sm text-subtle">
        <b>Cadência</b> é a sua sequência de follow-ups multicanal (e-mail, WhatsApp, ligação, LinkedIn) — os toques
        entram sozinhos na fila do &ldquo;Hoje&rdquo;, no ritmo que você definir.
      </p>

      <div className="mt-6">
        <CadenceStart templates={(templates as any[]) || []} products={productOpts} accounts={accountOpts} />
      </div>

      <div className="mt-6 space-y-3">
        {!sequences?.length ? (
          <div className="card p-10 text-center text-sm text-subtle">
            Nenhuma cadência ainda. Crie a primeira acima — do zero, com IA, ou a partir de um template.
          </div>
        ) : (
          sequences.map((s0) => {
            const s = s0 as any;
            const steps = (s.sequence_steps as { channel: string; position: number }[]) || [];
            const prod = Array.isArray(s.products) ? s.products[0] : s.products;
            const box = Array.isArray(s.email_accounts) ? s.email_accounts[0] : s.email_accounts;
            return (
              <div key={s.id} className="card flex items-center justify-between p-5">
                <div>
                  <p className="font-display text-base font-bold">{s.name}</p>
                  <p className="mt-1 text-sm text-subtle">
                    {s.audience ? `${s.audience} · ` : ""}
                    {steps.length} passo(s):{" "}
                    {steps
                      .sort((a, b) => a.position - b.position)
                      .map((st) => channelLabel[st.channel as Channel])
                      .join(" → ")}
                  </p>
                  {(prod?.name || box?.from_email) && (
                    <p className="mt-1 text-xs text-subtle">
                      {prod?.name ? `Produto: ${prod.name}` : ""}
                      {box?.from_email ? `${prod?.name ? " · " : ""}Caixa: ${box.from_email}` : prod?.name ? " · Caixa do produto" : ""}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-3">
                    <EditSequenceButton sequenceId={s.id} products={productOpts} accounts={accountOpts} />
                    <span className="text-xs text-subtle">·</span>
                    <SaveAsTemplateButton sequenceId={s.id} />
                  </div>
                  <CadenceReport sequenceId={s.id} />
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    s.is_active ? "bg-signal/10 text-signal" : "bg-muted text-subtle"
                  }`}
                >
                  {s.is_active ? "Ativa" : "Inativa"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
