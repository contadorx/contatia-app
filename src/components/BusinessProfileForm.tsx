"use client";

import { useState, useTransition } from "react";
import { saveBusinessProfile } from "@/app/dashboard/config/actions";
import SmartSelect, { SmartOption } from "@/components/SmartSelect";

type Biz = {
  legal_name?: string | null;
  cnpj?: string | null;
  segment?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  website?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
};

const SEGMENTS = [
  { v: "", l: "—" },
  { v: "contabil", l: "Contabilidade" },
  { v: "advocacia", l: "Advocacia" },
  { v: "consultoria", l: "Consultoria" },
  { v: "seguros", l: "Seguros" },
  { v: "agencia", l: "Agência / Marketing" },
  { v: "ti", l: "TI / Software" },
  { v: "outro", l: "Outro" },
];

const SEGMENT_OPTS: SmartOption[] = SEGMENTS.filter((s) => s.v !== "").map((s) => ({ value: s.v, label: s.l }));

export default function BusinessProfileForm({ biz, canEdit }: { biz: Biz; canEdit: boolean }) {
  const [f, setF] = useState({
    legal_name: biz.legal_name || "",
    cnpj: biz.cnpj || "",
    segment: biz.segment || "",
    contact_email: biz.contact_email || "",
    phone: biz.phone || "",
    website: biz.website || "",
    logo_url: biz.logo_url || "",
    brand_color: biz.brand_color || "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  function up(k: string, v: string) {
    setF((s) => ({ ...s, [k]: v }));
    setOk(false);
  }
  function save() {
    setMsg(null);
    setOk(false);
    start(async () => {
      const res = await saveBusinessProfile(f);
      if (res?.error) setMsg(res.error);
      else setOk(true);
    });
  }

  const colorValid = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(f.brand_color);

  return (
    <div>
      {!canEdit && (
        <p className="mb-4 rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn">
          Apenas o owner do workspace pode alterar a ficha do negócio.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nome do negócio</label>
          <input className="input mt-1" value={f.legal_name} disabled={!canEdit} onChange={(e) => up("legal_name", e.target.value)} placeholder="Sua Empresa Ltda" />
        </div>
        <div>
          <label className="label">CNPJ</label>
          <input className="input mt-1" value={f.cnpj} disabled={!canEdit} onChange={(e) => up("cnpj", e.target.value)} placeholder="00.000.000/0001-00" />
        </div>
        <div>
          <label className="label">Segmento</label>
          <div className="mt-1">
            <SmartSelect
              options={SEGMENT_OPTS}
              value={f.segment}
              disabled={!canEdit}
              onValueChange={(v) => up("segment", v)}
              placeholder="—"
              clearable
            />
          </div>
        </div>
        <div>
          <label className="label">E-mail de contato</label>
          <input type="email" className="input mt-1" value={f.contact_email} disabled={!canEdit} onChange={(e) => up("contact_email", e.target.value)} placeholder="contato@empresa.com.br" />
        </div>
        <div>
          <label className="label">Telefone</label>
          <input className="input mt-1" value={f.phone} disabled={!canEdit} onChange={(e) => up("phone", e.target.value)} placeholder="(11) 90000-0000" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Site</label>
          <input className="input mt-1" value={f.website} disabled={!canEdit} onChange={(e) => up("website", e.target.value)} placeholder="https://empresa.com.br" />
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Marca (white-label)</p>
        <p className="mt-1 text-xs text-subtle">Aplicada na assinatura de e-mail e nos documentos/propostas que o cliente recebe.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">URL do logotipo (PNG/SVG hospedado)</label>
            <input className="input mt-1" value={f.logo_url} disabled={!canEdit} onChange={(e) => up("logo_url", e.target.value)} placeholder="https://empresa.com.br/logo.png" />
          </div>
          <div>
            <label className="label">Cor da marca (hex)</label>
            <div className="mt-1 flex items-center gap-2">
              <input className="input" value={f.brand_color} disabled={!canEdit} onChange={(e) => up("brand_color", e.target.value)} placeholder="#4A3AFF" />
              <span
                className="h-9 w-9 shrink-0 rounded-lg border border-line"
                style={{ background: colorValid ? f.brand_color : "transparent" }}
                title={colorValid ? f.brand_color : "cor inválida"}
              />
            </div>
          </div>
        </div>
        {f.logo_url && (
          <div className="mt-3">
            <p className="label">Prévia do logo</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.logo_url} alt="logo" className="mt-1 h-12 rounded border border-line bg-white object-contain p-1" />
          </div>
        )}
      </div>

      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      {ok && <p className="mt-3 text-sm text-signal">✓ Ficha salva.</p>}
      {canEdit && (
        <button className="btn-brand mt-4 py-1.5 text-sm" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar ficha do negócio"}
        </button>
      )}
    </div>
  );
}
