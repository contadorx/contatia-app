"use client";

// ============================================================
// REDES DO CONTATO (ficha) — ver, corrigir e capturar do site
//
// Instagram e LinkedIn são canais ASSISTIDOS: o app monta o link e o texto, quem envia
// é uma pessoa. Não é preguiça de integrar — a API do Instagram proíbe a primeira
// mensagem e o LinkedIn não tem API pública de mensagem (ver @/lib/redes).
//
// Por isso o que importa aqui é o DADO estar certo: com o @ errado, o clique leva a
// lugar nenhum. Daí o campo ser editável e aceitar qualquer formato colado.
// ============================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { capturarRedesDoSite, salvarRedes } from "@/app/dashboard/contatos/social-actions";
import { linkInstagramPerfil, linkLinkedin, handleInstagram } from "@/lib/redes";

export default function RedesContato({
  contactId,
  instagram,
  linkedin,
  temDominio,
}: {
  contactId: string;
  instagram: string | null;
  linkedin: string | null;
  temDominio: boolean;
}) {
  const router = useRouter();
  const [ig, setIg] = useState(instagram || "");
  const [li, setLi] = useState(linkedin || "");
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);

  const perfilIg = linkInstagramPerfil(instagram);
  const perfilLi = linkLinkedin(linkedin);

  function salvar() {
    setMsg(null);
    start(async () => {
      const r: any = await salvarRedes(contactId, { instagram: ig, linkedin: li });
      if (r?.error) { setMsg({ ok: false, txt: r.error }); return; }
      setMsg({ ok: true, txt: "Salvo." });
      setEditando(false);
      router.refresh();
    });
  }

  function capturar() {
    setMsg(null);
    start(async () => {
      const r: any = await capturarRedesDoSite([contactId]);
      if (r?.error) { setMsg({ ok: false, txt: r.error }); return; }
      if (r?.semDominio) { setMsg({ ok: false, txt: "Este contato não tem domínio da empresa — sem site não há onde procurar." }); return; }
      const achou = (r?.comIg || 0) + (r?.comLi || 0);
      setMsg({
        ok: achou > 0,
        txt: achou > 0
          ? `Achei ${r.comIg ? "Instagram" : ""}${r.comIg && r.comLi ? " e " : ""}${r.comLi ? "LinkedIn" : ""} no site.`
          : "Nenhuma rede publicada no site desta empresa.",
      });
      router.refresh();
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Redes sociais</p>
        <div className="flex items-center gap-2 text-xs">
          {temDominio && (
            <button
              type="button"
              className="rounded-lg border border-line bg-white px-2 py-1 font-medium hover:bg-muted disabled:opacity-40"
              disabled={pending}
              onClick={capturar}
              title="Procura os perfis publicados no site da empresa (rodapé, página de contato)."
            >
              {pending ? "Procurando…" : "Buscar no site"}
            </button>
          )}
          <button type="button" className="text-subtle underline hover:text-ink" onClick={() => setEditando((v) => !v)}>
            {editando ? "cancelar" : "editar"}
          </button>
        </div>
      </div>

      {!editando ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {perfilIg ? (
            <a
              href={perfilIg}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-xs font-semibold text-fuchsia-700 hover:border-fuchsia-400"
            >
              ◎ @{handleInstagram(instagram)}
            </a>
          ) : (
            <span className="text-xs text-subtle">sem Instagram</span>
          )}
          {perfilLi ? (
            <a
              href={perfilLi}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:border-blue-400"
            >
              in · perfil
            </a>
          ) : (
            <span className="text-xs text-subtle">sem LinkedIn</span>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div>
            <label className="label">Instagram</label>
            <input
              className="input mt-1"
              value={ig}
              onChange={(e) => setIg(e.target.value)}
              placeholder="@contabilidadealfa (ou cole o link do perfil)"
            />
          </div>
          <div>
            <label className="label">LinkedIn</label>
            <input
              className="input mt-1"
              value={li}
              onChange={(e) => setLi(e.target.value)}
              placeholder="https://www.linkedin.com/in/... ou /company/..."
            />
          </div>
          <button className="btn-brand py-1.5 text-sm" onClick={salvar} disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      )}

      {msg && (
        <p className={`mt-2 rounded-lg px-3 py-1.5 text-xs font-medium ${msg.ok ? "bg-brand-soft text-brand-dark" : "bg-warn/10 text-warn"}`}>
          {msg.txt}
        </p>
      )}

      <p className="mt-2 text-[11px] text-subtle">
        Estes canais são <b>assistidos</b>: o Contatia abre a conversa com o texto pronto e
        você envia. O Instagram não permite mandar a primeira mensagem por robô, e o
        LinkedIn bloqueia conta que automatiza — clicar você mesmo é o caminho seguro.
      </p>
    </div>
  );
}
