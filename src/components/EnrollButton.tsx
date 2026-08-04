"use client";

// ============================================================
// POR QUE ESTE BOTÃO NÃO FILTRAVA
//
// O `SmartSelect` do app filtra por texto desde sempre — está lá, testado, usado na
// lista de contatos. Só que este botão nunca usou o SmartSelect: era um dropdown feito à
// mão, um `map` de botões, sem campo de busca. Com três cadências ninguém nota; com
// vinte, procurar vira rolagem.
//
// Ou seja: não havia bug de filtragem, havia um componente reinventado pior. Trocado
// pelo que já existia — mesma busca, mesmo teclado, mesmo comportamento dos outros
// seletores da casa.
// ============================================================

import { useState, useTransition } from "react";
import SmartSelect from "@/components/SmartSelect";
import { enrollContact } from "@/app/dashboard/cadencias/actions";

type Seq = { id: string; name: string };

export default function EnrollButton({ contactId, sequences }: { contactId: string; sequences: Seq[] }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!sequences.length) return <span className="text-xs text-subtle">—</span>;
  if (done) return <span className="text-xs text-signal">✓ inscrito</span>;

  function enroll(seqId: string) {
    if (!seqId) return;
    setErro(null);
    start(async () => {
      const res = await enrollContact(contactId, seqId);
      // O erro era engolido: `if (!res?.error) setDone(true)` e nada no caminho do erro —
      // a caixa fechava e a tela ficava igual, como se tivesse dado certo.
      if (res?.error) { setErro(res.error); return; }
      setDone(true);
      setOpen(false);
    });
  }

  return (
    <div className="relative inline-block">
      <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen((o) => !o)} disabled={pending}>
        {pending ? "..." : "▶ Inscrever em cadência"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-line bg-surface p-2 shadow-lg">
          <SmartSelect
            placeholder="Buscar cadência…"
            className="py-1.5 text-sm"
            options={sequences.map((s) => ({ value: s.id, label: s.name }))}
            onValueChange={(v) => enroll(v)}
            emptyText="nenhuma cadência com esse nome"
          />
          {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}
        </div>
      )}
    </div>
  );
}
