import { redirect } from "next/navigation";

// Métricas foi fundida na tela de Resultados (aba "Visão geral"). Este redirect
// mantém links e atalhos antigos funcionando. (goal-actions.ts continua aqui.)
export default function Metricas() {
  redirect("/dashboard/relatorios");
}
