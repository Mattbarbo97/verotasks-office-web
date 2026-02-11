// src/ui/Spinner.jsx
import React from "react";

export default function Spinner({ label = "Carregando..." }) {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        color: "#e5e7eb",
      }}
    >
      <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "3px solid rgba(255,255,255,0.15)",
            borderTopColor: "rgba(255,255,255,0.85)",
            animation: "spin 0.9s linear infinite",
          }}
        />
        <div style={{ opacity: 0.75, fontSize: 13 }}>{label}</div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
