"use client";

// ============================================================
// UM PAINEL QUE NÃO FECHA SOZINHO
//
// A versão anterior era um `<details open={faltaAlgumCanal}>` direto na página, que é
// um componente de servidor. Parece inofensivo e não é: `open` é reaplicado a CADA
// renderização. Toda vez que uma ação chama `router.refresh()` — e a busca de e-mail
// chama, para a ficha mostrar o endereço novo — o React reescreve o `open` com o
// valor recalculado no servidor.
//
// Consequência prática, e foi assim que apareceu: você abre o painel, procura o
// e-mail, o servidor confirma, `faltaAlgumCanal` vira false — e o painel FECHA no
// mesmo instante, levando embora o resultado que você acabou de pedir. Da cadeira de
// quem usa, isso não é "o painel fechou": é "a busca individual parou de funcionar".
//
// Aqui o estado de aberto/fechado é do NAVEGADOR. O valor vindo do servidor decide
// só como ele nasce; depois disso, quem manda é quem clicou. `onToggle` mantém o
// estado em dia com o que o usuário fez, para que a próxima renderização reaplique o
// mesmo valor em vez de um contrário.
// ============================================================

import { useState } from "react";

export default function PainelRecolhivel({
  titulo,
  aviso,
  abrirInicial = false,
  children,
}: {
  titulo: string;
  aviso?: string | null;
  abrirInicial?: boolean;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(abrirInicial);

  return (
    <details
      className="mt-3"
      open={aberto}
      onToggle={(e) => setAberto((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-xs font-medium text-subtle hover:text-ink">
        {titulo}
        {aviso && <span className="ml-1 text-warn">· {aviso}</span>}
      </summary>
      <div className="mt-2 space-y-2 border-l-2 border-line pl-3">{children}</div>
    </details>
  );
}
