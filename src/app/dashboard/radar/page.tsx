import RadarBusca from "@/components/RadarBuscarBase";
import { createClient } from "@/lib/supabase/server";
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

export default async function Radar() {
  // As tags que já existem, para o campo sugerir em vez de obrigar a digitar de novo.
  // A página virou async só por isto — é uma consulta pequena e a RLS já a recorta.
  const supabase = createClient();
  const { data: tagsRows } = await supabase.from("tags").select("name").order("name");
  const tagsExistentes = ((tagsRows as any[]) || []).map((t) => t.name as string);

  // O Radar está incluído em TODOS os planos (Individual e Equipes) — sem gate.
  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Radar</h1>
      <p className="mt-1 text-sm text-subtle">
        Busque empresas na base da Receita por atividade e região, selecione e envie direto para Empresas e Contatos — já com e-mail, telefone e dados cadastrais.
      </p>

      <div className="mt-6">
        <RadarBusca configurada={receitaConfigurada()} tagsExistentes={tagsExistentes} />
      </div>
    </div>
  );
}
