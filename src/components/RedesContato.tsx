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
import { linkInstagramPerfil, linkLinkedin, handleInstagram, nivelRede, tipoLinkedin } from "@/lib/redes";
import { conferirRede } from "@/app/dashboard/contatos/social-actions";

export default function RedesContato({
  contactId,
  instagram,
  linkedin,
  temDominio,
  igOrigem = null,
  igConferidoEm = null,
  liOrigem = null,
  liConferidoEm = null,
}: {
  contactId: string;
  instagram: string | null;
  linkedin: string | null;
  temDominio: boolean;
  igOrigem?: string | null;
  igConferidoEm?: string | null;
  liOrigem?: string | null;
  liConferidoEm?: string | null;
}) {
  const router = useRouter();
  const [ig, setIg] = useState(instagram || "");
  const [li, setLi] = useState(linkedin || "");
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null);

  const perfilIg = linkInstagramPerfil(instagram);
  const perfilLi = linkLinkedin(linkedin);
  const nIg = nivelRede({ valor: instagram, origem: igOrigem, conferidoEm: igConferidoEm, rede: "instagram" });
  const nLi = nivelRede({ valor: linkedin, origem: liOrigem, conferidoEm: liConferidoEm, rede: "linkedin" });
  const tipoLi = tipoLinkedin(linkedin);

  function conferir(rede: "instagram" | "linkedin", marcar: boolean) {
    setMsg(null);
    start(async () => {
      const r: any = await conferirRede(contactId, rede, marcar);
      if (r?.error) { setMsg({ ok: false, txt: r.error }); return; }
      router.refresh();
    });
  }

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
        <div className="mt-2 space-y-2 text-sm">
          {/* ---- Instagram ---- */}
          <div className="flex flex-wrap items-center gap-2">
            {perfilIg ? (
              <>
                <a
                  href={perfilIg}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-xs font-semibold text-fuchsia-700 hover:border-fuchsia-400"
                >
                  ◎ @{handleInstagram(instagram)}
                </a>
                {nIg && (
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${nIg.cor}`} title={nIg.titulo}>
                    {nIg.selo}
                  </span>
                )}
                <button
                  type="button"
                  className="text-[11px] text-subtle underline hover:text-ink disabled:opacity-40"
                  disabled={pending}
                  onClick={() => conferir("instagram", !igConferidoEm)}
                  title={igConferidoEm ? "Desmarcar a conferência" : "Abri e é o perfil certo"}
                >
                  {igConferidoEm ? "desmarcar" : "era esse ✓"}
                </button>
              </>
            ) : (
              <span className="text-xs text-subtle">sem Instagram</span>
            )}
          </div>

          {/* ---- LinkedIn ---- */}
          <div className="flex flex-wrap items-center gap-2">
            {perfilLi ? (
              <>
                <a
                  href={perfilLi}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:border-blue-400"
                >
                  in · {tipoLi === "empresa" ? "página da empresa" : tipoLi === "pessoa" ? "perfil de pessoa" : "perfil"}
                </a>
                {nLi && (
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${nLi.cor}`} title={nLi.titulo}>
                    {nLi.selo}
                  </span>
                )}
                <button
                  type="button"
                  className="text-[11px] text-subtle underline hover:text-ink disabled:opacity-40"
                  disabled={pending}
                  onClick={() => conferir("linkedin", !liConferidoEm)}
                  title={liConferidoEm ? "Desmarcar a conferência" : "Abri e é o perfil certo"}
                >
                  {liConferidoEm ? "desmarcar" : "era esse ✓"}
                </button>
              </>
            ) : (
              <span className="text-xs text-subtle">sem LinkedIn</span>
            )}
          </div>
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

      <div className="mt-3 border-t border-line pt-2 text-[11px] text-subtle">
        <p>
          Estes canais são <b>assistidos</b>: o Contatia abre a conversa com o texto pronto e
          você envia. O Instagram não permite mandar a primeira mensagem por robô, e o
          LinkedIn bloqueia conta que automatiza — clicar você mesmo é o caminho seguro.
        </p>
        <p className="mt-1">
          <b>Não existe &ldquo;verificado&rdquo; aqui como no WhatsApp e no e-mail</b>, porque
          nenhuma API responde se um perfil é mesmo daquela pessoa — e conferir sozinho, do
          servidor, faria o Instagram bloquear o workspace inteiro. O selo <b>conferido</b>
          vale quando <i>você</i> abriu e confirmou. É a única verificação possível, e é
          honesta.
        </p>
      </div>
    </div>
  );
}
