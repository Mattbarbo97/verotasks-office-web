import React from "react";

function toneStyle(tone) {
  if (tone === "ghost") {
    return {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
    };
  }
  if (tone === "warn") {
    return {
      background: "rgba(245,158,11,0.18)",
      border: "1px solid rgba(245,158,11,0.35)",
    };
  }
  if (tone === "bad") {
    return {
      background: "rgba(239,68,68,0.18)",
      border: "1px solid rgba(239,68,68,0.35)",
    };
  }
  return {
    background: "rgba(99,102,241,0.22)",
    border: "1px solid rgba(99,102,241,0.40)",
  };
}

export default function Button({ children, tone = "primary", style, disabled, ...props }) {
  return (
    <button
      disabled={disabled}
      {...props}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        color: "#e5e7eb",
        fontWeight: 800,
        opacity: disabled ? 0.55 : 1,
        outline: "none",
        ...toneStyle(tone),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
