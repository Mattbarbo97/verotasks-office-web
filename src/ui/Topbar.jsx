// src/ui/Topbar.jsx
import React, { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import veroLogo from "../../public/vero.png";

export default function Topbar({
  title = "VeroTasks",
  subtitle = "",
  userLabel = "",
  role = "",
  telegramLinked = false,
  onLogout,
  showMasterNav = false,
}) {
  const loc = useLocation();
  const path = loc.pathname || "/";

  const nav = useMemo(
    () =>
      [
        { to: "/office", label: "Office", show: true },
        { to: "/master", label: "Master", show: showMasterNav },
        { to: "/collaborators", label: "Colaboradores", show: showMasterNav },
        {
          to: "/telegram/link",
          label: telegramLinked ? "Telegram" : "Vincular Telegram",
          show: true,
          badge: telegramLinked ? "✅" : "⚠️",
        },
      ].filter((n) => n.show),
    [showMasterNav, telegramLinked]
  );

  function isActive(to) {
    if (to === "/office") return path === "/office" || path === "/";
    return path.startsWith(to);
  }

  function NavLink({ to, label, badge }) {
    const active = isActive(to);

    return (
      <Link
        to={to}
        className={
          "inline-flex items-center gap-2 rounded-2xl border transition select-none " +
          (active
            ? "bg-indigo-500/20 border-indigo-300/25 text-white"
            : "bg-white/0 border-white/10 text-white/75 hover:text-white hover:bg-white/5 hover:border-white/15")
        }
        style={{
          padding: "10px 12px",
          fontSize: 12,
          fontWeight: 900,
          lineHeight: 1.1,
          boxShadow: active ? "0 12px 30px rgba(0,0,0,0.35)" : "none",
        }}
      >
        <span className="truncate">{label}</span>

        {badge ? (
          <span
            className={
              "text-[11px] px-2 py-1 rounded-full border " +
              (active ? "border-indigo-200/20 bg-indigo-200/10" : "border-white/10 bg-white/5")
            }
            style={{ fontWeight: 900, lineHeight: 1 }}
            aria-label="badge"
          >
            {badge}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <header
      className="rounded-2xl border border-white/10"
      style={{
        padding: 14,
        background: "linear-gradient(180deg, rgba(0,0,0,0.46), rgba(0,0,0,0.26))",
        backdropFilter: "blur(14px)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
      }}
    >
      <div className="flex items-start lg:items-center justify-between gap-3">
        {/* ESQUERDA: Logo + Title/Sub + Nav */}
        <div className="min-w-0 flex items-start sm:items-center gap-3">
          {/* Logo (PNG do Vero) */}
          <div
            className="shrink-0 rounded-2xl border border-white/10"
            style={{
              width: 46,
              height: 46,
              display: "grid",
              placeItems: "center",
              background: "rgba(255,255,255,0.05)",
            }}
            title="Vero"
          >
            <img
              src={veroLogo}
              alt="Vero"
              style={{
                width: 30,
                height: 30,
                objectFit: "contain",
                filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.55))",
              }}
              onError={(e) => {
                // DEBUG útil: se ainda falhar, você vai ver no console
                console.error("[Topbar] Falha ao carregar veroLogo:", veroLogo);
                e.currentTarget.style.opacity = 0.2;
              }}
            />
          </div>

          <div className="min-w-0">
            <div
              className="truncate"
              style={{
                fontSize: 18,
                fontWeight: 950,
                letterSpacing: -0.35,
                lineHeight: 1.15,
                color: "rgba(255,255,255,0.94)",
              }}
            >
              {title}
            </div>

            {subtitle ? (
              <div
                className="truncate"
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  lineHeight: 1.25,
                  color: "rgba(255,255,255,0.62)",
                }}
              >
                {subtitle}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} label={n.label} badge={n.badge} />
              ))}
            </div>
          </div>
        </div>

        {/* DIREITA: user + status + sair */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          <div
            className="text-right"
            style={{
              fontSize: 12,
              lineHeight: 1.2,
              color: "rgba(255,255,255,0.65)",
            }}
          >
            {userLabel ? (
              <div className="truncate max-w-[240px] sm:max-w-[320px]">{userLabel}</div>
            ) : null}
            {role ? <div className="truncate">({role})</div> : null}
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/telegram/link"
              className={
                "text-xs px-3 py-2 rounded-2xl border transition " +
                (telegramLinked
                  ? "bg-emerald-500/10 border-emerald-400/20 text-emerald-200 hover:bg-emerald-500/15"
                  : "bg-yellow-500/10 border-yellow-400/20 text-yellow-200 hover:bg-yellow-500/15")
              }
              style={{ fontWeight: 900, lineHeight: 1.1 }}
              title={telegramLinked ? "Telegram vinculado" : "Telegram não vinculado"}
            >
              {telegramLinked ? "Telegram ✅" : "Telegram ⚠️"}
            </Link>

            <button
              onClick={onLogout}
              type="button"
              className="text-xs px-3 py-2 rounded-2xl border border-white/10 hover:bg-white/5 transition"
              style={{
                fontWeight: 900,
                lineHeight: 1.1,
                background: "rgba(255,255,255,0.02)",
              }}
              title="Sair"
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}