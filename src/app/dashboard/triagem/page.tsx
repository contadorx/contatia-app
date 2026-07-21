import { redirect } from "next/navigation";

// A Triagem foi fundida na caixa de Respostas: a barra de decisão agora vive dentro
// da conversa. Este redirect mantém links/atalhos antigos funcionando.
export default function Triagem() {
  redirect("/dashboard/respostas");
}
