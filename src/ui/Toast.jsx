// src/ui/Toast.jsx
import React from "react";

export default function Toast({ children, tone = "bad", style }) {
  const bg =
    tone === "bad"
      ? "rgba(239,68,68,0.14)"
      : tone === "warn"
      ? "rgba(245,158,11,0.14)"
      : "rgba(34,197,94,0.14)";

  const bd =
    tone === "bad"
      ? "rgba(239,68,68,0.30)"
      : tone === "warn"
      ? "rgba(245,158,11,0.30)"
      : "rgba(34,197,94,0.30)";

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${bd}`,
        padding: 12,
        borderRadius: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
