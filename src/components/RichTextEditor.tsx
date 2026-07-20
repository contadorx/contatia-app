"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { looksHtml, toEditorHtml } from "@/lib/richtext";
import { uploadBrandImage } from "@/app/dashboard/upload-actions";

const CORES = ["#16172A", "#6B7280", "#2563EB", "#059669", "#DC2626", "#D97706"];
const MAX_IMG = 512 * 1024; // 512 KB

export type RichTextHandle = { insertText: (t: string) => void; focus: () => void };

type Props = {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  placeholder?: string;
  htmlToggle?: boolean; // mostra a aba "HTML" (default: true)
};

// ============================================================
// Campo editável interno. Monta UMA vez com o HTML inicial e NUNCA re-renderiza
// (memo com comparador sempre-igual). Assim o React jamais reescreve o conteúdo
// enquanto o usuário digita — que era o bug de "apaga tudo ao digitar no Visual".
// Mudanças externas (usar modelo/IA, voltar do HTML) entram por setHtml (imperativo).
// ============================================================
type EditableHandle = { el: () => HTMLDivElement | null; getHtml: () => string; setHtml: (h: string) => void; focus: () => void };
const Editable = memo(
  forwardRef<EditableHandle, { initialHtml: string; onInput: () => void; minHeight: number; placeholder?: string }>(
    function Editable({ initialHtml, onInput, minHeight, placeholder }, ref) {
      const elRef = useRef<HTMLDivElement>(null);
      useImperativeHandle(ref, () => ({
        el: () => elRef.current,
        getHtml: () => elRef.current?.innerHTML ?? "",
        setHtml: (h: string) => { if (elRef.current && elRef.current.innerHTML !== h) elRef.current.innerHTML = h; },
        focus: () => elRef.current?.focus(),
      }));
      return (
        <div
          ref={elRef}
          contentEditable
          suppressContentEditableWarning
          data-ph={placeholder || ""}
          onInput={onInput}
          onBlur={onInput}
          style={{ minHeight }}
          className="rounded-b-lg border border-t-0 border-line bg-white p-3 text-sm leading-relaxed text-ink outline-none focus:border-brand/60 [&_a]:text-brand-dark [&_a]:underline [&_img]:inline-block [&_img]:max-w-full empty:before:text-subtle empty:before:content-[attr(data-ph)]"
          dangerouslySetInnerHTML={{ __html: initialHtml }}
        />
      );
    }
  ),
  () => true // props "sempre iguais" → o componente nunca re-renderiza
);

// Editor de texto VISUAL (WYSIWYG), como o do Gmail. Zero dependência externa.
const RichTextEditor = forwardRef<RichTextHandle, Props>(function RichTextEditor(
  { value, onChange, minHeight = 140, placeholder, htmlToggle = true },
  ref
) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [busyImg, setBusyImg] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const edRef = useRef<EditableHandle>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastValue = useRef(value);       // último HTML que ESTE editor emitiu (evita eco)
  const onChangeRef = useRef(onChange);  // sempre a versão atual de onChange
  onChangeRef.current = onChange;

  // Emite o conteúdo atual do editor para fora (estável — usa refs).
  const emit = useCallback(() => {
    const h = edRef.current?.getHtml() ?? "";
    lastValue.current = h;
    onChangeRef.current(h);
  }, []);

  // Mudança EXTERNA de value (usar modelo/IA; ou voltar do HTML) → reflete no editor.
  // Ignora o eco da própria digitação (value === lastValue).
  useEffect(() => {
    if (mode !== "visual") return;
    if (value === lastValue.current) return;
    edRef.current?.setHtml(toEditorHtml(value));
    lastValue.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode]);

  function exec(cmd: string, arg?: string) {
    edRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  }

  useImperativeHandle(ref, () => ({
    insertText: (t: string) => {
      if (mode === "visual") {
        edRef.current?.focus();
        document.execCommand("insertText", false, t);
        emit();
      } else {
        const el = taRef.current;
        if (!el) return onChangeRef.current(value + t);
        const s = el.selectionStart ?? value.length;
        const e = el.selectionEnd ?? value.length;
        onChangeRef.current(value.slice(0, s) + t + value.slice(e));
        requestAnimationFrame(() => {
          el.focus();
          el.selectionStart = el.selectionEnd = s + t.length;
        });
      }
    },
    focus: () => (mode === "visual" ? edRef.current?.focus() : taRef.current?.focus()),
  }));

  function goHtml() {
    emit(); // garante que o value reflete o que está no visual
    setMode("html");
  }
  function goVisual() {
    setMode("visual");
  }

  function addLink() {
    const u = prompt("Endereço do link (ex.: https://seusite.com.br)");
    if (u) exec("createLink", u.trim());
  }
  function addImage() {
    setImgErr(null);
    fileRef.current?.click();
  }
  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_IMG) {
      setImgErr(`Imagem muito grande (${Math.round(f.size / 1024)} KB). O limite é 512 KB.`);
      return;
    }
    setBusyImg(true);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("kind", "sig");
    const r = (await uploadBrandImage(fd)) as { url?: string; error?: string };
    setBusyImg(false);
    if (r?.error) return setImgErr(r.error);
    if (r?.url) {
      edRef.current?.focus();
      document.execCommand("insertHTML", false, `<img src="${r.url}" style="max-width:220px;height:auto">`);
      emit();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-line bg-muted/40 p-1.5">
        <div className="inline-flex overflow-hidden rounded-md border border-line text-[11px]">
          <button type="button" onClick={goVisual} className={`px-2 py-0.5 font-medium ${mode === "visual" ? "bg-brand text-white" : "bg-white hover:bg-muted"}`}>
            Visual
          </button>
          {htmlToggle && (
            <button type="button" onClick={goHtml} className={`px-2 py-0.5 font-medium ${mode === "html" ? "bg-brand text-white" : "bg-white hover:bg-muted"}`}>
              HTML
            </button>
          )}
        </div>

        {mode === "visual" && (
          <>
            <Sep />
            <Tb title="Negrito" onClick={() => exec("bold")}><b>B</b></Tb>
            <Tb title="Itálico" onClick={() => exec("italic")}><i>I</i></Tb>
            <Tb title="Sublinhado" onClick={() => exec("underline")}><u>S</u></Tb>
            <Sep />
            <Tb title="Diminuir" onClick={() => exec("fontSize", "2")}>A−</Tb>
            <Tb title="Normal" onClick={() => exec("fontSize", "3")}>A</Tb>
            <Tb title="Aumentar" onClick={() => exec("fontSize", "5")}><span className="text-sm">A+</span></Tb>
            <Sep />
            {CORES.map((c) => (
              <button key={c} type="button" title="Cor do texto" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("foreColor", c)} className="h-5 w-5 rounded-full border border-line" style={{ background: c }} />
            ))}
            <label className="ml-0.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-line bg-white text-xs hover:bg-muted" title="Outra cor" onMouseDown={(e) => e.preventDefault()}>
              +
              <input type="color" className="sr-only" onChange={(e) => exec("foreColor", e.target.value)} />
            </label>
            <Sep />
            <Tb title="Lista" onClick={() => exec("insertUnorderedList")}>• ─</Tb>
            <Tb title="Link" onClick={addLink}>🔗</Tb>
            <Tb title="Imagem/logo (subir do computador, até 512 KB)" onClick={addImage}>{busyImg ? "enviando…" : "🖼️"}</Tb>
            <Sep />
            <Tb title="Limpar formatação" onClick={() => exec("removeFormat")}>✕ formato</Tb>
          </>
        )}
      </div>
      {imgErr && <p className="mt-1 text-xs text-danger">{imgErr}</p>}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="sr-only" onChange={onPickImage} />

      {mode === "visual" ? (
        <Editable ref={edRef} initialHtml={toEditorHtml(value)} onInput={emit} minHeight={minHeight} placeholder={placeholder} />
      ) : (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ minHeight }}
          className="input rounded-t-none font-mono text-xs"
        />
      )}
    </div>
  );
});

export default RichTextEditor;

function Tb({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="rounded-md border border-line bg-white px-2 py-1 text-xs hover:bg-muted">
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-line" />;
}

export { looksHtml };
