"use client";

// ============================================================
// TESTAR OUTRA CAIXA DO MESMO DOMÍNIO — SEM SUMIR DA TELA
//
// A caixa de teste só existia quando o contato NÃO tinha e-mail. Assim que um
// endereço era gravado, ela desaparecia. Só que é justamente aí que ela passa a ser
// mais útil: num escritório contábil o app costuma achar `societario@`, e quem
// trabalha a conta sabe que existe `fiscal@`, `dp@`, `contabil@` — e quer testar,
// confirmar e trocar. Com o campo escondido, a saída era editar o contato na mão e
// perder a verificação.
//
// Agora ela é fixa, fica logo abaixo do e-mail em uso, e o domínio já vem preenchido:
// digita-se só o começo do endereço. Os prefixos mais comuns de escritório contábil
// viraram atalhos de um clique, porque essa é a busca que se repete.
//
// A troca só é oferecida quando o servidor CONFIRMA a caixa. Testar é barato; trocar
// um endereço que funciona por um que ninguém confirmou, não.
// ============================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { testarEmailAvulso, aplicarEmailContato } from "@/app/dashboard/contatos/verify-actions";

const MAPA: Record<string, { txt: string; cls: string; podeUsar: boolean }> = {
  valid: { txt: "✓ a caixa existe", cls: "text-signal", podeUsar: true },
  invalid: { txt: "✕ a caixa não existe", cls: "text-danger", podeUsar: false },
  uncertain: { txt: "? incerto — o domínio aceita qualquer endereço (catch-all)", cls: "text-warn", podeUsar: true },
  blocked: { txt: "🔒 o provedor bloqueia a verificação", cls: "text-warn", podeUsar: true },
  mx_ok: { txt: "o domínio recebe e-mail, mas a caixa não deu para confirmar", cls: "text-warn", podeUsar: true },
  error: { txt: "não foi possível verificar agora", cls: "text-subtle", podeUsar: false },
};

// Os endereços por função que aparecem em escritório contábil. A ordem é a de uso:
// quem procura outra caixa quase sempre procura uma destas.
const PREFIXOS = ["fiscal", "contabil", "societario", "dp", "pessoal", "financeiro", "contato", "comercial"];

export default function TestarCaixa({
  contactId,
  dominio,
  emailAtual,
}: {
  contactId: string;
  dominio: string | null;
  emailAtual: string | null;
}) {
  const router = useRouter();
  const [prefixo, setPrefixo] = useState("");
  const [dominioLivre, setDominioLivre] = useState(dominio || "");
  const [res, setRes] = useState<{ status?: string; reason?: string; error?: string } | null>(null);
  const [testado, setTestado] = useState<string>("");
  const [pending, start] = useTransition();
  const [salvando, startSalvar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  const dom = (dominioLivre || "").trim().replace(/^@/, "");
  // aceita tanto "fiscal" quanto "fiscal@outrodominio.com.br" colado inteiro
  const endereco = prefixo.includes("@") ? prefixo.trim().toLowerCase() : `${prefixo.trim().toLowerCase()}@${dom}`;
  const valido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(endereco);

  function testar(pref?: string) {
    const alvo = pref ? (pref.includes("@") ? pref : `${pref}@${dom}`) : endereco;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alvo)) return;
    if (pref) setPrefixo(pref);
    setRes(null);
    setAviso(null);
    setTestado(alvo);
    start(async () => {
      try {
        setRes((await testarEmailAvulso(alvo)) as any);
      } catch (e: any) {
        setRes({ error: e?.message || "falhou ao testar" });
      }
    });
  }

  function usar() {
    setAviso(null);
    startSalvar(async () => {
      const r: any = await aplicarEmailContato(contactId, testado);
      if (r?.error) { setAviso(r.error); return; }
      setRes(null);
      setPrefixo("");
      router.refresh();
    });
  }

  const info = res?.status ? MAPA[res.status] || MAPA.error : null;
  const jaEhOAtual = !!emailAtual && testado.toLowerCase() === emailAtual.toLowerCase();

  return (
    <div className="mt-2 rounded-lg border border-line bg-white px-2.5 py-2">
      <p className="text-[11px] font-semibold text-ink">
        Testar outra caixa {dom ? <span className="font-normal text-subtle">em {dom}</span> : null}
      </p>
      <p className="mt-0.5 text-[11px] text-subtle">
        Escritório costuma ter caixa por área. Digite só o começo do endereço — eu pergunto ao
        servidor se ela existe e, se existir, você troca aqui mesmo.
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {PREFIXOS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending || !dom}
            onClick={() => testar(p)}
            className="rounded-full border border-line px-2 py-0.5 text-[11px] text-subtle hover:border-brand hover:text-brand-dark disabled:opacity-40"
            title={dom ? `Testar ${p}@${dom}` : "Sem domínio para testar"}
          >
            {p}@
          </button>
        ))}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <input
          className="input w-28 py-1 text-sm"
          value={prefixo}
          onChange={(e) => setPrefixo(e.target.value)}
          placeholder="fiscal"
          onKeyDown={(e) => { if (e.key === "Enter" && valido) testar(); }}
        />
        <span className="text-sm text-subtle">@</span>
        <input
          className="input w-44 py-1 text-sm"
          value={dominioLivre}
          onChange={(e) => setDominioLivre(e.target.value)}
          placeholder="empresa.com.br"
        />
        <button
          type="button"
          className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40"
          onClick={() => testar()}
          disabled={pending || !valido}
        >
          {pending ? "Testando…" : "Testar"}
        </button>
      </div>

      {pending && <p className="mt-1.5 text-[11px] text-subtle">Conversando com o servidor de {dom || "…"} — leva alguns segundos.</p>}
      {res?.error && <p className="mt-1.5 text-[11px] text-danger">{res.error}</p>}
      {aviso && <p className="mt-1.5 text-[11px] text-danger">{aviso}</p>}

      {info && !pending && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className={`text-[11px] font-medium ${info.cls}`}>
            <span className="font-mono">{testado}</span> — {info.txt}
          </p>
          {info.podeUsar && !jaEhOAtual && (
            <button
              type="button"
              className="rounded-lg bg-brand px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
              disabled={salvando}
              onClick={usar}
              title={emailAtual ? `Substitui ${emailAtual} por ${testado}` : `Usa ${testado} como e-mail deste contato`}
            >
              {salvando ? "…" : emailAtual ? "Usar este no lugar" : "Usar como e-mail"}
            </button>
          )}
          {jaEhOAtual && <span className="text-[11px] text-subtle">já é o e-mail deste contato</span>}
        </div>
      )}
    </div>
  );
}
