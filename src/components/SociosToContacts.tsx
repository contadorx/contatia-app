"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarContatosDosSocios } from "@/app/dashboard/contas/actions";

// Botão: transforma os sócios enriquecidos em contatos vinculados à empresa.
export default function SociosToContacts({ accountId, total }: { accountId: string; total: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!total) return null;

  function criar() {
    setMsg(null); setErro(null);
    start(async () => {
      const r: any = await criarContatosDosSocios(accountId);
      if (r?.error) { setErro(r.error); return; }
      const partes = [`${r.criados} contato(s) de sócio criado(s)`];
      if (r.pulados) partes.push(`${r.pulados} já existia(m)`);
      setMsg(partes.join(" · ") + ".");
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <button className="btn-outline py-1 text-xs" onClick={criar} disabled={pending}>
        {pending ? "Criando…" : `+ Criar contatos dos sócios (${total})`}
      </button>
      {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
      {msg && <p className="mt-1 text-xs text-green-700">{msg}</p>}
    </div>
  );
}
