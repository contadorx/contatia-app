"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SmartOption = { value: string; label: string; disabled?: boolean };

type BaseProps = {
  options: SmartOption[];
  placeholder?: string;
  searchable?: boolean;        // padrão: true
  disabled?: boolean;
  required?: boolean;          // só relevante no modo form (name)
  className?: string;          // classes extras no botão
  name?: string;               // se presente, renderiza <input hidden> p/ <form action>
  emptyText?: string;          // texto quando a busca não acha nada
  clearable?: boolean;         // single: permite limpar a seleção
};

type SingleProps = BaseProps & {
  multiple?: false;
  value?: string;              // controlado
  defaultValue?: string;       // form / não-controlado
  onValueChange?: (v: string) => void;
};

type MultiProps = BaseProps & {
  multiple: true;
  values?: string[];           // controlado
  defaultValues?: string[];    // não-controlado
  onValuesChange?: (v: string[]) => void;
  maxTagsShown?: number;
};

type Props = SingleProps | MultiProps;

// SmartSelect — seletor único com BUSCA, e opcionalmente MÚLTIPLA seleção.
// - Modo controlado: passe value/onValueChange (single) ou values/onValuesChange (multi).
// - Modo formulário: passe name (+ defaultValue/defaultValues) e ele renderiza input(s)
//   hidden, então FormData funciona igual a um <select>. No multi, cada valor vira um
//   input hidden → formData.getAll(name) devolve o array.
// Sem dependências externas; nada de storage do browser.
export default function SmartSelect(props: Props) {
  const {
    options, placeholder = "Selecionar…", searchable = true, disabled, required,
    className = "", name, emptyText = "Nada encontrado", clearable,
  } = props;
  const multiple = props.multiple === true;

  const seedSingle = () =>
    (props as SingleProps).value ?? (props as SingleProps).defaultValue ?? "";
  const seedMulti = () =>
    (props as MultiProps).values ?? (props as MultiProps).defaultValues ?? [];

  const [sel, setSel] = useState<string[]>(multiple ? seedMulti() : (seedSingle() ? [seedSingle()] : []));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0); // índice destacado
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // sincroniza quando controlado por fora
  useEffect(() => {
    if (multiple && (props as MultiProps).values) setSel((props as MultiProps).values as string[]);
  }, [multiple, (props as MultiProps).values]);
  useEffect(() => {
    if (!multiple && (props as SingleProps).value !== undefined) {
      const v = (props as SingleProps).value as string;
      setSel(v ? [v] : []);
    }
  }, [multiple, (props as SingleProps).value]);

  // fecha ao clicar fora / Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && searchable) inputRef.current?.focus();
    if (!open) { setQuery(""); setHi(0); }
  }, [open, searchable]);

  const byValue = useMemo(() => {
    const m: Record<string, SmartOption> = {};
    for (const o of options) m[o.value] = o;
    return m;
  }, [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  function commitSingle(v: string) {
    setSel(v ? [v] : []);
    (props as SingleProps).onValueChange?.(v);
    setOpen(false);
  }
  function toggleMulti(v: string) {
    setSel((prev) => {
      const next = prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
      (props as MultiProps).onValuesChange?.(next);
      return next;
    });
  }
  function choose(o: SmartOption) {
    if (o.disabled) return;
    if (multiple) toggleMulti(o.value);
    else commitSingle(o.value);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      setOpen(true); e.preventDefault(); return;
    }
    if (!open) return;
    if (e.key === "Escape") { setOpen(false); e.preventDefault(); }
    else if (e.key === "ArrowDown") { setHi((h) => Math.min(h + 1, filtered.length - 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setHi((h) => Math.max(h - 1, 0)); e.preventDefault(); }
    else if (e.key === "Enter") {
      const o = filtered[hi];
      if (o) { choose(o); if (!multiple) e.preventDefault(); }
      e.preventDefault();
    }
  }

  const maxTags = (props as MultiProps).maxTagsShown ?? 3;
  const label = (() => {
    if (!sel.length) return <span className="text-subtle">{placeholder}</span>;
    if (!multiple) return <span className="truncate">{byValue[sel[0]]?.label ?? sel[0]}</span>;
    const shown = sel.slice(0, maxTags);
    return (
      <span className="flex flex-wrap gap-1">
        {shown.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-xs text-brand-dark">
            {byValue[v]?.label ?? v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleMulti(v); }}
              className="text-brand-dark/60 hover:text-danger"
              aria-label={`Remover ${byValue[v]?.label ?? v}`}
            >×</button>
          </span>
        ))}
        {sel.length > maxTags && <span className="text-xs text-subtle">+{sel.length - maxTags}</span>}
      </span>
    );
  })();

  return (
    <div ref={rootRef} className="relative">
      {/* inputs hidden p/ FormData quando em modo form (name) */}
      {name && (multiple
        ? sel.map((v) => <input key={v} type="hidden" name={name} value={v} />)
        : <input type="hidden" name={name} value={sel[0] ?? ""} required={required} />
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`input mt-0 flex min-h-[2.5rem] w-full items-center justify-between gap-2 text-left ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${className}`}
      >
        <span className="min-w-0 flex-1 overflow-hidden">{label}</span>
        <span className="flex shrink-0 items-center gap-1">
          {clearable && !multiple && sel.length > 0 && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); commitSingle(""); }}
              className="text-subtle hover:text-danger"
              aria-label="Limpar"
            >×</span>
          )}
          <span className="text-subtle" aria-hidden>▾</span>
        </span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
          role="listbox"
          id={listboxId}
          aria-multiselectable={multiple}
        >
          {searchable && (
            <div className="border-b border-line p-2">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHi(0); }}
                onKeyDown={onKeyDown}
                placeholder="Buscar…"
                className="input h-9 w-full text-sm"
              />
            </div>
          )}
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-subtle">{emptyText}</li>
            )}
            {filtered.map((o, i) => {
              const active = sel.includes(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    disabled={o.disabled}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => choose(o)}
                    role="option"
                    aria-selected={active}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${o.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"} ${i === hi ? "bg-muted" : ""} ${active ? "font-medium text-brand-dark" : "text-ink"}`}
                  >
                    {multiple && (
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? "border-brand bg-brand text-white" : "border-line"}`}>
                        {active ? "✓" : ""}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {!multiple && active && <span className="text-brand" aria-hidden>✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {multiple && (
            <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-xs text-subtle">
              <span>{sel.length} selecionado(s)</span>
              <button type="button" className="hover:text-ink" onClick={() => setOpen(false)}>Fechar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
