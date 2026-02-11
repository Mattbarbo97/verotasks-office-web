// src/ui/Shell.jsx
import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import Button from "./Button";
import Badge from "./Badge";

function clamp(v, a, b) {
  const n = Number(v);
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function routeActive(pathname, href) {
  if (!href) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function pillStyle(active) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: 38,
    padding: "0 14px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: active ? "rgba(99,102,241,0.20)" : "rgba(255,255,255,0.06)",
    color: active ? "#EAF0FF" : "rgba(255,255,255,0.78)",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 13,
    transition: "transform 120ms ease, background 120ms ease, border 120ms ease",
    userSelect: "none",
  };
}

function dot(ok) {
  return {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: ok ? "#22c55e" : "#f59e0b",
    boxShadow: ok
      ? "0 0 0 3px rgba(34,197,94,0.14)"
      : "0 0 0 3px rgba(245,158,11,0.14)",
  };
}

export default function Shell({
  title = "VeroTasks",
  subtitle = "",
  userLabel = "—",
  role = "office",
  telegramLinked = false,
  onLogout,
  showMasterNav = false,
  children,
}) {
  const loc = useLocation();
  const nav = useNavigate();

  const maxW = 1180;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 700px at 15% 10%, rgba(99,102,241,0.22), transparent 60%), radial-gradient(900px 520px at 80% 20%, rgba(14,165,233,0.16), transparent 55%), radial-gradient(900px 520px at 40% 90%, rgba(168,85,247,0.12), transparent 55%), #060814",
        color: "#E5E7EB",
      }}
    >
      {/* Topbar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          backdropFilter: "blur(10px)",
          background: "rgba(6,8,20,0.60)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            maxWidth: maxW,
            margin: "0 auto",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          {/* Left: title */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 18, fontWeight: 950, letterSpacing: 0.2 }}>{title}</div>
              {subtitle ? (
                <div style={{ fontSize: 13, opacity: 0.75, fontWeight: 700 }}>{subtitle}</div>
              ) : null}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                <span style={{ opacity: 0.8 }}>Logado como:</span>{" "}
                <span style={{ fontWeight: 800, opacity: 0.95 }}>{userLabel}</span>
                <span style={{ opacity: 0.7 }}> • ({role || "office"})</span>
              </div>

              <div
                title={telegramLinked ? "Telegram vinculado" : "Telegram não vinculado"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.06)",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                <span style={dot(telegramLinked)} />
                Telegram {telegramLinked ? "OK" : "⚠️"}
              </div>
            </div>
          </div>

          {/* Right: nav + actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Link
              to="/office"
              style={pillStyle(routeActive(loc.pathname, "/office") || loc.pathname === "/")}
              onMouseDown={(e) => e.currentTarget && (e.currentTarget.style.transform = "scale(0.98)")}
              onMouseUp={(e) => e.currentTarget && (e.currentTarget.style.transform = "scale(1)")}
            >
              🧩 Office
            </Link>

            <Link
              to="/telegram"
              style={pillStyle(routeActive(loc.pathname, "/telegram"))}
              onMouseDown={(e) => e.currentTarget && (e.currentTarget.style.transform = "scale(0.98)")}
              onMouseUp={(e) => e.currentTarget && (e.currentTarget.style.transform = "scale(1)")}
            >
              🔗 Vincular Telegram {!telegramLinked ? "⚠️" : ""}
            </Link>

            {showMasterNav ? (
              <>
                <Link
                  to="/master"
                  style={pillStyle(routeActive(loc.pathname, "/master"))}
                  onMouseDown={(e) => e.currentTarget && (e.currentTarget.style.transform = "scale(0.98)")}
                  onMouseUp={(e) => e.currentTarget && (e.currentTarget.style.transform = "scale(1)")}
                >
                  🧠 Master
                </Link>

                <Link
                  to="/collaborators"
                  style={pillStyle(routeActive(loc.pathname, "/collaborators"))}
                  onMouseDown={(e) => e.currentTarget && (e.currentTarget.style.transform = "scale(0.98)")}
                  onMouseUp={(e) => e.currentTarget && (e.currentTarget.style.transform = "scale(1)")}
                >
                  👥 Colaboradores
                </Link>
              </>
            ) : null}

            <Button
              tone="ghost"
              onClick={() => {
                if (typeof onLogout === "function") onLogout();
                else nav("/login");
              }}
            >
              Sair
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: maxW, margin: "0 auto", padding: "16px" }}>
        <div
          style={{
            borderRadius: 22,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            boxShadow: "0 16px 50px rgba(0,0,0,0.55)",
            padding: clamp(16, 16, 16),
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
