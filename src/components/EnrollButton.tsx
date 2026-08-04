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

import { useEffect, useRef, useState, useTransition } from "react";
import SmartSelect from "@/components/SmartSelect";
import { enrollContact } from "@/app/dashboard/cadencias/actions";

type Seq = { id: string; name: string };

export default function EnrollButton({ contactId, sequences }: { contactId: string; sequences: Seq[] }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ============================================================
  // A CAIXA ABRIA E NÃO FECHAVA
  //
  // O único jeito de fechar era acertar de novo o mesmo botão. Clicar fora não fazia
  // nada, Esc não fazia nada, e não havia ✕. Numa lista de várias linhas a caixa
  // aberta cobre a linha de baixo, e a tela parece travada.
  //
  // Três saídas agora — as três que qualquer pessoa tenta por reflexo.
  // ============================================================
  const caixa = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const foraDaqui = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // fase de captura: componentes de seleção costumam parar a propagação do próprio
    // clique, e sem isto o clique de fora nunca chegaria aqui.
    document.addEventListener("mousedown", foraDaqui, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", foraDaqui, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

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
    <div className="relative inline-block" ref={caixa}>
      <button className="btn-ghost py-1.5 text-sm" onClick={() => setOpen((o) => !o)} disabled={pending}>
        {pending ? "..." : "▶ Inscrever em cadência"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-line bg-surface p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-subtle">Inscrever em cadência</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-1.5 text-sm leading-none text-subtle hover:bg-muted hover:text-ink"
              title="Fechar (Esc)"
            >
              ✕
            </button>
          </div>
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
