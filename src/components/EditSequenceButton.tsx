"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SequenceBuilder from "@/components/SequenceBuilder";
import { loadSequence, deleteSequence, type StepInput } from "@/app/dashboard/cadencias/actions";

type ProductOpt = { id: string; name: string };
type AccountOpt = { id: string; from_email: string; display_name?: string | null };

// Botão "editar" numa cadência salva → carrega os passos e abre o construtor
// em modo edição (mesma UI de criar). Ao salvar/fechar, recarrega a lista.
export default function EditSequenceButton({ sequenceId, products = [], accounts = [] }: { sequenceId: string; products?: ProductOpt[]; accounts?: AccountOpt[] }) {
  const router = useRouter();
  const [data, setData] = useState<{ name: string; audience: string; steps: StepInput[]; product_id: string; email_account_id: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (data) {
    return (
      <div className="mt-3">
        <SequenceBuilder
          autoOpen
          editId={sequenceId}
          initialName={data.name}
          initialAudience={data.audience}
          initialSteps={data.steps}
          initialProductId={data.product_id}
          initialEmailAccountId={data.email_account_id}
          products={products}
          accounts={accounts}
          onDone={() => { setData(null); router.refresh(); }}
        />
      </div>
    );
  }

  return (
    <span>
      <button
        className="text-xs text-subtle hover:text-brand"
        disabled={pending}
        title="Editar esta cadência"
        onClick={() => start(async () => {
          setMsg(null);
          const r = (await loadSequence(sequenceId)) as any;
          if (r?.error) setMsg(r.error);
          else setData({ name: r.name, audience: r.audience, steps: r.steps, product_id: r.product_id || "", email_account_id: r.email_account_id || "" });
        })}
      >
        {pending ? "abrindo..." : "editar"}
      </button>
      <button
        className="ml-2 text-xs text-subtle hover:text-red-600"
        disabled={pending}
        title="Excluir esta cadência"
        onClick={() => {
          if (!confirm("Excluir esta cadência? (bloqueado se houver contatos ativos nela)")) return;
          start(async () => {
            setMsg(null);
            const r = (await deleteSequence(sequenceId)) as any;
            if (r?.error) setMsg(r.error);
            else router.refresh();
          });
        }}
      >
        excluir
      </button>
      {msg && <span className="ml-2 text-xs text-danger">{msg}</span>}
    </span>
  );
}
