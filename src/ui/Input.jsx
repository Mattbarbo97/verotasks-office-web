// src/ui/Input.jsx
import React, { useId, useMemo } from "react";

export default function Input({
  label,
  style,
  id,

  // novos (opcionais)
  size = "md", // sm | md | lg
  helper,
  error,
  leftIcon, // JSX
  rightSlot, // JSX
  fullWidth = true,
  disabled = false,

  ...props
}) {
  const rid = useId();
  const inputId = id || `input_${rid}`;

  const h = size === "sm" ? 38 : size === "lg" ? 46 : 42;
  const padX = size === "sm" ? 10 : size === "lg" ? 12 : 11;
  const radius = 14;

  const border = error ? "rgba(239,68,68,0.55)" : "rgba(255,255,255,0.14)";
  const bg = disabled ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.28)";

  const wrapperStyle = useMemo(
    () => ({
      display: "grid",
      gap: 6,
      width: fullWidth ? "100%" : undefined,
      ...style,
    }),
    [fullWidth, style]
  );

  return (
    <div style={wrapperStyle}>
      {label ? (
        <label
          htmlFor={inputId}
          style={{
            fontSize: 12,
            opacity: 0.82,
            color: "rgba(255,255,255,0.82)",
            letterSpacing: 0.2,
          }}
        >
          {label}
        </label>
      ) : null}

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          height: h,
          borderRadius: radius,
          border: `1px solid ${border}`,
          background: bg,
          boxShadow: error ? "0 0 0 3px rgba(239,68,68,0.10)" : "none",
          backdropFilter: "blur(10px)",
          overflow: "hidden",
          transition: "border-color 160ms ease, box-shadow 160ms ease, background 160ms ease",
        }}
      >
        {leftIcon ? (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: h,
              height: h,
              borderRight: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.80)",
            }}
          >
            {leftIcon}
          </div>
        ) : null}

        <input
          id={inputId}
          disabled={disabled}
          {...props}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            color: disabled ? "rgba(229,231,235,0.65)" : "#e5e7eb",
            paddingLeft: leftIcon ? padX : padX,
            paddingRight: rightSlot ? 46 : padX,
            fontSize: size === "sm" ? 13 : 14,
            fontWeight: 600,
            letterSpacing: 0.1,
          }}
        />

        {rightSlot ? (
          <div
            style={{
              position: "absolute",
              right: 8,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {rightSlot}
          </div>
        ) : null}
      </div>

      {error ? (
        <div style={{ fontSize: 12, color: "rgba(248,113,113,0.95)", lineHeight: 1.25 }}>
          {String(error)}
        </div>
      ) : helper ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", lineHeight: 1.25 }}>
          {String(helper)}
        </div>
      ) : null}
    </div>
  );
}
