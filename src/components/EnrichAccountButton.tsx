"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrichAccount } from "@/app/dashboard/contas/actions";

// Puxa os dados públicos do CNPJ (CNAE, porte, município/UF, telefone) para a
// ficha da empresa — usando o CNPJ da própria empresa ou de um contato vinculado.
export default function EnrichAccountButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="btn-ghost py-1.5 text-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const res = (await enrichAccount(accountId)) as { ok?: boolean; error?: string };
            if (res?.error) setMsg(res.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Enriquecendo..." : "Enriquecer pelo CNPJ"}
      </button>
      {msg && <p className="max-w-xs text-right text-xs text-danger">{msg}</p>}
    </div>
  );
}
