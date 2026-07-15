import RadarBusca from "@/components/RadarBuscarBase";
import { receitaConfigurada } from "@/lib/receita";

export const dynamic = "force-dynamic";

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
