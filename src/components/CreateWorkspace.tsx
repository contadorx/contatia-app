"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setupWorkspace } from "@/app/dashboard/setup-actions";

// Tela amigável de "crie seu workspace" para quem entrou com conta sem workspace
// (cadastro self-service). Substitui o diagnóstico técnico nesse caso.
export default function CreateWorkspace({ defaultName = "" }: { defaultName?: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="card mx-auto max-w-md p-8">
      <p className="font-display text-lg font-bold">Vamos criar seu workspace</p>
      <p className="mt-2 text-sm text-subtle">
        Dê um nome ao seu espaço de trabalho (pode ser o nome da sua empresa). Dá para mudar depois em Configurações.
      </p>
      <label className="label mt-4 block">Nome do workspace</label>
      <input
        className="input mt-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ex.: Minha Empresa"
        autoFocus
      />
      {msg && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <button
        className="btn-brand mt-4 w-full"
        disabled={pending || !name.trim()}
        onClick={() => start(async () => {
          setMsg(null);
          const r = (await setupWorkspace(name)) as any;
          if (r?.error) setMsg(r.error);
          else router.refresh();
        })}
      >
        {pending ? "Criando..." : "Criar workspace e entrar"}
      </button>
      <p className="mt-3 text-center text-xs text-subtle">
        Foi convidado para um time? Use o <b>link de convite</b> que te enviaram, em vez de criar um novo.
      </p>
    </div>
  );
}
