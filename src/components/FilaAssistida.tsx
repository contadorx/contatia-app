"use client";

// ============================================================
// FILA ASSISTIDA — o "em lote" possível para Instagram e LinkedIn
//
// NÃO EXISTE ENVIO EM LOTE nestes canais, e é importante ser exato sobre o porquê:
// a API do Instagram recusa a primeira mensagem (só responde dentro de 24h de uma
// interação iniciada pelo prospect) e o LinkedIn não tem API pública de mensagem,
// além de bloquear conta que automatiza. Um botão "enviar 50 DMs" seria uma promessa
// que termina em conta banida.
//
// O que dá para fazer — e é muito — é tirar o ATRITO de repetir 50 vezes. Sem isto,
// cada toque custa: abrir a lista, achar o contato, abrir a ficha, copiar o texto,
// abrir o perfil, voltar, marcar. Aqui é: ler, abrir, enviar, "enviei" → o próximo já
// está na tela. O trabalho humano continua sendo humano; o trabalho de navegação some.
//
// Cada "enviei" registra o toque no histórico do contato — senão a fila seria só uma
// forma bonita de perder o registro do que foi feito.
// ============================================================

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarToque } from "@/app/dashboard/contatos/ficha-actions";
import { conferirRede } from "@/app/dashboard/contatos/social-actions";
import { linkInstagramDM, linkLinkedin, linkInstagramPerfil, handleInstagram } from "@/lib/redes";

export type AlvoFila = {
  id: string;
  name: string;
  company: string | null;
  instagram: string | null;
  linkedin: string | null;
  instagram_conferido_at?: string | null;
  linkedin_conferido_at?: string | null;
};

// Mesmas variáveis das cadências, para o texto não ser um dialeto novo.
function render(tpl: string, c: AlvoFila) {
  const primeiro = (c.name || "").trim().split(/\s+/)[0] || "";
  return (tpl || "")
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiro)
    .replace(/\{\{\s*nome\s*\}\}/gi, c.name || "")
    .replace(/\{\{\s*empresa\s*\}\}/gi, c.company || "");
}

export default function FilaAssistida({
  alvos,
  rede,
  onFechar,
}: {
  alvos: AlvoFila[];
  rede: "instagram" | "linkedin";
  onFechar: () => void;
}) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [tpl, setTpl] = useState(
    rede === "instagram"
      ? "Oi {{primeiro_nome}}, tudo bem? Vi o perfil da {{empresa}} e queria trocar uma ideia rápida sobre "
      : "Olá {{primeiro_nome}}, tudo bem? Trabalho com {{empresa}} no setor e queria trocar uma ideia sobre "
  );
  const [copiado, setCopiado] = useState(false);
  const [feitos, setFeitos] = useState(0);
  const [pulados, setPulados] = useState(0);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const fila = useMemo(
    () => alvos.filter((a) => (rede === "instagram" ? a.instagram : a.linkedin)),
    [alvos, rede]
  );
  const atual = fila[i];
  const texto = atual ? render(tpl, atual) : "";
  const conferido = atual
    ? rede === "instagram" ? !!atual.instagram_conferido_at : !!atual.linkedin_conferido_at
    : false;

  const href = atual
    ? rede === "instagram"
      ? linkInstagramDM(atual.instagram, texto)
      : linkLinkedin(atual.linkedin)
    : null;

  function copiar() {
    try {
      navigator.clipboard.writeText(texto).then(
        () => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); },
        () => {}
      );
    } catch { /* copiar nunca derruba a tela */ }
  }

  function avancar() {
    setCopiado(false);
    setErro(null);
    if (i + 1 >= fila.length) { onFechar(); router.refresh(); return; }
    setI((v) => v + 1);
  }

  function enviei() {
    if (!atual) return;
    setErro(null);
    start(async () => {
      const r: any = await registrarToque(atual.id, {
        canal: rede,
        texto: `Mensagem por ${rede === "instagram" ? "Instagram" : "LinkedIn"}: ${texto.slice(0, 300)}`,
      });
      if (r?.error) { setErro(r.error); return; }
      // Quem enviou olhou o perfil — então dá para carimbar conferido de uma vez.
      if (!conferido) { try { await conferirRede(atual.id, rede, true); } catch { /* não bloqueia */ } }
      setFeitos((v) => v + 1);
      avancar();
    });
  }

  if (!fila.length) {
    return (
      <div className="mt-3 rounded-xl border border-warn/40 bg-warn/5 p-4 text-sm">
        <p className="font-semibold text-warn">Nenhum dos selecionados tem {rede === "instagram" ? "Instagram" : "LinkedIn"}.</p>
        <p className="mt-1 text-subtle">Rode <b>Completar canais</b> antes — ele busca os perfis no site da empresa.</p>
        <button className="btn-ghost mt-2 py-1 text-xs" onClick={onFechar}>fechar</button>
      </div>
    );
  }

  if (!atual) return null;

  return (
    <div className="mt-3 rounded-xl border border-signal/40 bg-signal/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-signal">
          Fila de {rede === "instagram" ? "Instagram" : "LinkedIn"} · {i + 1} de {fila.length}
        </p>
        <div className="flex items-center gap-3 text-xs text-subtle">
          <span>{feitos} enviados · {pulados} pulados</span>
          <button type="button" className="underline hover:text-ink" onClick={onFechar}>fechar</button>
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white">
        <div className="h-full bg-signal transition-all" style={{ width: `${Math.round(((i) / fila.length) * 100)}%` }} />
      </div>

      {/* ---- quem é ---- */}
      <div className="mt-3 rounded-lg bg-white p-3">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {atual.name}
          {atual.company && <span className="font-normal text-subtle">· {atual.company}</span>}
          {rede === "instagram" && atual.instagram && (
            <a
              href={linkInstagramPerfil(atual.instagram) as string}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-700"
              title="Ver o perfil antes de escrever"
            >
              ◎ @{handleInstagram(atual.instagram)}
            </a>
          )}
          {!conferido && (
            <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[10px] font-semibold text-warn" title="Ninguém confirmou que este é o perfil certo. Ao enviar, ele é marcado como conferido.">
              não conferido
            </span>
          )}
        </p>

        <textarea
          className="input mt-2 min-h-[90px] text-sm"
          value={tpl}
          onChange={(e) => setTpl(e.target.value)}
          placeholder="Escreva a mensagem. Use {{primeiro_nome}} e {{empresa}}."
        />
        <p className="mt-1 text-[11px] text-subtle">
          O texto vale para a fila inteira; as variáveis trocam por contato. Prévia:{" "}
          <span className="text-ink">{texto.slice(0, 120)}{texto.length > 120 ? "…" : ""}</span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost py-1.5 text-xs" onClick={copiar}>
            {copiado ? "copiado ✓" : "Copiar texto"}
          </button>
          {href && (
            <a className="btn-brand py-1.5 text-xs" href={href} target="_blank" rel="noreferrer">
              {rede === "instagram" ? "Abrir DM" : "Abrir perfil"}
            </a>
          )}
          <button type="button" className="btn-brand py-1.5 text-xs" disabled={pending} onClick={enviei}>
            {pending ? "…" : "Enviei → próximo"}
          </button>
          <button
            type="button"
            className="text-xs text-subtle underline hover:text-ink"
            onClick={() => { setPulados((v) => v + 1); avancar(); }}
          >
            pular
          </button>
        </div>

        {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}
      </div>

      <p className="mt-2 text-[11px] text-subtle">
        <b>Não existe envio automático aqui.</b> O Instagram recusa a primeira mensagem por
        API e o LinkedIn bloqueia conta que automatiza. Esta fila tira o trabalho de
        navegação — quem envia continua sendo você, e cada &ldquo;enviei&rdquo; fica no
        histórico do contato.
      </p>
    </div>
  );
}
