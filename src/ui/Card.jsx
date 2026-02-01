import React from "react";

export default function Card({ children, style }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        backdropFilter: "blur(10px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
