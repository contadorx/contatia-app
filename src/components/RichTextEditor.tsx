"use client";

import {
  forwardRef,
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

// Editor de texto VISUAL (WYSIWYG), como o do Gmail: os botões formatam e o HTML
// é gerado por baixo. Um botão "HTML" abre o código cru. Zero dependência externa
// (usa o editor nativo do navegador, contentEditable). Reaproveitável em qualquer
// campo de corpo de e-mail (assinatura, cadência, envio avulso).
const RichTextEditor = forwardRef<RichTextHandle, Props>(function RichTextEditor(
  { value, onChange, minHeight = 140, placeholder, htmlToggle = true },
  ref
) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [busyImg, setBusyImg] = useState(false);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const edRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const first = useRef(toEditorHtml(value)); // conteúdo do primeiro paint
  // último valor que ESTE editor emitiu — para diferenciar "eco da digitação" de
  // "mudança externa" (modelo/IA) e nunca reescrever o DOM enquanto o usuário digita.
  const lastValue = useRef(value);

  // Ao ENTRAR no modo visual, joga o valor atual dentro do editor (vindo do HTML).
  useEffect(() => {
    if (mode === "visual" && edRef.current) {
      const norm = toEditorHtml(value);
      if (edRef.current.innerHTML !== norm) edRef.current.innerHTML = norm;
      lastValue.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Mudança EXTERNA de value (ex.: "usar modelo", IA gerou): reflete no DOM.
  // Se o value é apenas o eco do que o próprio editor acabou de emitir, ignora —
  // é isso que impedia a digitação (reescrever o DOM a cada tecla).
  useEffect(() => {
    if (mode !== "visual" || !edRef.current) return;
    if (value === lastValue.current) return; // eco da digitação → não mexe
    const norm = toEditorHtml(value);
    if (edRef.current.innerHTML !== norm) edRef.current.innerHTML = norm;
    lastValue.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function sync() {
    if (edRef.current) {
      lastValue.current = edRef.current.innerHTML;
      onChange(edRef.current.innerHTML);
    }
  }
  function exec(cmd: string, arg?: string) {
    edRef.current?.focus();
    document.execCommand(cmd, false, arg);
    sync();
  }

  useImperativeHandle(ref, () => ({
    insertText: (t: string) => {
      if (mode === "visual") {
        edRef.current?.focus();
        document.execCommand("insertText", false, t);
        sync();
      } else {
        const el = taRef.current;
        if (!el) return onChange(value + t);
        const s = el.selectionStart ?? value.length;
        const e = el.selectionEnd ?? value.length;
        onChange(value.slice(0, s) + t + value.slice(e));
        requestAnimationFrame(() => {
          el.focus();
          el.selectionStart = el.selectionEnd = s + t.length;
        });
      }
    },
    focus: () => (mode === "visual" ? edRef.current : taRef.current)?.focus(),
  }));

  function goHtml() {
    if (edRef.current) onChange(edRef.current.innerHTML);
    setMode("html");
  }
  function goVisual() {
    setMode("visual");
  }

  function addLink() {
    const u = prompt("Endereço do link (ex.: https://seusite.com.br)");
    if (u) exec("createLink", u.trim());
  }
  // Imagem: sobe o arquivo do computador para o bucket público e insere a URL.
  function addImage() {
    setImgErr(null);
    fileRef.current?.click();
  }
  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // permite reescolher o mesmo arquivo
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
      sync();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-line bg-muted/40 p-1.5">
        <div className="inline-flex overflow-hidden rounded-md border border-line text-[11px]">
          <button
            type="button"
            onClick={goVisual}
            className={`px-2 py-0.5 font-medium ${mode === "visual" ? "bg-brand text-white" : "bg-white hover:bg-muted"}`}
          >
            Visual
          </button>
          {htmlToggle && (
            <button
              type="button"
              onClick={goHtml}
              className={`px-2 py-0.5 font-medium ${mode === "html" ? "bg-brand text-white" : "bg-white hover:bg-muted"}`}
            >
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
              <button
                key={c}
                type="button"
                title="Cor do texto"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => exec("foreColor", c)}
                className="h-5 w-5 rounded-full border border-line"
                style={{ background: c }}
              />
            ))}
            <label
              className="ml-0.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-line bg-white text-xs hover:bg-muted"
              title="Outra cor"
              onMouseDown={(e) => e.preventDefault()}
            >
              +
              <input type="color" className="sr-only" onChange={(e) => exec("foreColor", e.target.value)} />
            </label>
            <Sep />
            <Tb title="Lista" onClick={() => exec("insertUnorderedList")}>• ─</Tb>
            <Tb title="Link" onClick={addLink}>🔗</Tb>
            <Tb title="Imagem/logo (subir do computador, até 512 KB)" onClick={addImage}>
              {busyImg ? "enviando…" : "🖼️"}
            </Tb>
            <Sep />
            <Tb title="Limpar formatação" onClick={() => exec("removeFormat")}>✕ formato</Tb>
          </>
        )}
      </div>
      {imgErr && <p className="mt-1 text-xs text-danger">{imgErr}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="sr-only"
        onChange={onPickImage}
      />

      {mode === "visual" ? (
        <div
          ref={edRef}
          contentEditable
          suppressContentEditableWarning
          data-ph={placeholder || ""}
          onInput={sync}
          onBlur={sync}
          style={{ minHeight }}
          className="rounded-b-lg border border-t-0 border-line bg-white p-3 text-sm leading-relaxed text-ink outline-none focus:border-brand/60 [&_a]:text-brand-dark [&_a]:underline [&_img]:inline-block [&_img]:max-w-full empty:before:text-subtle empty:before:content-[attr(data-ph)]"
          dangerouslySetInnerHTML={{ __html: first.current }}
        />
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
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // não perde a seleção do texto ao clicar
      onClick={onClick}
      className="rounded-md border border-line bg-white px-2 py-1 text-xs hover:bg-muted"
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-line" />;
}

// Reexporto para quem quiser detectar HTML sem importar o lib direto.
export { looksHtml };
