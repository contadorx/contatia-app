"use client";

import { useMemo, useState, type ReactNode } from "react";

// ============================================================
// CENTRAL DE AJUDA (voltada ao usuário)
//
// Antes: os artigos da base de conhecimento só existiam no painel do superadmin
// e alimentavam o chat de IA — o cliente não tinha como navegar nem buscar.
//
// Agora: busca instantânea (sem ida ao servidor — os artigos publicados já vêm
// carregados), navegação por TEMAS (a categoria de cada artigo) e leitura em
// acordeão. É a base virando instrumento de autoatendimento.
// ============================================================

type Article = { id: string; title: string; category: string; keywords?: string; body: string };

// normaliza para busca: tira acento e caixa ("Cadência" → "cadencia")
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---- render do corpo do artigo (texto simples com markdown-lite, seguro) ----
function renderInline(text: string, kp: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(https?:\/\/[^\s]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      nodes.push(<strong key={`${kp}-b${i}`}>{m[1].slice(2, -2)}</strong>);
    } else if (m[2]) {
      const url = m[2].replace(/[.,)]+$/, "");
      nodes.push(
        <a key={`${kp}-a${i}`} href={url} target="_blank" rel="noreferrer" className="text-brand-dark underline hover:text-brand">
          {url}
        </a>
      );
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function ArticleBody({ body }: { body: string }) {
  const lines = (body || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = () => {
    if (para.length) {
      const k = blocks.length;
      blocks.push(
        <p key={`p${k}`} className="mt-3 text-sm leading-relaxed text-ink/90">
          {renderInline(para.join(" "), `p${k}`)}
        </p>
      );
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      const k = blocks.length;
      blocks.push(
        <ul key={`u${k}`} className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink/90">
          {bullets.map((b, j) => (
            <li key={j}>{renderInline(b, `u${k}-${j}`)}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      flushPara();
      flushBullets();
      continue;
    }
    if (/^#{1,6}\s+/.test(t)) {
      flushPara();
      flushBullets();
      const k = blocks.length;
      blocks.push(
        <h3 key={`h${k}`} className="mt-4 font-display text-base font-bold text-ink">
          {renderInline(t.replace(/^#{1,6}\s+/, ""), `h${k}`)}
        </h3>
      );
    } else if (/^[-*•]\s+/.test(t)) {
      flushPara();
      bullets.push(t.replace(/^[-*•]\s+/, ""));
    } else {
      flushBullets();
      para.push(t);
    }
  }
  flushPara();
  flushBullets();
  return <div className="mt-1">{blocks}</div>;
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-full border px-3 py-1 text-xs font-medium transition",
        active ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:border-brand hover:text-brand-dark",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ArticleCard({ a, open, onToggle, showCat }: { a: Article; open: boolean; onToggle: () => void; showCat?: boolean }) {
  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-muted/50">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{a.title}</span>
          {showCat && <span className="mt-0.5 block text-[11px] text-subtle">{a.category || "Geral"}</span>}
        </span>
        <span className={`shrink-0 text-lg leading-none text-subtle transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ›
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-4 pb-4">
          <ArticleBody body={a.body} />
        </div>
      )}
    </div>
  );
}

export function KbCenter({ articles }: { articles: Article[] }) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      const c = a.category || "Geral";
      m.set(c, (m.get(c) || 0) + 1);
    }
    return Array.from(m.entries()).map(([name, count]) => ({ name, count }));
  }, [articles]);

  const q = norm(query.trim());

  const filtered = useMemo(() => {
    if (q) return articles.filter((a) => norm(`${a.title} ${a.category} ${a.keywords || ""} ${a.body}`).includes(q));
    if (cat) return articles.filter((a) => (a.category || "Geral") === cat);
    return articles;
  }, [articles, q, cat]);

  const grouped = useMemo(() => {
    const g = new Map<string, Article[]>();
    for (const a of filtered) {
      const c = a.category || "Geral";
      if (!g.has(c)) g.set(c, []);
      g.get(c)!.push(a);
    }
    return Array.from(g.entries());
  }, [filtered]);

  if (!articles.length) {
    return (
      <div className="card mt-6 p-8 text-center text-sm text-subtle">
        A base de conhecimento ainda está sendo montada. Enquanto isso, use o botão de ajuda (?) no canto da tela ou{" "}
        <a href="/dashboard/suporte" className="text-brand-dark underline">
          abra um chamado
        </a>
        .
      </div>
    );
  }

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  return (
    <div className="mt-6">
      {/* BUSCA */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">🔎</span>
        <input
          className="input w-full pl-9"
          placeholder="Buscar na ajuda (ex.: cadência, e-mail, importar…)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenId(null);
          }}
          autoFocus
        />
        {query && (
          <button className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle hover:text-ink" onClick={() => setQuery("")}>
            limpar
          </button>
        )}
      </div>

      {/* TEMAS (somem durante a busca) */}
      {!q && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Pill active={cat === null} onClick={() => setCat(null)}>
            Todos <span className="opacity-60">{articles.length}</span>
          </Pill>
          {cats.map((c) => (
            <Pill key={c.name} active={cat === c.name} onClick={() => setCat(c.name)}>
              {c.name} <span className="opacity-60">{c.count}</span>
            </Pill>
          ))}
        </div>
      )}

      {/* RESULTADOS */}
      {q ? (
        <div className="mt-5">
          <p className="mb-2 text-xs text-subtle">
            {filtered.length} {filtered.length === 1 ? "resultado" : "resultados"} para “{query.trim()}”
          </p>
          {filtered.length ? (
            <div className="space-y-2">
              {filtered.map((a) => (
                <ArticleCard key={a.id} a={a} open={openId === a.id} onToggle={() => toggle(a.id)} showCat />
              ))}
            </div>
          ) : (
            <div className="card p-6 text-center text-sm text-subtle">
              Nada encontrado para esse termo. Tente outra palavra ou{" "}
              <a href="/dashboard/suporte" className="text-brand-dark underline">
                abra um chamado
              </a>
              .
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {grouped.map(([category, arts]) => (
            <div key={category}>
              {!cat && <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-subtle">{category}</h2>}
              <div className="space-y-2">
                {arts.map((a) => (
                  <ArticleCard key={a.id} a={a} open={openId === a.id} onToggle={() => toggle(a.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
