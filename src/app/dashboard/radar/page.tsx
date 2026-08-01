import RadarBusca from "@/components/RadarBuscarBase";
import { receitaConfigurada } from "@/lib/receita";

export const dynamic = "force-dynamic";
// ============================================================
// POR QUE 60 SEGUNDOS
//
// A busca por ATIVIDADE SEM ESTADO varre a base inteira (62 milhões de
// estabelecimentos) — e a CONTAGEM de resultados, que é feita junto, é ainda mais cara
// que a página em si. O cliente da API já esperava 25s, mas a FUNÇÃO da Vercel morria
// antes disso no limite padrão, e a busca voltava como erro genérico.
//
// Server Actions herdam o maxDuration do segmento de rota, então isto vale para
// buscarNaBase e para o envio em lote do Radar.
// ============================================================
export const maxDuration = 60;

export default function Radar() {
  // O Radar está incluído em TODOS os planos (Individual e Equipes) — sem gate.
  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Radar</h1>
      <p className="mt-1 text-sm text-subtle">
        Busque empresas na base da Receita por atividade e região, selecione e envie direto para Empresas e Contatos — já com e-mail, telefone e dados cadastrais.
      </p>

      <div className="mt-6">
        <RadarBusca configurada={receitaConfigurada()} />
      </div>
    </div>
  );
}
