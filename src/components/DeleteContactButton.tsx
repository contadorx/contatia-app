"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteContact } from "@/app/dashboard/contatos/actions";

export default function DeleteContactButton({ contactId, name }: { contactId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function excluir() {
    if (!confirm(`Excluir o contato "${name}"? Isso não pode ser desfeito.`)) return;
    setErro(null);
    start(async () => {
      const r: any = await deleteContact(contactId);
      if (r?.error) { setErro(r.error); return; }
      router.push("/dashboard/contatos");
    });
  }

  return (
    <>
      <button className="text-xs text-subtle hover:text-red-600" onClick={excluir} disabled={pending}>
        {pending ? "Excluindo…" : "Excluir contato"}
      </button>
      {erro && <span className="ml-2 text-xs text-red-600">{erro}</span>}
    </>
  );
}
