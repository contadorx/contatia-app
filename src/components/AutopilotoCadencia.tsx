"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAutopilotoCadencia } from "@/app/dashboard/cadencias/actions";

// A chave que faz o agente escalar — e, pela mesma razão, a que faz um playbook ruim
// escalar. O rótulo diz o que acontece, não o nome da feature.
export default function AutopilotoCadencia({ id, ligado, nome }: { id: string; ligado: boolean; nome: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function alternar(v: boolean) {
    setErro(null);
    if (v && !confirm(
      `Ligar o autopiloto em "${nome}"?\n\n` +
      "A partir de agora, todo lead que responder a esta cadência pelo WhatsApp cai direto no agente — " +
      "ele responde sozinho, sem ninguém olhar antes.\n\n" +
      "Desligar depois não tira as conversas que já estiverem com ele."
    )) return;
    start(async () => {
      const r = await setAutopilotoCadencia(id, v);
      if (r?.error) setErro(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <button
        className={[
          "rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40",
          ligado
            ? "border border-signal/40 bg-signal/10 text-signal hover:bg-signal/20"
            : "border border-line text-subtle hover:bg-muted",
        ].join(" ")}
        disabled={pending}
        onClick={() => alternar(!ligado)}
        title={ligado
          ? "Quem responder cai no agente automaticamente. Clique para desligar."
          : "Hoje as respostas esperam você passar a conversa ao agente à mão."}
      >
        {ligado ? "● Autopiloto ligado" : "Autopiloto desligado"}
      </button>
      {ligado && (
        <p className="mt-1 text-[11px] text-subtle">
          quem responder aqui vai direto para o agente
        </p>
      )}
      {erro && <p className="mt-1 max-w-md text-[11px] text-danger">{erro}</p>}
    </div>
  );
}
