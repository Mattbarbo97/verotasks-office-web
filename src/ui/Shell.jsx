import React from "react";

export default function Shell({ children, center = false }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 800px at 20% 10%, rgba(99,102,241,0.25), transparent 55%)," +
          "radial-gradient(1000px 700px at 80% 20%, rgba(34,211,238,0.18), transparent 55%)," +
          "linear-gradient(180deg, #060712, #050611)",
        color: "#e5e7eb",
        padding: 18,
        display: center ? "grid" : "block",
        placeItems: center ? "center" : "initial",
      }}
    >
      <div style={{ width: "min(1100px, 100%)", margin: "0 auto" }}>
        {children}
      </div>
    </div>
  );
}
