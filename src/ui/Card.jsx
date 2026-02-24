// src/ui/Card.jsx
/*eslint-disable*/
import React from "react";

export default function Card({
  children,
  style,

  // novos (opcionais)
  title,
  subtitle,
  actions, // JSX (botões etc)
  variant = "default", // default | flat | soft
  padding = "md", // sm | md | lg
  compact = false,
  divider = true,

  className = "",
}) {
  const pad = compact || padding === "sm" ? 12 : padding === "lg" ? 18 : 14;
  const radius = 18;

  /**
   * ✅ Ajuste principal:
   * - fundo mais “sólido” (menos transparente)
   * - borda mais presente
   * - inner stroke (borda interna) + leve glow pra destacar
   * - highlight mais controlado (pra não parecer “lavado”)
   */

  const baseDefault = {
    background: "rgba(10,12,18,0.90)", // ↑ mais sólido (antes 0.86)
    border: "1px solid rgba(255,255,255,0.16)", // ↑ mais presente
    boxShadow: "0 20px 60px rgba(0,0,0,0.62)", // ↑ separa do fundo
    backdropFilter: "blur(14px)",
  };

  const baseFlat = {
    background: "rgba(10,12,18,0.86)", // ↑
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.38)", // antes none: sem sombra some demais
    backdropFilter: "blur(12px)",
  };

  const baseSoft = {
    background:
      "linear-gradient(180deg, rgba(16,18,28,0.94) 0%, rgba(10,12,18,0.88) 100%)",
    border: "1px solid rgba(255,255,255,0.16)",
    boxShadow: "0 24px 78px rgba(0,0,0,0.68)",
    backdropFilter: "blur(14px)",
  };

  const base = variant === "flat" ? baseFlat : variant === "soft" ? baseSoft : baseDefault;

  const hasHeader = Boolean(title || subtitle || actions);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        borderRadius: radius,
        padding: pad,
        ...base,
        ...style,
      }}
    >
      {/* ✅ Inner stroke (borda interna) — dá recorte e tira aspecto “transparente demais” */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          pointerEvents: "none",
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)",
          opacity: 1,
        }}
      />

      {/* ✅ Highlight superior (mais controlado) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          pointerEvents: "none",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 22%, rgba(255,255,255,0.00) 60%)",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,1) 36%, rgba(0,0,0,0))",
          opacity: variant === "flat" ? 0.45 : 0.60, // ↓ menos “lavado”
        }}
      />

      {/* ✅ Glow sutil pra separar do fundo (bem Vero, sem exagero) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: -1,
          borderRadius: radius + 1,
          pointerEvents: "none",
          background:
            "radial-gradient(800px 220px at 15% 0%, rgba(99,102,241,0.14), transparent 60%), radial-gradient(700px 200px at 85% 0%, rgba(14,165,233,0.10), transparent 60%)",
          opacity: variant === "flat" ? 0.35 : 0.55,
          filter: "blur(10px)",
        }}
      />

      {hasHeader ? (
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            {title ? (
              <div
                style={{
                  fontWeight: 950,
                  fontSize: 14,
                  letterSpacing: -0.2,
                  color: "rgba(255,255,255,0.94)",
                  lineHeight: 1.2,
                  marginBottom: subtitle ? 4 : 0,
                }}
              >
                {title}
              </div>
            ) : null}

            {subtitle ? (
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.72)",
                  lineHeight: 1.3,
                }}
              >
                {subtitle}
              </div>
            ) : null}
          </div>

          {actions ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasHeader && divider ? (
        <div
          style={{
            position: "relative",
            height: 1,
            marginTop: 12,
            marginBottom: 12,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.00), rgba(255,255,255,0.16), rgba(255,255,255,0.00))",
            opacity: 0.9,
          }}
        />
      ) : null}

      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}