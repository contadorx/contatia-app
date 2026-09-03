"use client";

import { useState } from "react";

// ============================================================
// A TAG DESTE ENVIO
//
// Campo com sugestões das tags que já existem, e que aceita nome novo. Não é um select
// fechado de propósito: a tag de uma importação quase sempre é nova ("Contadores SP
// jan/26") e obrigar a criar antes, noutra tela, faria todo mundo aceitar o padrão — que
// é justamente o que tornava a tag inútil.
//
// Vazio é legítimo: cai em "Radar", o comportamento antigo.
// ============================================================
export default function TagDoEnvio({
  valor, onChange, sugestoes,
}: {
  valor: string;
  onChange: (v: string) => void;
  sugestoes: string[];
}) {
  const [aberto, setAberto] = useState(false);
  const filtradas = valor.trim()
    ? sugestoes.filter((t) => t.toLowerCase().includes(valor.trim().toLowerCase()) && t.toLowerCase() !== valor.trim().toLowerCase())
    : sugestoes;

  return (
    <div className="relative">
      <input
        className="input py-1 text-xs"
        style={{ width: 190 }}
        placeholder="Tag (padrão: Radar)"
        value={valor}
        maxLength={40}
        onChange={(e) => { onChange(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        title="Vai para a empresa E para todos os contatos deste envio. Pode ser uma tag nova."
      />
      {aberto && filtradas.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {filtradas.slice(0, 8).map((t) => (
            <button
              key={t}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-muted"
              onMouseDown={(e) => { e.preventDefault(); onChange(t); setAberto(false); }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
