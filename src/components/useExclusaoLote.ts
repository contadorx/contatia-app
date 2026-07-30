"use client";

// ============================================================
// Exclusão em massa que CONTINUA sozinha até acabar.
//
// O problema que isto resolve: a função da Vercel morre aos 60 segundos. Apagando uma
// base grande, ela era morta no meio — na prática parava por volta de 4.000 e a tela
// nem sempre dizia por quê. O servidor agora sai limpo aos 40s devolvendo "saíram X,
// faltam Y"; quem insiste é esta função, chamando de novo até `restam` zerar.
//
// Por que não deixar tudo no servidor: não dá. O teto de tempo é da plataforma, não do
// nosso código. A alternativa honesta é dividir em voltas curtas e mostrar o progresso.
//
// Cada volta reenvia como confirmação o total que SOBROU — por isso a trava do servidor
// só recusa quando o conjunto CRESCE (encolher é o esperado aqui).
// ============================================================

import { useCallback, useRef, useState } from "react";

export type VoltaExclusao = {
  excluidos: number;
  restam: number;
  error?: string;
  aviso?: string;
};

// Rede de segurança, não limite real: 200 voltas × 20.000 por volta = 4 milhões.
const MAX_VOLTAS = 200;

export function useExclusaoLote() {
  const [rodando, setRodando] = useState(false);
  const [feitos, setFeitos] = useState(0);
  const [alvo, setAlvo] = useState(0);
  const pararRef = useRef(false);

  const parar = useCallback(() => { pararRef.current = true; }, []);

  const rodar = useCallback(
    async (
      totalInicial: number,
      umaVolta: (confirmar: number) => Promise<VoltaExclusao>
    ): Promise<{ total: number; restam: number; erro?: string; aviso?: string; parado?: boolean }> => {
      pararRef.current = false;
      setRodando(true);
      setFeitos(0);
      setAlvo(totalInicial);

      let total = 0;
      let restam = totalInicial;
      let erro: string | undefined;
      let aviso: string | undefined;
      let parado = false;

      try {
        for (let volta = 0; volta < MAX_VOLTAS; volta++) {
          const r = await umaVolta(restam);
          if (r.error) { erro = r.error; break; }
          if (r.aviso) aviso = r.aviso;

          total += r.excluidos || 0;
          restam = r.restam ?? 0;
          setFeitos(total);

          if (!restam) break;
          // Nada saiu mas ainda sobra: insistir viraria laço infinito (RLS barrando,
          // ou o filtro pegando linha que o delete não alcança). Para e avisa.
          if (!r.excluidos) {
            erro = "A exclusão parou de avançar — nada saiu nesta volta. Confira em Resultados → Registro antes de repetir.";
            break;
          }
          if (pararRef.current) { parado = true; break; }
        }
      } catch (e: any) {
        erro =
          `Interrompido: ${e?.message || "falha de conexão"}. ` +
          `Parte pode ter saído — confira em Resultados → Registro antes de repetir.`;
      } finally {
        setRodando(false);
      }

      return { total, restam, erro, aviso, parado };
    },
    []
  );

  return { rodando, feitos, alvo, parar, rodar };
}
