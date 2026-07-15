"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarContatosDosSocios, criarContatoSocio } from "@/app/dashboard/contas/actions";

// Sócios → contatos: um botão POR sócio (igual à ficha do contato) + "criar todos".
export default function SociosToContacts({ accountId, socios }: { accountId: string; socios: string[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendAll, startAll] = useTransition();
  const [pendOne, startOne] = useTransition();

  if (!socios?.length) return null;

  function um(nome: string) {
    setMsg(null); setErro(null);
    startOne(async () => {
      const r: any = await criarContatoSocio(accountId, nome);
      if (r?.error) { setErro(r.error); return; }
      setMsg(`Contato de ${nome} criado.`);
      router.refresh();
    });
  }
  function todos() {
    setMsg(null); setErro(null);
    startAll(async () => {
      const r: any = await criarContatosDosSocios(accountId);
      if (r?.error) { setErro(r.error); return; }
      const partes = [`${r.criados} contato(s) criado(s)`];
      if (r.pulados) partes.push(`${r.pulados} já existia(m)`);
      setMsg(partes.join(" · ") + ".");
      router.refresh();
    });
  }

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-2">
        {socios.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
            {s}
            <button className="text-brand-dark hover:text-brand disabled:opacity-50" disabled={pendOne} title="Criar contato deste sócio" onClick={() => um(s)}>＋</button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button className="btn-outline py-1 text-xs" onClick={todos} disabled={pendAll}>
          {pendAll ? "Criando…" : `Criar contatos de todos (${socios.length})`}
        </button>
        <span className="text-[11px] text-subtle">Clique no ＋ para criar um, ou "todos" de uma vez.</span>
      </div>
      {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
      {msg && <p className="mt-1 text-xs text-green-700">{msg}</p>}
    </div>
  );
}
