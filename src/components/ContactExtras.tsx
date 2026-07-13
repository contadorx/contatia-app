"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveContactExtra, enrichContact, addSocioContact } from "@/app/dashboard/contatos/actions";

type Receita = {
  cnae: string | null;
  cnae_descricao: string | null;
  situacao: string | null;
  porte: string | null;
  uf: string | null;
  municipio: string | null;
};

// campos de rapport (livres, guardados em custom.rapport)
const RAPPORT_FIELDS: { k: string; l: string; ph: string }[] = [
  { k: "como_conheceu", l: "Como conheci", ph: "Indicação do João, evento X, inbound…" },
  { k: "interesses", l: "Interesses / assuntos", ph: "Corrida, Palmeiras, filhos pequenos…" },
  { k: "aniversario", l: "Aniversário", ph: "12/03" },
  { k: "estilo", l: "Estilo de comunicação", ph: "Direto, gosta de número, responde rápido…" },
  { k: "contexto", l: "Contexto da última conversa", ph: "Pediu proposta até sexta; decisor é o sócio." },
];

export default function ContactExtras({
  contactId,
  accountId,
  cnpj,
  hasReceita,
  receita,
  socios,
  enrichedAt,
  linkedin,
  rapport,
}: {
  contactId: string;
  accountId: string | null;
  cnpj: string | null;
  hasReceita: boolean;
  receita: Receita;
  socios: string[];
  enrichedAt: string | null;
  linkedin: string;
  rapport: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // rapport + linkedin (edição)
  const [lk, setLk] = useState(linkedin || "");
  const [rp, setRp] = useState<Record<string, string>>(rapport || {});
  const [okRapport, setOkRapport] = useState(false);
  const upRp = (k: string, v: string) => { setRp((s) => ({ ...s, [k]: v })); setOkRapport(false); };

  function salvarRapport() {
    setMsg(null);
    start(async () => {
      const res = (await saveContactExtra(contactId, { linkedin: lk, rapport: rp })) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else { setOkRapport(true); router.refresh(); }
    });
  }
  function enriquecer() {
    setMsg(null);
    start(async () => {
      const res = (await enrichContact(contactId)) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else router.refresh();
    });
  }
  function criarSocio(nome: string) {
    setMsg(null);
    start(async () => {
      const res = (await addSocioContact(contactId, nome)) as { ok?: boolean; error?: string };
      if (res?.error) setMsg(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      {/* EMPRESA (RECEITA FEDERAL) */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Empresa (Receita Federal)</h2>
          {cnpj && (
            <button className="btn-ghost py-1 text-xs" disabled={pending} onClick={enriquecer}>
              {pending ? "…" : enrichedAt ? "Atualizar" : "Enriquecer pelo CNPJ"}
            </button>
          )}
        </div>

        {hasReceita ? (
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Item label="CNAE" value={receita.cnae_descricao || receita.cnae} />
            <Item label="Porte" value={receita.porte} />
            <Item label="Situação" value={receita.situacao} />
            <Item label="Município/UF" value={[receita.municipio, receita.uf].filter(Boolean).join(" / ")} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-subtle">
            {cnpj
              ? "Ainda sem dados da Receita. Clique em “Enriquecer pelo CNPJ” para trazer CNAE, porte, situação e sócios."
              : "Sem CNPJ neste contato. Preencha o CNPJ em “Editar dados” para poder enriquecer pela Receita."}
          </p>
        )}

        {/* SÓCIOS → viram contatos */}
        {socios.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="label">Sócios (QSA)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {socios.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                  {s}
                  <button
                    className="text-brand-dark hover:text-brand"
                    disabled={pending}
                    title="Criar contato deste sócio"
                    onClick={() => criarSocio(s)}
                  >
                    ＋
                  </button>
                </span>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-subtle">Clique no ＋ para transformar o sócio num contato desta empresa.</p>
          </div>
        )}
        {enrichedAt && (
          <p className="mt-3 text-[11px] text-subtle">Dados da Receita atualizados em {new Date(enrichedAt).toLocaleDateString("pt-BR")}.</p>
        )}
      </div>

      {/* RAPPORT */}
      <div className="card p-5">
        <h2 className="font-display text-lg font-bold">Rapport</h2>
        <p className="mt-0.5 text-xs text-subtle">O que faz a conversa ser pessoal. Fica salvo no contato (e alimenta a IA nas próximas versões).</p>

        <div className="mt-3 space-y-3">
          <div>
            <label className="label">LinkedIn</label>
            <input className="input mt-1 text-sm" value={lk} onChange={(e) => { setLk(e.target.value); setOkRapport(false); }} placeholder="https://linkedin.com/in/…" />
          </div>
          {RAPPORT_FIELDS.map((f) => (
            <div key={f.k}>
              <label className="label">{f.l}</label>
              {f.k === "contexto" ? (
                <textarea className="input mt-1 min-h-[70px] text-sm" value={rp[f.k] || ""} onChange={(e) => upRp(f.k, e.target.value)} placeholder={f.ph} />
              ) : (
                <input className="input mt-1 text-sm" value={rp[f.k] || ""} onChange={(e) => upRp(f.k, e.target.value)} placeholder={f.ph} />
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button className="btn-brand py-1.5 text-sm" disabled={pending} onClick={salvarRapport}>
            {pending ? "Salvando…" : "Salvar rapport"}
          </button>
          {okRapport && <span className="text-sm text-signal">✓ Salvo</span>}
        </div>
      </div>

      {msg && <p className="text-sm text-danger lg:col-span-2">{msg}</p>}
    </div>
  );
}

function Item({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={value ? "" : "text-subtle"}>{value || "—"}</p>
    </div>
  );
}
