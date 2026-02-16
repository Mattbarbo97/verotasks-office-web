// src/pages/OfficePanel.jsx
/* eslint-disable */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, orderBy, query, updateDoc, doc, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../firebase";
import Shell from "../ui/Shell";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Input from "../ui/Input";
import Toast from "../ui/Toast";

import useAuthUser from "../auth/useAuthUser";
import { fmtDateTime } from "../lib/date";
import { safeStr } from "../lib/safe";

/* =========================
   Helpers (UI / formatting)
   ========================= */

function nowMs() {
  return Date.now();
}

function msToHuman(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function createdAtToMs(t) {
  const d = t?.createdAt?.toDate ? t.createdAt.toDate() : null;
  return d ? d.getTime() : 0;
}

function officeSignaledAtToMs(t) {
  const d = t?.officeSignaledAt?.toDate ? t.officeSignaledAt.toDate() : null;
  return d ? d.getTime() : 0;
}

function badgePriority(p) {
  if (p === "alta") return { text: "ALTA", tone: "bad" };
  if (p === "baixa") return { text: "BAIXA", tone: "ok" };
  return { text: "MÉDIA", tone: "warn" };
}

function badgeStatus(s) {
  const map = {
    aberta: { text: "ABERTA", tone: "neutral" },
    pendente: { text: "PENDENTE", tone: "warn" },
    feito: { text: "FEITO", tone: "ok" },
    feito_detalhes: { text: "FEITO (DET.)", tone: "ok" },
    deu_ruim: { text: "PROBLEMAS", tone: "bad" },
  };
  return map[s] || { text: safeStr(s) || "—", tone: "neutral" };
}

function isClosedStatus(status) {
  return ["feito", "feito_detalhes", "deu_ruim"].includes(String(status || ""));
}

function toastTone(msg) {
  const s = String(msg || "");
  if (s.startsWith("✅")) return "ok";
  if (s.startsWith("⚠️")) return "warn";
  if (s.startsWith("🕒")) return "warn";
  if (s.startsWith("ℹ️")) return "neutral";
  if (s.startsWith("🔊")) return "neutral";
  if (s.startsWith("🚫")) return "bad";
  return "warn";
}

/* =========================
   Task Preview (FIX)
   ========================= */

function taskPreview(t) {
  const msg =
    safeStr(t?.message) ||
    safeStr(t?.description) ||
    safeStr(t?.title) ||
    safeStr(t?.telegram?.rawText) ||
    safeStr(t?.telegram?.text) ||
    "";

  const legacySourceText = t?.source && typeof t.source === "object" ? safeStr(t.source.text) : "";
  return msg || legacySourceText || "(sem mensagem)";
}

/* =========================
   Office signal (canon)
   ========================= */

const OFFICE_SIGNAL = {
  EM_ANDAMENTO: "em_andamento",
  PRECISO_AJUDA: "preciso_ajuda",
  APRESENTOU_PROBLEMAS: "apresentou_problemas",
  TAREFA_EXECUTADA: "tarefa_executada",
  COMENTARIO: "comentario",
};

function normalizeOfficeState(officeSignal) {
  if (!officeSignal) return "";
  if (typeof officeSignal === "string") return officeSignal;
  if (typeof officeSignal === "object" && officeSignal.state) return String(officeSignal.state);
  return "";
}

function signalLabel(sig) {
  if (sig === OFFICE_SIGNAL.EM_ANDAMENTO) return "Em andamento";
  if (sig === OFFICE_SIGNAL.PRECISO_AJUDA) return "Precisa de ajuda";
  if (sig === OFFICE_SIGNAL.APRESENTOU_PROBLEMAS) return "Apresentou problemas";
  if (sig === OFFICE_SIGNAL.TAREFA_EXECUTADA) return "Tarefa executada";
  if (sig === OFFICE_SIGNAL.COMENTARIO) return "Comentado";
  return "—";
}

/* =========================
   Filters / sorting
   ========================= */

const TAB = { PENDING: "pending", CLOSED: "closed", ALL: "all" };

const SORT = {
  NEWEST: "newest",
  OLDEST: "oldest",
  PRIORITY: "priority",
  LAST_SIGNAL: "last_signal",
};

const PRIORITY_RANK = { alta: 0, media: 1, baixa: 2 };
const STATUS_RANK = { aberta: 0, pendente: 1, feito: 2, feito_detalhes: 3, deu_ruim: 4 };

function includesText(t, needle) {
  const f = String(needle || "").trim().toLowerCase();
  if (!f) return true;

  const from = safeStr(t.createdBy?.name).toLowerCase();
  const msg = taskPreview(t).toLowerCase();
  const legacyOfficeComment = safeStr(t.officeComment).toLowerCase();
  const masterComment = safeStr(t.masterComment).toLowerCase();
  const objComment = t.officeSignal && typeof t.officeSignal === "object" ? safeStr(t.officeSignal.comment).toLowerCase() : "";

  return from.includes(f) || msg.includes(f) || legacyOfficeComment.includes(f) || objComment.includes(f) || masterComment.includes(f);
}

/* =========================
   Sound (no autostart)
   ========================= */

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function createAudioManagerNoAutostart() {
  const mgr = { ctx: null, unlocked: false, unlocking: false };

  function getAudioCtor() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  mgr.unlock = async () => {
    try {
      const AudioCtor = getAudioCtor();
      if (!AudioCtor) return false;
      if (!mgr.ctx) mgr.ctx = new AudioCtor();
      if (mgr.ctx.state === "running") {
        mgr.unlocked = true;
        return true;
      }
      if (mgr.unlocking) return false;
      mgr.unlocking = true;
      await mgr.ctx.resume();
      mgr.unlocked = mgr.ctx.state === "running";
      mgr.unlocking = false;
      return mgr.unlocked;
    } catch {
      mgr.unlocking = false;
      return false;
    }
  };

  mgr.beep = async ({ volume = 0.7, freq = 880, ms = 180 } = {}) => {
    try {
      if (!mgr.ctx || mgr.ctx.state !== "running") return false;
      const o = mgr.ctx.createOscillator();
      const g = mgr.ctx.createGain();
      o.type = "sine";
      o.frequency.value = Number(freq) || 880;
      g.gain.value = clamp(volume, 0, 1);
      o.connect(g);
      g.connect(mgr.ctx.destination);
      o.start();
      await new Promise((r) => setTimeout(r, Math.max(60, Number(ms) || 180)));
      o.stop();
      try {
        o.disconnect();
        g.disconnect();
      } catch {}
      return true;
    } catch {
      return false;
    }
  };

  return mgr;
}

/* =========================
   Local prefs
   ========================= */

const PREFS_KEY = "vero_office_ui_prefs_v2";

function loadUIPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveUIPrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

function normalizeBaseUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

/* =========================
   Main
   ========================= */

export default function OfficePanel() {
  const { user } = useAuthUser();

  const telegramLinked = false;

  const [tasks, setTasks] = useState([]);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);

  const [tab, setTab] = useState(TAB.PENDING);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [prioFilter, setPrioFilter] = useState("");
  const [sortBy, setSortBy] = useState(SORT.NEWEST);
  const [busyId, setBusyId] = useState(null);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.7);
  const [muteUntilMs, setMuteUntilMs] = useState(0);

  const [fontScale, setFontScale] = useState(1.0);
  const [density, setDensity] = useState("normal");
  const [visualAlert, setVisualAlert] = useState("pulse");

  const lastBeepMsRef = useRef(0);
  const seenPendingIdsRef = useRef(new Set());
  const lastOfficeStateByIdRef = useRef(new Map());
  const lastForceByTaskRef = useRef(new Map());

  const audioRef = useRef(null);
  if (!audioRef.current && typeof window !== "undefined") {
    audioRef.current = createAudioManagerNoAutostart();
  }

  // ✅ ENV (aceita 3 nomes)
  const OFFICE_SECRET_RAW = import.meta.env.VITE_OFFICE_API_SECRET || "";
  const BOT_BASE_URL_RAW =
    import.meta.env.VITE_OFFICE_API_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_BOT_BASE_URL ||
    "";

  const OFFICE_SECRET = String(OFFICE_SECRET_RAW || "").trim();
  const BOT_BASE_URL = normalizeBaseUrl(BOT_BASE_URL_RAW);

  const envOk = Boolean(BOT_BASE_URL && OFFICE_SECRET);
  const missing = useMemo(() => {
    const m = [];
    if (!BOT_BASE_URL) m.push("VITE_OFFICE_API_URL (ou VITE_API_BASE_URL / VITE_BOT_BASE_URL)");
    if (!OFFICE_SECRET) m.push("VITE_OFFICE_API_SECRET");
    return m;
  }, [BOT_BASE_URL, OFFICE_SECRET]);

  // 🔎 Debug de env (uma vez)
  useEffect(() => {
    try {
      // NÃO loga secret; só presença.
      console.log("[OfficePanel env]", {
        BOT_BASE_URL,
        hasOfficeSecret: Boolean(OFFICE_SECRET),
        officeSecretLen: OFFICE_SECRET ? OFFICE_SECRET.length : 0,
        mode: import.meta.env.MODE,
        dev: import.meta.env.DEV,
        prod: import.meta.env.PROD,
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Live tasks ----------
  useEffect(() => {
    const qy = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setTasks(rows);
        setErr(null);
      },
      (e) => setErr(e?.message || "Falha ao carregar tasks.")
    );
    return () => unsub();
  }, []);

  // ---------- Load prefs ----------
  useEffect(() => {
    const p = loadUIPrefs();
    if (p) {
      if (typeof p.soundEnabled === "boolean") setSoundEnabled(p.soundEnabled);
      if (typeof p.soundVolume === "number") setSoundVolume(clamp(p.soundVolume, 0, 1));
      if (typeof p.muteUntilMs === "number") setMuteUntilMs(p.muteUntilMs);
      if (typeof p.fontScale === "number") setFontScale(clamp(p.fontScale, 1, 1.4));
      if (typeof p.density === "string") setDensity(p.density === "compact" ? "compact" : "normal");
      if (typeof p.visualAlert === "string") setVisualAlert(p.visualAlert === "none" ? "none" : "pulse");
    }
  }, []);

  // ---------- Persist prefs ----------
  useEffect(() => {
    saveUIPrefs({ soundEnabled, soundVolume, muteUntilMs, fontScale, density, visualAlert });
  }, [soundEnabled, soundVolume, muteUntilMs, fontScale, density, visualAlert]);

  // ---------- Audio unlock on gesture ----------
  useEffect(() => {
    const mgr = audioRef.current;
    if (!mgr) return;
    const onGesture = async () => {
      await mgr.unlock().catch(() => {});
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);

  // ---------- Beep rules ----------
  useEffect(() => {
    if (!soundEnabled) return;
    if (muteUntilMs && nowMs() < muteUntilMs) return;

    const throttleMs = 4000;
    const canBeep = () => nowMs() - (lastBeepMsRef.current || 0) > throttleMs;

    let shouldBeep = false;

    for (const t of tasks) {
      if (!t?.id) continue;
      const isPending = ["aberta", "pendente"].includes(String(t.status || ""));
      if (!isPending) continue;

      if (!seenPendingIdsRef.current.has(t.id)) {
        seenPendingIdsRef.current.add(t.id);
        if (seenPendingIdsRef.current.size > 1) shouldBeep = true;
      }
    }

    for (const t of tasks) {
      if (!t?.id) continue;
      const curState = normalizeOfficeState(t.officeSignal);
      const prev = lastOfficeStateByIdRef.current.get(t.id) || "";
      if (curState && curState !== prev) {
        if (curState === OFFICE_SIGNAL.PRECISO_AJUDA || curState === OFFICE_SIGNAL.APRESENTOU_PROBLEMAS) {
          shouldBeep = true;
        }
      }
      lastOfficeStateByIdRef.current.set(t.id, curState);
    }

    const mgr = audioRef.current;
    if (shouldBeep && canBeep() && mgr) {
      lastBeepMsRef.current = nowMs();
      mgr.beep({ volume: soundVolume }).then((ok) => {
        if (!ok) setToast("🔊 Áudio bloqueado: clique/tap na tela para liberar o som.");
      });
    }
  }, [tasks, soundEnabled, soundVolume, muteUntilMs]);

  // ---------- Office API call ----------
  async function callOfficeSignalApi({ taskId, state, comment, by, forceNotify = false }) {
    if (!BOT_BASE_URL || !OFFICE_SECRET) {
      return { ok: false, skipped: true, reason: "missing_env" };
    }

    const url = `${BOT_BASE_URL}/office/signal`;

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-office-secret": OFFICE_SECRET },
        body: JSON.stringify({ taskId, state, comment: comment || "", by: by || null, forceNotify: Boolean(forceNotify) }),
      });
    } catch (netErr) {
      throw new Error(`Falha de rede/CORS: ${netErr?.message || netErr}`);
    }

    const raw = await res.text().catch(() => "");
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`Resposta não-JSON do backend (status ${res.status}).`);
    }

    if (!res.ok || !data.ok) throw new Error(data?.error || `Falha HTTP ${res.status}`);
    return data;
  }

  async function unlockTask(taskId) {
    try {
      await updateDoc(doc(db, "tasks", taskId), {
        officeSignalLock: false,
        officeSignalLockedAt: null,
        officeSignalLockedBy: null,
        updatedAt: serverTimestamp(),
      });
    } catch {}
  }

  const updateSignal = useCallback(
    async (taskId, state, comment = "", { lock = false, forceNotify = false } = {}) => {
      setBusyId(taskId);
      setErr(null);
      setToast(null);

      const mgr = audioRef.current;
      if (mgr) mgr.unlock().catch(() => {});

      if (forceNotify) {
        const last = lastForceByTaskRef.current.get(taskId) || 0;
        const minGap = 15000;
        if (nowMs() - last < minGap) {
          setToast(`🕒 Aguarde ${msToHuman(minGap - (nowMs() - last))} para reenviar novamente.`);
          setBusyId(null);
          return;
        }
        lastForceByTaskRef.current.set(taskId, nowMs());
      }

      try {
        const u = auth.currentUser;
        const byEmail = u?.email || "office-web";
        const byUid = u?.uid || "office-web";

        const ref = doc(db, "tasks", taskId);

        const officeSignalObj = {
          state,
          comment: comment || "",
          updatedAt: serverTimestamp(),
          updatedBy: { uid: byUid, email: byEmail },
        };

        const patch = {
          officeSignal: officeSignalObj,
          officeComment: comment || "",
          officeSignaledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        if (lock) {
          patch.officeSignalLock = true;
          patch.officeSignalLockedAt = serverTimestamp();
          patch.officeSignalLockedBy = byEmail;
        }

        await updateDoc(ref, patch);

        let resp = null;
        try {
          resp = await callOfficeSignalApi({ taskId, state, comment, by: { uid: byUid, email: byEmail }, forceNotify });
        } catch (apiErr) {
          if (lock) await unlockTask(taskId);
          setToast(`⚠️ Sinal salvo, mas falhou avisar o master.\n${apiErr?.message || "Erro no backend."}`);
          return;
        }

        const notified = resp?.notified === true;
        if (notified) setToast(forceNotify ? "✅ Reenviado ao master (forçado)." : "✅ Sinal enviado ao master.");
        else setToast("✅ Sinal salvo. (Sem nova notificação agora.)");
      } catch (e) {
        setErr(e?.message || "Falha ao sinalizar.");
      } finally {
        setBusyId(null);
      }
    },
    [BOT_BASE_URL, OFFICE_SECRET]
  );

  async function onLogout() {
    await signOut(auth);
  }

  const visible = useMemo(() => {
    let base = tasks;

    if (tab === TAB.PENDING) base = base.filter((t) => ["aberta", "pendente"].includes(String(t.status || "")));
    if (tab === TAB.CLOSED) base = base.filter((t) => isClosedStatus(String(t.status || "")));

    if (statusFilter) base = base.filter((t) => String(t.status || "") === statusFilter);
    if (prioFilter) base = base.filter((t) => String(t.priority || "") === prioFilter);

    base = base.filter((t) => includesText(t, filter));

    const sorted = [...base].sort((a, b) => {
      const aCreated = createdAtToMs(a);
      const bCreated = createdAtToMs(b);

      if (sortBy === SORT.NEWEST) return (bCreated || 0) - (aCreated || 0);
      if (sortBy === SORT.OLDEST) return (aCreated || 0) - (bCreated || 0);

      if (sortBy === SORT.LAST_SIGNAL) {
        const aSig = officeSignaledAtToMs(a);
        const bSig = officeSignaledAtToMs(b);
        return (bSig || 0) - (aSig || 0);
      }

      if (sortBy === SORT.PRIORITY) {
        const ar = PRIORITY_RANK[String(a.priority || "media")] ?? 1;
        const br = PRIORITY_RANK[String(b.priority || "media")] ?? 1;
        if (ar !== br) return ar - br;

        const asr = STATUS_RANK[String(a.status || "aberta")] ?? 0;
        const bsr = STATUS_RANK[String(b.status || "aberta")] ?? 0;
        if (asr !== bsr) return asr - bsr;

        return (bCreated || 0) - (aCreated || 0);
      }

      return (bCreated || 0) - (aCreated || 0);
    });

    return sorted;
  }, [tasks, tab, statusFilter, prioFilter, filter, sortBy]);

  const counts = useMemo(() => {
    const pending = tasks.filter((t) => ["aberta", "pendente"].includes(String(t.status || ""))).length;
    const closed = tasks.filter((t) => isClosedStatus(String(t.status || ""))).length;
    return { pending, closed, all: tasks.length };
  }, [tasks]);

  const isMuted = muteUntilMs && nowMs() < muteUntilMs;
  const muteLeft = isMuted ? msToHuman(muteUntilMs - nowMs()) : "";

  const userLabel = user?.email || auth.currentUser?.email || "—";

  const padCard = density === "compact" ? 10 : 14;
  const titleSize = density === "compact" ? 15 : 16;
  const metaSize = 12;
  const previewScale = fontScale;

  return (
    <>
      <Shell
        title="VeroTasks"
        subtitle="Painel do Escritório"
        userLabel={userLabel}
        role="office"
        telegramLinked={telegramLinked}
        onLogout={onLogout}
        showMasterNav={true}
      >
        {toast ? (
          <Toast tone={toastTone(toast)} style={{ marginTop: 12 }}>
            <div style={{ whiteSpace: "pre-wrap" }}>{toast}</div>
          </Toast>
        ) : null}

        {err ? (
          <Toast tone="bad" style={{ marginTop: 12 }}>
            {err}
          </Toast>
        ) : null}

        {!envOk ? (
          <Toast tone="warn" style={{ marginTop: 12 }}>
            ⚠️ Backend não configurado no front.
            <br />
            <br />
            <b>Faltando:</b>
            <br />- {missing.join("\n- ")}
            <br />
            <br />
            <b>Detectado agora:</b>
            <br />- BOT_BASE_URL: <code>{BOT_BASE_URL || "(vazio)"}</code>
            <br />- OFFICE_SECRET: <code>{OFFICE_SECRET ? "(ok)" : "(vazio)"}</code>
          </Toast>
        ) : null}

        <Card style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <Input label="Buscar" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Nome, mensagem, comentário..." />

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.75 }}>Visão</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button tone={tab === TAB.PENDING ? "primary" : "ghost"} onClick={() => setTab(TAB.PENDING)}>
                  Pendentes ({counts.pending})
                </Button>
                <Button tone={tab === TAB.CLOSED ? "primary" : "ghost"} onClick={() => setTab(TAB.CLOSED)}>
                  Finalizadas ({counts.closed})
                </Button>
                <Button tone={tab === TAB.ALL ? "primary" : "ghost"} onClick={() => setTab(TAB.ALL)}>
                  Todas ({counts.all})
                </Button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.75 }}>Som</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Button
                  tone={soundEnabled ? "primary" : "ghost"}
                  onClick={async () => {
                    setSoundEnabled((v) => !v);
                    const mgr = audioRef.current;
                    if (mgr) await mgr.unlock().catch(() => {});
                    setToast(soundEnabled ? "🔊 Som desativado." : "🔊 Som ativado.");
                  }}
                >
                  {soundEnabled ? "🔊 Ligado" : "🔇 Desligado"}
                </Button>

                <Button
                  tone={isMuted ? "warn" : "ghost"}
                  disabled={!soundEnabled}
                  onClick={() => {
                    const until = nowMs() + 30 * 60 * 1000;
                    setMuteUntilMs(until);
                    setToast("🔊 Silenciado por 30 min.");
                  }}
                >
                  {isMuted ? `Silenciado (${muteLeft})` : "Silenciar 30 min"}
                </Button>

                {isMuted ? (
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setMuteUntilMs(0);
                      setToast("🔊 Silêncio removido.");
                    }}
                  >
                    Reativar
                  </Button>
                ) : null}

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>Vol</span>
                  <input type="range" min="0" max="1" step="0.05" value={soundVolume} disabled={!soundEnabled} onChange={(e) => setSoundVolume(Number(e.target.value))} />
                  <Button
                    tone="ghost"
                    disabled={!soundEnabled || (muteUntilMs && nowMs() < muteUntilMs)}
                    onClick={async () => {
                      const mgr = audioRef.current;
                      if (!mgr) return setToast("🔊 Áudio indisponível neste navegador.");
                      await mgr.unlock().catch(() => {});
                      const ok = await mgr.beep({ volume: soundVolume });
                      setToast(ok ? "🔊 Teste: ok." : "🔊 Clique/tap na tela e tente de novo.");
                    }}
                  >
                    Testar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {visible.length === 0 ? (
            <Card>
              <div style={{ opacity: 0.85 }}>Nenhuma tarefa encontrada.</div>
            </Card>
          ) : null}

          {visible.map((t) => {
            const pr = badgePriority(t.priority);
            const st = badgeStatus(t.status);

            const createdAt = t.createdAt?.toDate ? t.createdAt.toDate() : null;
            const officeSignaledAt = t.officeSignaledAt?.toDate ? t.officeSignaledAt.toDate() : null;

            const officeState = normalizeOfficeState(t.officeSignal);

            const lockedByMaster = isClosedStatus(t.status);
            const disabled = busyId === t.id || lockedByMaster;

            const age = createdAt ? msToHuman(nowMs() - createdAt.getTime()) : "—";
            const lastSignalAgo = officeSignaledAt ? msToHuman(nowMs() - officeSignaledAt.getTime()) : "—";
            const preview = taskPreview(t);

            const isAlertState = officeState === OFFICE_SIGNAL.PRECISO_AJUDA || officeState === OFFICE_SIGNAL.APRESENTOU_PROBLEMAS;

            const pulse =
              visualAlert === "pulse" && isAlertState && !isClosedStatus(t.status)
                ? { animation: "veroPulse 1.2s ease-in-out infinite" }
                : {};

            return (
              <Card key={t.id} style={{ display: "grid", gap: 10, padding: padCard, ...(pulse || {}) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div
                    style={{
                      fontSize: titleSize,
                      fontWeight: 950,
                      flex: 1,
                      minWidth: 240,
                      transform: `scale(${previewScale})`,
                      transformOrigin: "left center",
                    }}
                  >
                    {preview}
                  </div>

                  <Badge tone={pr.tone}>⚡ {pr.text}</Badge>
                  <Badge tone={st.tone}>📌 {st.text}</Badge>
                  <Badge tone="neutral">🚦 {signalLabel(officeState)}</Badge>
                </div>

                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", opacity: 0.85, fontSize: metaSize }}>
                  <div>
                    🧾 ID: <code style={{ opacity: 0.9 }}>{t.id}</code>
                  </div>
                  <div>
                    👤 De: <b>{safeStr(t.createdBy?.name) || "—"}</b>
                  </div>
                  <div>
                    🕒 Criada: {createdAt ? fmtDateTime(createdAt) : "—"} • <b>{age}</b>
                  </div>
                  <div>
                    🧷 Último sinal: {officeSignaledAt ? fmtDateTime(officeSignaledAt) : "—"} • <b>{lastSignalAgo}</b>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button onClick={() => updateSignal(t.id, OFFICE_SIGNAL.EM_ANDAMENTO, "", { lock: false })} disabled={disabled || !envOk}>
                    Em andamento
                  </Button>

                  <Button tone="warn" onClick={() => updateSignal(t.id, OFFICE_SIGNAL.PRECISO_AJUDA, "", { lock: false })} disabled={disabled || !envOk}>
                    Preciso de ajuda
                  </Button>

                  <Button
                    tone="bad"
                    onClick={() => updateSignal(t.id, OFFICE_SIGNAL.APRESENTOU_PROBLEMAS, "🚫 Apresentou problemas", { lock: true })}
                    disabled={disabled || !envOk}
                  >
                    Apresentou problemas
                  </Button>

                  <Button
                    tone="primary"
                    onClick={() => updateSignal(t.id, OFFICE_SIGNAL.TAREFA_EXECUTADA, "✅ Tarefa executada", { lock: true })}
                    disabled={disabled || !envOk}
                  >
                    Tarefa executada
                  </Button>

                  <CommentButton task={t} busy={disabled || !envOk} onSave={(text) => updateSignal(t.id, OFFICE_SIGNAL.COMENTARIO, text, { lock: true })} />
                </div>

                <div style={{ fontSize: 12, opacity: 0.72 }}>
                  *O escritório apenas sinaliza. <b>Conclusão final</b> é exclusiva do Master/Telegram.
                  {lockedByMaster ? (
                    <div style={{ marginTop: 6, opacity: 0.85 }}>🔒 Master finalizou esta tarefa. A sinalização do Office está bloqueada.</div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      </Shell>

      <style>{`
        @keyframes veroPulse {
          0% { box-shadow: 0 0 0 rgba(99,102,241,0.0); }
          50% { box-shadow: 0 0 0 6px rgba(99,102,241,0.10); }
          100% { box-shadow: 0 0 0 rgba(99,102,241,0.0); }
        }
      `}</style>
    </>
  );
}

/* =========================
   Comment Button
   ========================= */

function CommentButton({ task, busy, onSave }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(safeStr(task.officeComment) || "");

  useEffect(() => {
    setText(safeStr(task.officeComment) || "");
  }, [task.officeComment]);

  if (!open) {
    return (
      <Button tone="ghost" disabled={busy} onClick={() => setOpen(true)}>
        Comentar
      </Button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
      <div style={{ minWidth: "min(420px, 90vw)" }}>
        <label style={{ display: "block", fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Comentário</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          style={{
            width: "100%",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(0,0,0,0.25)",
            color: "#e5e7eb",
            padding: 10,
            outline: "none",
            resize: "vertical",
          }}
          placeholder="Escreva um detalhe para o master..."
        />
      </div>

      <Button
        disabled={busy}
        onClick={async () => {
          await onSave(text);
          setOpen(false);
        }}
      >
        Salvar
      </Button>

      <Button tone="ghost" disabled={busy} onClick={() => setOpen(false)}>
        Cancelar
      </Button>
    </div>
  );
}
