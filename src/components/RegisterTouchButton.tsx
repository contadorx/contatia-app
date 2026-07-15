"use client";

import { useState, useTransition } from "react";
import SmartSelect from "@/components/SmartSelect";
import { registrarToque } from "@/app/dashboard/contatos/ficha-actions";

// Registra um toque feito por fora do sistema (ligou, mandou mensagem, etc.).
export default function RegisterTouchButton({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [canal, setCanal] = useState("Ligação");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvar() {
    setErro(null);
    start(async () => {
      const r: any = await registrarToque(contactId, { canal, texto });
      if (r?.error) { setErro(r.error); return; }
      setTexto("");
      setOpen(false);
    });
  }

  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)}>✓ Registrar toque</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Registrar toque</h3>
              <button className="text-sm text-subtle hover:text-ink" onClick={() => setOpen(false)}>fechar</button>
            </div>
            <p className="mt-1 text-sm text-subtle">Marque um contato feito por fora (ligação, mensagem). Entra na linha do tempo, no score e no “último toque”.</p>

            <div className="mt-4 grid gap-3">
              <div>
                <label className="label">Canal</label>
                <SmartSelect
                  className="mt-1"
                  value={canal}
                  onValueChange={setCanal}
                  options={[
                    { value: "Ligação", label: "Ligação" },
                    { value: "WhatsApp", label: "WhatsApp" },
                    { value: "E-mail", label: "E-mail" },
                    { value: "Presencial", label: "Presencial" },
                    { value: "Outro", label: "Outro" },
                  ]}
                />
              </div>
              <div>
                <label className="label">Anotação (opcional)</label>
                <textarea className="input mt-1 min-h-[70px]" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que foi conversado, próximo passo…" />
              </div>
            </div>

            {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
            <div className="mt-4 flex gap-2">
              <button className="btn-brand" onClick={salvar} disabled={pending}>{pending ? "Salvando…" : "Registrar"}</button>
              <button className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
