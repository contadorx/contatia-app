"use client";

import { useEffect, useState } from "react";

export default function WebToLeadSnippet({ token }: { token: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const endpoint = `${origin}/api/inbound/${token}`;
  const snippet = `<form id="contatia-lead">
  <input name="name" placeholder="Nome" required />
  <input name="email" type="email" placeholder="E-mail" required />
  <input name="phone" placeholder="WhatsApp" />
  <button type="submit">Enviar</button>
</form>
<script>
document.getElementById('contatia-lead').addEventListener('submit', async function (e) {
  e.preventDefault();
  var f = e.target;
  await fetch('${endpoint}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: f.name.value, email: f.email.value, phone: f.phone.value })
  });
  f.reset();
  alert('Recebemos seu contato!');
});
</script>`;

  function copy() {
    navigator.clipboard?.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <p className="label">Endpoint de captação</p>
      <input className="input mt-1 text-xs" value={endpoint || "…"} readOnly onFocus={(e) => e.target.select()} />
      <p className="mt-3 label">Formulário para colar no seu site</p>
      <textarea className="input mt-1 min-h-[160px] font-mono text-[11px]" value={snippet} readOnly />
      <button className="btn-brand mt-2 py-1.5 text-sm" onClick={copy}>
        {copied ? "Copiado!" : "Copiar formulário"}
      </button>
      <p className="mt-2 text-xs text-subtle">
        Qualquer envio cai em Contatos com origem <b>web</b>. Depois é só inscrever numa cadência.
      </p>
    </div>
  );
}
