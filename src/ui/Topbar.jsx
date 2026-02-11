// src/ui/Topbar.jsx
import React from "react";
import { Link, useLocation } from "react-router-dom";

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

  const nav = [
    { to: "/office", label: "Office", show: true },
    { to: "/master", label: "Master", show: showMasterNav },
    { to: "/collaborators", label: "Colaboradores", show: showMasterNav },
    { to: "/telegram/link", label: telegramLinked ? "Telegram ✅" : "Vincular Telegram ⚠️", show: true },
  ].filter((n) => n.show);

  function isActive(to) {
    if (to === "/office") return path === "/office" || path === "/";
    return path.startsWith(to);
  }

  return (
    <header className="vero-glass rounded-2xl border border-white/10 px-4 sm:px-5 py-4 flex items-start sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xl font-semibold tracking-tight truncate">{title}</div>
        {subtitle ? (
          <div className="text-sm text-white/60 truncate">{subtitle}</div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={
                "text-xs px-3 py-2 rounded-2xl border transition " +
                (isActive(n.to)
                  ? "bg-indigo-500/20 border-indigo-400/25"
                  : "bg-white/0 border-white/10 hover:bg-white/5")
              }
            >
              {n.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-2">
        <div className="text-xs text-white/60 text-right">
          {userLabel ? <div className="truncate max-w-[260px]">{userLabel}</div> : null}
          {role ? <div className="truncate">({role})</div> : null}
        </div>

        <div className="flex items-center gap-2">
          <span
            className={
              "text-xs px-2 py-1 rounded-2xl border " +
              (telegramLinked
                ? "bg-emerald-500/10 border-emerald-400/20 text-emerald-200"
                : "bg-yellow-500/10 border-yellow-400/20 text-yellow-200")
            }
            title={telegramLinked ? "Telegram vinculado" : "Telegram não vinculado"}
          >
            {telegramLinked ? "Telegram ✅" : "Telegram ⚠️"}
          </span>

          <button
            onClick={onLogout}
            className="text-xs px-3 py-2 rounded-2xl border border-white/10 hover:bg-white/5 transition"
            type="button"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
