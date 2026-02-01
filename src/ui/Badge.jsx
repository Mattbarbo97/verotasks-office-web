import React from "react";

function toneBg(t) {
  if (t === "ok") return "rgba(34,197,94,0.22)";
  if (t === "bad") return "rgba(239,68,68,0.22)";
  if (t === "warn") return "rgba(245,158,11,0.22)";
  return "rgba(255,255,255,0.10)";
}

export default function Badge({ children, tone = "neutral" }) {
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 900,
        background: toneBg(tone),
        border: "1px solid rgba(255,255,255,0.10)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
