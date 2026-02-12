// src/ui/Select.jsx
import React from "react";

export default function Select({
  label,
  value,
  onChange,
  options = [],
  children,
  style,
  ...props
}) {
  const hasChildren = React.Children.count(children) > 0;
  const hasOptions = Array.isArray(options) && options.length > 0;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {label ? <label style={{ fontSize: 12, opacity: 0.75 }}>{label}</label> : null}

      <select
        value={value}
        onChange={onChange}
        style={{
          height: 40,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(0,0,0,0.25)",
          color: "#e5e7eb",
          padding: "0 10px",
          outline: "none",
          ...style,
        }}
        {...props}
      >
        {hasChildren
          ? children
          : hasOptions
          ? options.map((o) => (
              <option key={String(o.value)} value={o.value}>
                {o.label}
              </option>
            ))
          : null}
      </select>
    </div>
  );
}
