// src/ui/Select.jsx
/*eslint-disable*/
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Select custom (dark) para substituir o <select> nativo
 * - Mantém compatibilidade com onChange(e) -> e.target.value
 * - Aceita options=[{value,label,disabled}] OU children <option>
 * - Suporta keyboard: ↑ ↓ Enter Esc / Home / End
 * - Fecha ao clicar fora
 * - Busca opcional: searchable
 * - Renderiza menu em PORTAL (não corta por overflow do Card/Modal)
 */

function nowMs() {
  return Date.now();
}

function safeStr(v) {
  return String(v ?? "");
}

function normalizeOptions({ options, children }) {
  const out = [];

  if (Array.isArray(options) && options.length) {
    for (const o of options) {
      if (!o) continue;
      out.push({
        value: safeStr(o.value),
        label: safeStr(o.label ?? o.value),
        disabled: Boolean(o.disabled),
      });
    }
    return out;
  }

  // children <option>
  const kids = React.Children.toArray(children);
  for (const k of kids) {
    if (!React.isValidElement(k)) continue;
    if (String(k.type) !== "option") continue;
    out.push({
      value: safeStr(k.props?.value),
      label: safeStr(k.props?.children ?? k.props?.value),
      disabled: Boolean(k.props?.disabled),
    });
  }
  return out;
}

function emitOnChange(onChange, nextValue) {
  if (typeof onChange !== "function") return;
  // imita event do select
  onChange({ target: { value: nextValue } });
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function useRafState(initial) {
  const [v, setV] = useState(initial);
  const rafRef = useRef(null);
  const set = (next) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setV(next));
  };
  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);
  return [v, set];
}

function Chevron({ open, dim }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      style={{ opacity: dim ? 0.45 : 0.85, transition: "transform 160ms ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
      aria-hidden
    >
      <path
        d="M7 10l5 5 5-5"
        stroke="rgba(229,231,235,0.92)"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Calcula posição do menu em relação ao botão.
 * Abre para baixo, mas se não couber abre para cima.
 */
function computeMenuRect(btnEl, desiredMaxH = 280, gap = 8) {
  const r = btnEl.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;

  const left = clamp(r.left, 8, Math.max(8, vw - r.width - 8));
  const width = clamp(r.width, 220, Math.max(220, vw - 16));

  const spaceBelow = vh - r.bottom - gap - 8;
  const spaceAbove = r.top - gap - 8;

  const openUp = spaceBelow < 220 && spaceAbove > spaceBelow; // heurística
  const maxH = clamp(desiredMaxH, 180, openUp ? spaceAbove : spaceBelow);

  const top = openUp ? Math.max(8, r.top - gap - maxH) : Math.min(vh - 8 - maxH, r.bottom + gap);

  return { top, left, width, maxH, openUp };
}

export default function Select({
  label,
  value,
  onChange,

  options = [],
  children,

  placeholder = "Selecione…",
  searchable = false,
  disabled = false,
  size = "md", // sm | md | lg
  helper,
  error,
  style,
  fullWidth = true,
  id,

  leftIcon,
  rightSlot,

  // portal config
  portal = true,
  menuMaxHeight = 280,

  ...props
}) {
  const rid = useId();
  const inputId = id || `select_${rid}`;

  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const [menuRect, setMenuRect] = useRafState({ top: 0, left: 0, width: 0, maxH: menuMaxHeight, openUp: false });

  const norm = useMemo(() => normalizeOptions({ options, children }), [options, children]);
  const val = safeStr(value);

  const current = useMemo(() => norm.find((o) => o.value === val) || null, [norm, val]);

  const filtered = useMemo(() => {
    const needle = safeStr(q).trim().toLowerCase();
    if (!searchable || !needle) return norm;
    return norm.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle));
  }, [norm, q, searchable]);

  // sizing
  const h = size === "sm" ? 38 : size === "lg" ? 46 : 42;
  const radius = 14;

  const border = error ? "rgba(239,68,68,0.60)" : open ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.14)";
  const bg = disabled ? "rgba(0,0,0,0.18)" : open ? "rgba(0,0,0,0.40)" : "rgba(0,0,0,0.30)";

  // fecha ao clicar fora (capture para pegar antes do React em alguns casos)
  useEffect(() => {
    function onDown(e) {
      if (!open) return;
      const root = rootRef.current;
      const menu = listRef.current;
      const t = e.target;
      if (root && root.contains(t)) return;
      if (menu && menu.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("touchstart", onDown, { passive: true, capture: true });
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("touchstart", onDown, true);
    };
  }, [open]);

  // recalcula posição quando abre / resize / scroll
  useEffect(() => {
    if (!open) return;

    const btn = btnRef.current;
    if (!btn) return;

    const recalc = () => {
      const r = computeMenuRect(btn, menuMaxHeight, 8);
      setMenuRect(r);
    };

    recalc();

    const onScroll = () => recalc();
    const onResize = () => recalc();

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    // também recalcula 2x (fonts/layout)
    const t1 = setTimeout(recalc, 0);
    const t2 = setTimeout(recalc, 80);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [open, menuMaxHeight, setMenuRect]);

  // reset busca ao fechar
  useEffect(() => {
    if (!open) {
      setQ("");
      setActiveIdx(0);
      return;
    }

    // ao abrir, ativa item selecionado (ou primeiro)
    const idx = Math.max(
      0,
      filtered.findIndex((o) => o.value === val && !o.disabled)
    );
    setActiveIdx(idx >= 0 ? idx : 0);

    // foca lista
    setTimeout(() => {
      try {
        listRef.current?.focus?.();
      } catch {}
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // garante activeIdx dentro
  useEffect(() => {
    if (activeIdx < 0) setActiveIdx(0);
    if (activeIdx > filtered.length - 1) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIdx]);

  // scroll para active
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const row = el.querySelector?.(`[data-idx="${activeIdx}"]`);
    if (row && row.scrollIntoView) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx, open]);

  function pick(nextValue) {
    emitOnChange(onChange, nextValue);
    setOpen(false);
  }

  function moveActive(delta) {
    if (!filtered.length) return;
    let i = activeIdx;
    const start = i;
    for (let step = 0; step < filtered.length; step++) {
      i = clamp(i + delta, 0, filtered.length - 1);
      if (!filtered[i]?.disabled) {
        setActiveIdx(i);
        return;
      }
      if (i === 0 || i === filtered.length - 1) break;
    }
    setActiveIdx(start);
  }

  function onKeyDown(e) {
    if (disabled) return;

    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(+1);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(Math.max(0, filtered.length - 1));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[activeIdx];
      if (opt && !opt.disabled) pick(opt.value);
      return;
    }
  }

  const wrapStyle = useMemo(
    () => ({
      display: "grid",
      gap: 6,
      width: fullWidth ? "100%" : undefined,
      minWidth: 0,
      ...style,
    }),
    [fullWidth, style]
  );

  const labelEl = label ? (
    <label
      htmlFor={inputId}
      style={{
        fontSize: 12,
        lineHeight: "14px",
        fontWeight: 800,
        color: "rgba(255,255,255,0.72)",
        letterSpacing: 0.2,
        userSelect: "none",
        marginBottom: 2,
      }}
    >
      {label}
    </label>
  ) : null;

  const buttonEl = (
    <button
      id={inputId}
      ref={btnRef}
      type="button"
      disabled={disabled}
      onClick={() => !disabled && setOpen((v) => !v)}
      onKeyDown={onKeyDown}
      aria-haspopup="listbox"
      aria-expanded={open ? "true" : "false"}
      style={{
        width: "100%",
        height: h,
        borderRadius: radius,
        border: `1px solid ${border}`,
        background: bg,
        color: disabled ? "rgba(229,231,235,0.65)" : "#e5e7eb",
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: open
          ? "0 0 0 4px rgba(99,102,241,0.14)"
          : error
          ? "0 0 0 4px rgba(239,68,68,0.10)"
          : "inset 0 1px 0 rgba(255,255,255,0.06)",
        backdropFilter: "blur(10px)",
        transition: "border-color 160ms ease, box-shadow 160ms ease, background 160ms ease",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
        {leftIcon ? (
          <span style={{ opacity: 0.85, display: "grid", placeItems: "center" }}>{leftIcon}</span>
        ) : null}

        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: size === "sm" ? 13 : 14,
            fontWeight: 800,
            letterSpacing: 0.1,
            opacity: current ? 1 : 0.65,
          }}
        >
          {current ? current.label : placeholder}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {rightSlot ? <span>{rightSlot}</span> : null}
        <Chevron open={open} dim={disabled} />
      </div>
    </button>
  );

  const menuEl = open ? (
    <div
      ref={listRef}
      tabIndex={-1}
      role="listbox"
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        top: menuRect.top,
        left: menuRect.left,
        width: menuRect.width,
        zIndex: 99999,

        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(10,12,18,0.97)",
        boxShadow: "0 22px 70px rgba(0,0,0,0.60)",
        backdropFilter: "blur(14px)",
        overflow: "hidden",
      }}
    >
      {searchable ? (
        <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar..."
            style={{
              width: "100%",
              height: 40,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "#e5e7eb",
              padding: "0 10px",
              outline: "none",
            }}
          />
        </div>
      ) : null}

      <div style={{ maxHeight: menuRect.maxH, overflow: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.72, fontSize: 13 }}>Nada encontrado.</div>
        ) : (
          filtered.map((o, idx) => {
            const selected = o.value === val;
            const active = idx === activeIdx;

            return (
              <button
                key={`${o.value}_${idx}`}
                data-idx={idx}
                type="button"
                role="option"
                aria-selected={selected ? "true" : "false"}
                disabled={o.disabled}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(e) => e.preventDefault()} // evita blur/click fora
                onClick={() => !o.disabled && pick(o.value)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  outline: "none",
                  background: active
                    ? "rgba(99,102,241,0.18)"
                    : selected
                    ? "rgba(255,255,255,0.08)"
                    : "transparent",
                  color: o.disabled ? "rgba(229,231,235,0.45)" : "#e5e7eb",
                  cursor: o.disabled ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  fontSize: 14,
                  fontWeight: selected ? 900 : 700,
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {o.label}
                </span>
                {selected ? <span style={{ opacity: 0.95 }}>✓</span> : <span style={{ opacity: 0.25 }}>•</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} style={wrapStyle} {...props}>
      {labelEl}
      <div style={{ position: "relative" }}>
        {buttonEl}

        {/* Portal para não ser cortado por overflow */}
        {open ? (portal ? createPortal(menuEl, document.body) : menuEl) : null}
      </div>

      {error ? (
        <div style={{ fontSize: 12, color: "rgba(248,113,113,0.95)", lineHeight: 1.25 }}>
          {String(error)}
        </div>
      ) : helper ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", lineHeight: 1.25 }}>
          {String(helper)}
        </div>
      ) : null}
    </div>
  );
}
