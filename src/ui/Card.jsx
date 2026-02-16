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

  // Base “dark glass” com mais contraste (melhor leitura)
  // - fundo mais opaco
  // - borda um pouco mais clara
  // - sombra mais profunda (separa da página)
  // - um highlight no topo pra dar recorte
  const baseDefault = {
    background: "rgba(12,14,20,0.86)",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 18px 55px rgba(0,0,0,0.55)",
    backdropFilter: "blur(14px)",
  };

  const baseFlat = {
    background: "rgba(10,12,18,0.78)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "none",
    backdropFilter: "blur(12px)",
  };

  const baseSoft = {
    background:
      "linear-gradient(180deg, rgba(18,20,30,0.92) 0%, rgba(10,12,18,0.82) 100%)",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 22px 70px rgba(0,0,0,0.62)",
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
      {/* highlight superior (recorte/visibilidade) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          pointerEvents: "none",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 24%, rgba(255,255,255,0.00) 60%)",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,1) 40%, rgba(0,0,0,0))",
          opacity: variant === "flat" ? 0.55 : 0.7,
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
                  letterSpacing: 0.2,
                  color: "rgba(255,255,255,0.94)",
                  lineHeight: 1.15,
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
                  lineHeight: 1.25,
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
              "linear-gradient(90deg, rgba(255,255,255,0.00), rgba(255,255,255,0.14), rgba(255,255,255,0.00))",
            opacity: 0.9,
          }}
        />
      ) : null}

      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}
