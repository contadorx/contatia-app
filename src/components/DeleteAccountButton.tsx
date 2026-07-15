"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAccountCompany } from "@/app/dashboard/contas/actions";

export default function DeleteAccountButton({ accountId, name }: { accountId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function excluir() {
    if (!confirm(`Excluir a empresa "${name}"? Os contatos e negócios dela NÃO são apagados — só desvinculados. Isso não pode ser desfeito.`)) return;
    setErro(null);
    start(async () => {
      const r: any = await deleteAccountCompany(accountId);
      if (r?.error) { setErro(r.error); return; }
      router.push("/dashboard/contas");
    });
  }

  return (
    <>
      <button className="text-xs text-subtle hover:text-red-600" onClick={excluir} disabled={pending}>
        {pending ? "Excluindo…" : "Excluir empresa"}
      </button>
      {erro && <span className="ml-2 text-xs text-red-600">{erro}</span>}
    </>
  );
}
