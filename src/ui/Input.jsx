import React from "react";

export default function Input({ label, style, ...props }) {
  return (
    <div style={{ display: "grid", gap: 6, ...style }}>
      {label ? (
        <label style={{ fontSize: 12, opacity: 0.75 }}>{label}</label>
      ) : null}
      <input
        {...props}
        style={{
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(0,0,0,0.25)",
          color: "#e5e7eb",
          padding: "10px 10px",
          outline: "none",
        }}
      />
    </div>
  );
}
