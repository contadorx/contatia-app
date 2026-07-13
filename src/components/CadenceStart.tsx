"use client";

import { useState } from "react";
import SequenceBuilder from "@/components/SequenceBuilder";
import { TemplateGallery } from "@/components/TemplateGallery";

type Template = { id: string; name: string; audience: string | null; description: string | null; steps: any[]; is_global: boolean };
type ProductOpt = { id: string; name: string };
type AccountOpt = { id: string; from_email: string; display_name?: string | null };

// Entrada única "Começar": três caminhos claros (do zero / com IA / template).
// Ao escolher, revela o construtor certo; ao terminar/cancelar, volta às opções.
export default function CadenceStart({ templates, products = [], accounts = [] }: { templates: Template[]; products?: ProductOpt[]; accounts?: AccountOpt[] }) {
  const [mode, setMode] = useState<"idle" | "scratch" | "ai" | "template">("idle");
  const back = () => setMode("idle");

  if (mode === "scratch") return <SequenceBuilder autoOpen onDone={back} products={products} accounts={accounts} />;
  if (mode === "ai") return <SequenceBuilder autoOpen autoAi onDone={back} products={products} accounts={accounts} />;
  if (mode === "template") return <TemplateGallery templates={templates} autoOpen onDone={back} />;

  const opts: { key: "scratch" | "ai" | "template"; icon: string; title: string; desc: string }[] = [
    { key: "ai", icon: "✨", title: "Com IA", desc: "Descreva seu mercado e a IA monta os passos — você revisa antes de salvar." },
    { key: "scratch", icon: "✍️", title: "Do zero", desc: "Monte os passos você mesmo, no seu jeito." },
    { key: "template", icon: "📋", title: `A partir de um template (${templates.length})`, desc: "Clone um acervo pronto e ajuste." },
  ];

  return (
    <div>
      <p className="mb-3 text-sm font-semibold">Começar uma cadência</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {opts.map((o) => (
          <button
            key={o.key}
            onClick={() => setMode(o.key)}
            className="rounded-xl border border-line bg-surface p-4 text-left transition hover:border-brand hover:bg-brand-soft/30"
          >
            <p className="font-display text-base font-bold"><span aria-hidden className="mr-1">{o.icon}</span>{o.title}</p>
            <p className="mt-1 text-xs text-subtle">{o.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
