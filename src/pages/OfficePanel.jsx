// src/pages/OfficePanel.jsx
/* eslint-disable */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { signOut } from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";

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
  const v = String(p || "media").toLowerCase();
  if (v === "alta") return { text: "ALTA", tone: "bad" };
  if (v === "baixa") return { text: "BAIXA", tone: "ok" };
  return { text: "MÉDIA", tone: "warn" };
}

/* =========================
   Status normalize (FIX MASTER)
   ========================= */

/**
 * ✅ Normaliza status vindo de múltiplas origens:
 * - Office legacy (pt): aberta/pendente/feito/feito_detalhes/deu_ruim
 * - Master UI (en ou enum): open/pending/done/done_details/failed/problem/closed etc.
 * - Telegram bot (variações): "feito (det.)", "deu ruim", etc.
 */
function normalizeStatus(status) {
  const s = String(status ?? "").trim().toLowerCase();
  if (!s) return "";

  // já está no canon PT
  if (
    s === "aberta" ||
    s === "pendente" ||
    s === "feito" ||
    s === "feito_detalhes" ||
    s === "deu_ruim"
  ) {
    return s;
  }

  // EN / enums comuns
  const map = {
    open: "aberta",
    opened: "aberta",
    new: "aberta",

    pending: "pendente",
    waiting: "pendente",
    wait: "pendente",
    in_review: "pendente",
    review: "pendente",

    done: "feito",
    ok: "feito",
    success: "feito",
    completed: "feito",
    complete: "feito",
    closed: "feito",

    done_details: "feito_detalhes",
    done_detail: "feito_detalhes",
    "done-detalhes": "feito_detalhes",
    "feito (det.)": "feito_detalhes",
    "feito(det.)": "feito_detalhes",
    "feito det": "feito_detalhes",
    detalhes: "feito_detalhes",
    detail: "feito_detalhes",
    details: "feito_detalhes",

    failed: "deu_ruim",
    fail: "deu_ruim",
    error: "deu_ruim",
    problem: "deu_ruim",
    problems: "deu_ruim",
    issue: "deu_ruim",
    issues: "deu_ruim",
    bad: "deu_ruim",
    "deu ruim": "deu_ruim",
    deu_ruim: "deu_ruim",
  };

  if (map[s]) return map[s];

  // tenta normalizar separadores
  const s2 = s.replace(/\s+/g, "_").replace(/-+/g, "_");
  if (map[s2]) return map[s2];

  return s; // fallback: mantém, pra não sumir
}

function badgeStatus(rawStatus) {
  const s = normalizeStatus(rawStatus);

  const map = {
    aberta: { text: "ABERTA", tone: "neutral" },
    pendente: { text: "PENDENTE", tone: "warn" },
    feito: { text: "FEITO", tone: "ok" },
    feito_detalhes: { text: "FEITO (DET.)", tone: "ok" },
    deu_ruim: { text: "PROBLEMAS", tone: "bad" },
  };

  return map[s] || { text: safeStr(s) || "—", tone: "neutral" };
}

function isClosedStatus(rawStatus) {
  const s = normalizeStatus(rawStatus);
  return ["feito", "feito_detalhes", "deu_ruim"].includes(String(s || ""));
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

  const legacySourceText =
    t?.source && typeof t.source === "object" ? safeStr(t.source.text) : "";
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
  if (typeof officeSignal === "object" && officeSignal.state)
    return String(officeSignal.state);
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
const STATUS_RANK = {
  aberta: 0,
  pendente: 1,
  feito: 2,
  feito_detalhes: 3,
  deu_ruim: 4,
};

function includesText(t, needle) {
  const f = String(needle || "").trim().toLowerCase();
  if (!f) return true;

  const from = safeStr(t.createdBy?.name).toLowerCase();
  const msg = taskPreview(t).toLowerCase();
  const legacyOfficeComment = safeStr(t.officeComment).toLowerCase();
  const masterComment = safeStr(t.masterComment).toLowerCase();
  const objComment =
    t.officeSignal && typeof t.officeSignal === "object"
      ? safeStr(t.officeSignal.comment).toLowerCase()
      : "";

  return (
    from.includes(f) ||
    msg.includes(f) ||
    legacyOfficeComment.includes(f) ||
    objComment.includes(f) ||
    masterComment.includes(f)
  );
}

/* =========================
   Autocomplete (Local)
   ========================= */

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .trim();
}

function tokenize(q) {
  return normalizeText(q)
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreTaskForQuery(t, qTokens) {
  if (!qTokens.length) return 0;

  const preview = taskPreview(t);
  const from = safeStr(t?.createdBy?.name);
  const comments =
    safeStr(t?.officeComment) +
    " " +
    safeStr(t?.masterComment) +
    " " +
    (t?.officeSignal && typeof t.officeSignal === "object"
      ? safeStr(t.officeSignal.comment)
      : "");

  const hay = normalizeText(preview + " " + from + " " + comments);

  let score = 0;
  for (const tok of qTokens) {
    if (!tok) continue;
    if (hay.startsWith(tok)) score += 50;
    if (hay.includes(" " + tok)) score += 25; // palavra
    else if (hay.includes(tok)) score += 10; // substring
  }

  // boost por prioridade alta
  const pr = String(t?.priority || "").toLowerCase();
  if (pr === "alta") score += 3;

  // boost por recente
  const age = createdAtToMs(t) || 0;
  if (age) score += Math.min(10, Math.floor((age / 1000 / 60) * 0.01)); // leve
  return score;
}

function uniqueBy(arr, getKey) {
  const out = [];
  const seen = new Set();
  for (const it of arr) {
    const k = getKey(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
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
   Card UX helpers
   ========================= */

function shouldPulse({ officeState, status, visualAlert }) {
  const isAlertState =
    officeState === OFFICE_SIGNAL.PRECISO_AJUDA ||
    officeState === OFFICE_SIGNAL.APRESENTOU_PROBLEMAS;
  return visualAlert === "pulse" && isAlertState && !isClosedStatus(status);
}

function getPrimaryAction({ status, officeState }) {
  const closed = isClosedStatus(status);
  if (closed) return null;

  if (officeState === OFFICE_SIGNAL.EM_ANDAMENTO) {
    return {
      key: "done",
      label: "Tarefa executada",
      state: OFFICE_SIGNAL.TAREFA_EXECUTADA,
      comment: "✅ Tarefa executada",
      tone: "primary",
      lock: true,
    };
  }

  if (
    officeState === OFFICE_SIGNAL.PRECISO_AJUDA ||
    officeState === OFFICE_SIGNAL.APRESENTOU_PROBLEMAS
  ) {
    return {
      key: "progress",
      label: "Em andamento",
      state: OFFICE_SIGNAL.EM_ANDAMENTO,
      comment: "",
      tone: "primary",
      lock: false,
    };
  }

  return {
    key: "progress",
    label: "Em andamento",
    state: OFFICE_SIGNAL.EM_ANDAMENTO,
    comment: "",
    tone: "primary",
    lock: false,
  };
}

/* =========================
   MOCK / Console debug
   ========================= */

function makeMockTask(i = 1) {
  const id = `mock_${i}_${Math.random().toString(16).slice(2)}`;
  const priorities = ["alta", "media", "baixa"];
  const statuses = ["aberta", "pendente", "feito", "deu_ruim"];
  const p = priorities[i % priorities.length];
  const st = statuses[i % statuses.length];
  const now = Date.now();

  const fakeTS = (ms) => ({
    toDate: () => new Date(ms),
  });

  return {
    id,
    message: `Tarefa MOCK #${i} — delivery retry + telegram`,
    createdBy: { name: i % 2 === 0 ? "Mateus" : "Office" },
    createdAt: fakeTS(now - i * 60 * 60 * 1000),
    officeSignaledAt:
      i % 3 === 0 ? fakeTS(now - i * 20 * 60 * 1000) : null,
    priority: p,
    status: st,
    officeSignal:
      i % 3 === 0
        ? {
            state:
              i % 2 === 0
                ? OFFICE_SIGNAL.PRECISO_AJUDA
                : OFFICE_SIGNAL.EM_ANDAMENTO,
            comment: "",
          }
        : "",
  };
}

/* =========================
   Delivery queue (NEW)
   ========================= */

const DELIVERY_KEY = "vero_office_delivery_queue_v1";

function loadDeliveryQueue() {
  try {
    const raw = localStorage.getItem(DELIVERY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveDeliveryQueue(items) {
  try {
    localStorage.setItem(DELIVERY_KEY, JSON.stringify(items || []));
  } catch {}
}

function newDeliveryItem({ taskId, state, comment, by }) {
  return {
    id: `d_${taskId}_${Math.random().toString(16).slice(2)}`,
    taskId,
    state,
    comment: comment || "",
    by: by || null,
    attempts: 0,
    createdAt: nowMs(),
    nextAt: nowMs() + 2500,
    lastErr: "",
  };
}

function computeBackoffMs(attempts) {
  const base = 2500 * Math.pow(2, Math.max(0, attempts));
  return Math.min(base, 40000);
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

  // Autocomplete state
  const [acOpen, setAcOpen] = useState(false);
  const [acIdx, setAcIdx] = useState(0);
  const searchWrapRef = useRef(null);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.7);
  const [muteUntilMs, setMuteUntilMs] = useState(0);

  const [fontScale, setFontScale] = useState(1.0);
  const [density, setDensity] = useState("normal");
  const [visualAlert, setVisualAlert] = useState("pulse");

  const [mockMode, setMockMode] = useState(false);
  const unsubRef = useRef(null);

  // multi seleção
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // delivery queue state
  const [deliveryQueue, setDeliveryQueue] = useState(() => loadDeliveryQueue());
  const deliveryQueueRef = useRef(deliveryQueue);
  useEffect(() => {
    deliveryQueueRef.current = deliveryQueue;
    saveDeliveryQueue(deliveryQueue);
  }, [deliveryQueue]);

  const lastBeepMsRef = useRef(0);
  const seenPendingIdsRef = useRef(new Set());
  const lastOfficeStateByIdRef = useRef(new Map());
  const lastForceByTaskRef = useRef(new Map());

  const audioRef = useRef(null);
  if (!audioRef.current && typeof window !== "undefined") {
    audioRef.current = createAudioManagerNoAutostart();
  }

  // ✅ ENV
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
    if (!BOT_BASE_URL)
      m.push("VITE_OFFICE_API_URL (ou VITE_API_BASE_URL / VITE_BOT_BASE_URL)");
    if (!OFFICE_SECRET) m.push("VITE_OFFICE_API_SECRET");
    return m;
  }, [BOT_BASE_URL, OFFICE_SECRET]);

  useEffect(() => {
    try {
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
    try {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    } catch {}

    if (mockMode) {
      setErr(null);
      return;
    }

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

    unsubRef.current = unsub;
    return () => {
      try {
        unsub();
      } catch {}
    };
  }, [mockMode]);

  // ---------- Load prefs ----------
  useEffect(() => {
    const p = loadUIPrefs();
    if (p) {
      if (typeof p.soundEnabled === "boolean") setSoundEnabled(p.soundEnabled);
      if (typeof p.soundVolume === "number")
        setSoundVolume(clamp(p.soundVolume, 0, 1));
      if (typeof p.muteUntilMs === "number") setMuteUntilMs(p.muteUntilMs);
      if (typeof p.fontScale === "number")
        setFontScale(clamp(p.fontScale, 1, 1.4));
      if (typeof p.density === "string")
        setDensity(p.density === "compact" ? "compact" : "normal");
      if (typeof p.visualAlert === "string")
        setVisualAlert(p.visualAlert === "none" ? "none" : "pulse");
    }
  }, []);

  // ---------- Persist prefs ----------
  useEffect(() => {
    saveUIPrefs({
      soundEnabled,
      soundVolume,
      muteUntilMs,
      fontScale,
      density,
      visualAlert,
    });
  }, [soundEnabled, soundVolume, muteUntilMs, fontScale, density, visualAlert]);

  // ---------- Audio unlock ----------
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
      const st = normalizeStatus(t.status);
      const isPending = ["aberta", "pendente"].includes(String(st || ""));
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
        if (
          curState === OFFICE_SIGNAL.PRECISO_AJUDA ||
          curState === OFFICE_SIGNAL.APRESENTOU_PROBLEMAS
        ) {
          shouldBeep = true;
        }
      }
      lastOfficeStateByIdRef.current.set(t.id, curState);
    }

    const mgr = audioRef.current;
    if (shouldBeep && canBeep() && mgr) {
      lastBeepMsRef.current = nowMs();
      mgr.beep({ volume: soundVolume }).then((ok) => {
        if (!ok)
          setToast("🔊 Áudio bloqueado: clique/tap na tela para liberar o som.");
      });
    }
  }, [tasks, soundEnabled, soundVolume, muteUntilMs]);

  // ---------- Office API call ----------
  async function callOfficeSignalApi({
    taskId,
    state,
    comment,
    by,
    forceNotify = false,
  }) {
    if (!BOT_BASE_URL || !OFFICE_SECRET) {
      return { ok: false, skipped: true, reason: "missing_env" };
    }

    const url = `${BOT_BASE_URL}/office/signal`;

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-office-secret": OFFICE_SECRET,
        },
        body: JSON.stringify({
          taskId,
          state,
          comment: comment || "",
          by: by || null,
          forceNotify: Boolean(forceNotify),
          client: "office-web",
          at: new Date().toISOString(),
        }),
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

    if (!res.ok || !data.ok)
      throw new Error(data?.error || `Falha HTTP ${res.status}`);
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

  function enqueueDelivery({ taskId, state, comment, by, reason }) {
    setDeliveryQueue((prev) => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const exists = arr.find(
        (x) =>
          x.taskId === taskId &&
          x.state === state &&
          String(x.comment || "") === String(comment || "")
      );
      if (exists) return arr;

      const item = newDeliveryItem({ taskId, state, comment, by });
      item.lastErr = safeStr(reason);
      return [item, ...arr].slice(0, 40);
    });
  }

  // ---------- Delivery processor (retry automático) ----------
  useEffect(() => {
    if (mockMode) return;
    if (!envOk) return;

    const timer = setInterval(async () => {
      const q = deliveryQueueRef.current || [];
      if (!Array.isArray(q) || q.length === 0) return;

      const due = q.find((it) => it && Number(it.nextAt || 0) <= nowMs());
      if (!due) return;

      const u = auth.currentUser;
      const byEmail = u?.email || "office-web";
      const byUid = u?.uid || "office-web";
      const by = { uid: byUid, email: byEmail };

      try {
        const resp = await callOfficeSignalApi({
          taskId: due.taskId,
          state: due.state,
          comment: due.comment,
          by,
          forceNotify: true,
        });

        const notified = resp?.notified === true;

        if (notified) {
          setDeliveryQueue((prev) =>
            (Array.isArray(prev) ? prev : []).filter((x) => x.id !== due.id)
          );
          setToast("✅ Entrega no Telegram confirmada (retry).");
        } else {
          setDeliveryQueue((prev) => {
            const arr = Array.isArray(prev) ? [...prev] : [];
            const idx = arr.findIndex((x) => x.id === due.id);
            if (idx >= 0) {
              const next = { ...arr[idx] };
              next.attempts = (Number(next.attempts || 0) || 0) + 1;
              next.lastErr = "notified:false (backend)";
              next.nextAt = nowMs() + computeBackoffMs(next.attempts);
              arr[idx] = next;
            }
            return arr;
          });
        }
      } catch (e) {
        setDeliveryQueue((prev) => {
          const arr = Array.isArray(prev) ? [...prev] : [];
          const idx = arr.findIndex((x) => x.id === due.id);
          if (idx >= 0) {
            const next = { ...arr[idx] };
            next.attempts = (Number(next.attempts || 0) || 0) + 1;
            next.lastErr = safeStr(e?.message || e);
            next.nextAt = nowMs() + computeBackoffMs(next.attempts);
            arr[idx] = next;
          }
          return arr;
        });
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [mockMode, envOk]);

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
          setToast(
            `🕒 Aguarde ${msToHuman(minGap - (nowMs() - last))} para reenviar novamente.`
          );
          setBusyId(null);
          return;
        }
        lastForceByTaskRef.current.set(taskId, nowMs());
      }

      try {
        if (mockMode) {
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== taskId) return t;
              return {
                ...t,
                officeSignal: { state, comment: comment || "" },
                officeComment: comment || "",
                officeSignaledAt: { toDate: () => new Date() },
              };
            })
          );
          setToast("✅ (MOCK) Sinal aplicado localmente.");
          return;
        }

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

        try {
          const resp = await callOfficeSignalApi({
            taskId,
            state,
            comment,
            by: { uid: byUid, email: byEmail },
            forceNotify,
          });

          const notified = resp?.notified === true;

          if (notified) {
            setToast(
              forceNotify
                ? "✅ Reenviado ao Telegram (forçado)."
                : "✅ Sinal enviado ao Telegram."
            );
          } else {
            enqueueDelivery({
              taskId,
              state,
              comment,
              by: { uid: byUid, email: byEmail },
              reason: "notified:false",
            });
            setToast("⚠️ Sinal salvo, mas Telegram não confirmou. Vou reenviar automaticamente.");
          }
        } catch (apiErr) {
          if (lock) await unlockTask(taskId);

          enqueueDelivery({
            taskId,
            state,
            comment,
            by: { uid: byUid, email: byEmail },
            reason: apiErr?.message || "api_error",
          });

          setToast(
            `⚠️ Sinal salvo, mas falhou avisar no Telegram. Vou tentar novamente automaticamente.`
          );
        }
      } catch (e) {
        setErr(e?.message || "Falha ao sinalizar.");
      } finally {
        setBusyId(null);
      }
    },
    [BOT_BASE_URL, OFFICE_SECRET, mockMode]
  );

  const resendTelegramOnly = useCallback(
    async (taskId, state, comment) => {
      if (mockMode) return setToast("ℹ️ (MOCK) Reenvio Telegram ignorado.");
      if (!envOk) return setToast("⚠️ Backend não configurado no front.");
      setBusyId(taskId);
      setErr(null);
      setToast(null);

      try {
        const u = auth.currentUser;
        const byEmail = u?.email || "office-web";
        const byUid = u?.uid || "office-web";

        const resp = await callOfficeSignalApi({
          taskId,
          state,
          comment: comment || "",
          by: { uid: byUid, email: byEmail },
          forceNotify: true,
        });

        if (resp?.notified === true) {
          setToast("✅ Telegram confirmado (reenviado).");
        } else {
          enqueueDelivery({
            taskId,
            state,
            comment,
            by: { uid: byUid, email: byEmail },
            reason: "notified:false(resend)",
          });
          setToast("⚠️ Reenvio não confirmou. Vou insistir automaticamente.");
        }
      } catch (e) {
        enqueueDelivery({
          taskId,
          state,
          comment,
          by: null,
          reason: e?.message || "resend_error",
        });
        setToast("⚠️ Falhou reenviar agora. Vou tentar automaticamente.");
      } finally {
        setBusyId(null);
      }
    },
    [mockMode, envOk]
  );

  const bulkUpdateSignal = useCallback(
    async (state, comment = "", { lock = false } = {}) => {
      const ids = Array.from(selectedIds || []);
      if (ids.length === 0) return;

      const openIds = ids.filter((id) => {
        const t = tasks.find((x) => x.id === id);
        if (!t) return false;
        return !isClosedStatus(t.status);
      });

      if (openIds.length === 0) {
        setToast("ℹ️ Nenhuma tarefa aberta selecionada.");
        return;
      }

      setToast(null);
      setErr(null);

      for (const id of openIds) {
        // eslint-disable-next-line no-await-in-loop
        await updateSignal(id, state, comment, { lock, forceNotify: false });
      }

      setSelectedIds(new Set());
      setToast(`✅ Ação aplicada em ${openIds.length} tarefa(s).`);
    },
    [selectedIds, tasks, updateSignal]
  );

  const bulkResendTelegram = useCallback(async () => {
    const ids = Array.from(selectedIds || []);
    if (ids.length === 0) return;

    const openTasks = ids
      .map((id) => tasks.find((t) => t.id === id))
      .filter(Boolean)
      .filter((t) => !isClosedStatus(t.status));

    if (openTasks.length === 0) {
      setToast("ℹ️ Nenhuma tarefa aberta selecionada.");
      return;
    }

    setToast(null);
    setErr(null);

    for (const t of openTasks) {
      const officeState = normalizeOfficeState(t.officeSignal);
      const comment =
        t?.officeSignal && typeof t.officeSignal === "object"
          ? safeStr(t.officeSignal.comment)
          : safeStr(t.officeComment);

      // eslint-disable-next-line no-await-in-loop
      await resendTelegramOnly(
        t.id,
        officeState || OFFICE_SIGNAL.COMENTARIO,
        comment || ""
      );
    }

    setSelectedIds(new Set());
  }, [selectedIds, tasks, resendTelegramOnly]);

  async function onLogout() {
    await signOut(auth);
  }

  // ---------- Autocomplete suggestions ----------
  const suggestions = useMemo(() => {
    const q = String(filter || "").trim();
    const qTokens = tokenize(q);
    if (qTokens.length === 0) return [];

    // limita o custo: só sugere se tiver pelo menos 2 chars (ou 1 token grande)
    if (q.length < 2) return [];

    const scored = (Array.isArray(tasks) ? tasks : [])
      .map((t) => ({
        t,
        score: scoreTaskForQuery(t, qTokens),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.t);

    // evita duplicar sugestões idênticas por preview
    const uniq = uniqueBy(scored, (t) => normalizeText(taskPreview(t)).slice(0, 120));
    return uniq.slice(0, 10);
  }, [tasks, filter]);

  useEffect(() => {
    if (!filter) {
      setAcOpen(false);
      setAcIdx(0);
      return;
    }
    if (suggestions.length) {
      setAcOpen(true);
      setAcIdx(0);
    } else {
      setAcOpen(false);
      setAcIdx(0);
    }
  }, [filter, suggestions.length]);

  // fecha ao clicar fora
  useEffect(() => {
    const onDown = (e) => {
      const el = searchWrapRef.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      setAcOpen(false);
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  function applySuggestion(t) {
    const text = taskPreview(t);
    setFilter(text);
    setAcOpen(false);
    setAcIdx(0);
  }

  const visible = useMemo(() => {
    let base = tasks;

    if (tab === TAB.PENDING)
      base = base.filter((t) => {
        const st = normalizeStatus(t.status);
        return ["aberta", "pendente"].includes(String(st || ""));
      });

    if (tab === TAB.CLOSED) base = base.filter((t) => isClosedStatus(t.status));

    if (statusFilter)
      base = base.filter(
        (t) => normalizeStatus(t.status) === normalizeStatus(statusFilter)
      );

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

        const asCanon = normalizeStatus(a.status) || "aberta";
        const bsCanon = normalizeStatus(b.status) || "aberta";

        const asr = STATUS_RANK[String(asCanon)] ?? 0;
        const bsr = STATUS_RANK[String(bsCanon)] ?? 0;
        if (asr !== bsr) return asr - bsr;

        return (bCreated || 0) - (aCreated || 0);
      }

      return (bCreated || 0) - (aCreated || 0);
    });

    return sorted;
  }, [tasks, tab, statusFilter, prioFilter, filter, sortBy]);

  const counts = useMemo(() => {
    const pending = tasks.filter((t) => {
      const st = normalizeStatus(t.status);
      return ["aberta", "pendente"].includes(String(st || ""));
    }).length;

    const closed = tasks.filter((t) => isClosedStatus(t.status)).length;

    return { pending, closed, all: tasks.length };
  }, [tasks]);

  const isMuted = muteUntilMs && nowMs() < muteUntilMs;
  const muteLeft = isMuted ? msToHuman(muteUntilMs - nowMs()) : "";

  const userLabel = user?.email || auth.currentUser?.email || "—";

  const padCard = density === "compact" ? 14 : 18;
  const titleSize = density === "compact" ? 15 : 16;
  const metaSize = 12;
  const previewScale = fontScale;

  const selectedCount = selectedIds ? selectedIds.size : 0;

  const visibleOpenIds = useMemo(() => {
    return visible
      .filter((t) => !isClosedStatus(t.status))
      .map((t) => t.id)
      .filter(Boolean);
  }, [visible]);

  const isAllVisibleSelected =
    visibleOpenIds.length > 0 && visibleOpenIds.every((id) => selectedIds.has(id));

  const toggleSelect = useCallback((id) => {
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev || []);
      for (const id of visibleOpenIds) next.add(id);
      return next;
    });
  }, [visibleOpenIds]);

  const unselectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev || []);
      for (const id of visibleOpenIds) next.delete(id);
      return next;
    });
  }, [visibleOpenIds]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [tab, filter, statusFilter, prioFilter, sortBy]);

  // Expor debug no console
  useEffect(() => {
    if (typeof window === "undefined") return;

    const api = {
      enableMock: () => {
        setMockMode(true);
        setToast("ℹ️ Modo MOCK ativado (sem Firestore).");
      },
      disableMock: () => {
        setMockMode(false);
        setToast("ℹ️ Modo MOCK desativado (voltou Firestore).");
      },
      seed: (n = 8) => {
        setMockMode(true);
        const rows = Array.from({ length: Math.max(1, Number(n) || 8) }, (_, i) =>
          makeMockTask(i + 1)
        );
        setTasks(rows);
        setToast(`✅ (MOCK) Seed: ${rows.length} tarefas.`);
      },
      randomize: () => {
        setMockMode(true);
        const prios = ["alta", "media", "baixa"];
        const stats = [
          "aberta",
          "pendente",
          "feito",
          "deu_ruim",
          "open",
          "pending",
          "done",
          "failed",
        ];
        setTasks((prev) =>
          (Array.isArray(prev) ? prev : []).map((t, idx) => {
            const p = prios[(idx + Math.floor(Math.random() * 3)) % 3];
            const st = stats[(idx + Math.floor(Math.random() * stats.length)) % stats.length];
            const officeState =
              Math.random() < 0.25
                ? OFFICE_SIGNAL.PRECISO_AJUDA
                : Math.random() < 0.35
                ? OFFICE_SIGNAL.APRESENTOU_PROBLEMAS
                : Math.random() < 0.55
                ? OFFICE_SIGNAL.EM_ANDAMENTO
                : "";
            return {
              ...t,
              priority: p,
              status: st,
              officeSignal: officeState ? { state: officeState, comment: "" } : "",
              officeSignaledAt:
                Math.random() < 0.6
                  ? {
                      toDate: () =>
                        new Date(Date.now() - Math.floor(Math.random() * 6e6)),
                    }
                  : null,
            };
          })
        );
        setToast("✅ (MOCK) Randomize aplicado.");
      },
      selectAll: () => selectAllVisible(),
      clearSel: () => clearSelection(),
      sel: () => Array.from(selectedIds || []),
      delivery: () => loadDeliveryQueue(),
      clearDelivery: () => {
        setDeliveryQueue([]);
        setToast("ℹ️ Delivery queue limpa.");
      },
    };

    window.__VT = window.__VT || {};
    window.__VT.office = api;

    return () => {
      try {
        if (window.__VT && window.__VT.office === api) delete window.__VT.office;
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectAllVisible, clearSelection]);

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

        {/* Top controls */}
        <Card style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            {/* Search + Autocomplete */}
            <div ref={searchWrapRef} style={{ position: "relative", minWidth: "min(520px, 100%)" }}>
              <Input
                label="Buscar"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Nome, mensagem, comentário..."
                onFocus={() => {
                  if (suggestions.length) setAcOpen(true);
                }}
                onKeyDown={(e) => {
                  if (!acOpen || suggestions.length === 0) return;

                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAcIdx((i) => Math.min(suggestions.length - 1, i + 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAcIdx((i) => Math.max(0, i - 1));
                    return;
                  }
                  if (e.key === "Enter") {
                    if (suggestions[acIdx]) {
                      e.preventDefault();
                      applySuggestion(suggestions[acIdx]);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setAcOpen(false);
                    return;
                  }
                }}
              />

              {acOpen && suggestions.length ? (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(10,12,24,0.92)",
                    backdropFilter: "blur(10px)",
                    boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.75 }}>
                    Sugestões ({suggestions.length}) • Enter aplica • Esc fecha
                  </div>

                  <div style={{ maxHeight: 340, overflow: "auto" }}>
                    {suggestions.map((t, idx) => {
                      const pr = badgePriority(t.priority);
                      const st = badgeStatus(t.status);
                      const preview = taskPreview(t);
                      const createdAt = t.createdAt?.toDate ? t.createdAt.toDate() : null;
                      const age = createdAt ? msToHuman(nowMs() - createdAt.getTime()) : "—";
                      const from = safeStr(t.createdBy?.name) || "—";

                      const active = idx === acIdx;

                      return (
                        <button
                          key={t.id || idx}
                          type="button"
                          onMouseEnter={() => setAcIdx(idx)}
                          onMouseDown={(e) => e.preventDefault()} // não perder focus
                          onClick={() => applySuggestion(t)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "12px 12px",
                            display: "grid",
                            gap: 8,
                            border: "none",
                            background: active ? "rgba(99,102,241,0.18)" : "transparent",
                            cursor: "pointer",
                            color: "rgba(255,255,255,0.92)",
                            borderTop: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.2, flex: 1, minWidth: 240 }}>
                              {preview}
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                padding: "6px 10px",
                                borderRadius: 999,
                                border: "1px solid rgba(255,255,255,0.12)",
                                background: "rgba(255,255,255,0.06)",
                                opacity: 0.9,
                              }}
                            >
                              {age}
                            </span>
                            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                              <span
                                style={{
                                  fontSize: 11,
                                  padding: "6px 10px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.10)",
                                  background: "rgba(255,255,255,0.05)",
                                }}
                              >
                                ⚡ {pr.text}
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  padding: "6px 10px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.10)",
                                  background: "rgba(255,255,255,0.05)",
                                }}
                              >
                                📌 {st.text}
                              </span>
                            </span>
                          </div>

                          <div style={{ fontSize: 12, opacity: 0.75, display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <span>
                              👤 <b>{from}</b>
                            </span>
                            <span>
                              🧾 <code style={{ opacity: 0.9 }}>{t.id}</code>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.75 }}>Visão</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Button
                  tone={tab === TAB.PENDING ? "primary" : "ghost"}
                  onClick={() => setTab(TAB.PENDING)}
                >
                  Pendentes ({counts.pending})
                </Button>
                <Button
                  tone={tab === TAB.CLOSED ? "primary" : "ghost"}
                  onClick={() => setTab(TAB.CLOSED)}
                >
                  Finalizadas ({counts.closed})
                </Button>
                <Button
                  tone={tab === TAB.ALL ? "primary" : "ghost"}
                  onClick={() => setTab(TAB.ALL)}
                >
                  Todas ({counts.all})
                </Button>

                {mockMode ? <Badge tone="warn">🧪 MOCK</Badge> : null}
                {!mockMode && deliveryQueue.length ? (
                  <Badge
                    tone="warn"
                    title="Há entregas pendentes para Telegram (retry automático)."
                  >
                    📬 Pendências: {deliveryQueue.length}
                  </Badge>
                ) : null}
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
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={soundVolume}
                    disabled={!soundEnabled}
                    onChange={(e) => setSoundVolume(Number(e.target.value))}
                  />
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

            {/* Multi-select helpers */}
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.75 }}>Seleção</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Button
                  tone={isAllVisibleSelected ? "primary" : "ghost"}
                  disabled={visibleOpenIds.length === 0}
                  onClick={() => (isAllVisibleSelected ? unselectAllVisible() : selectAllVisible())}
                >
                  {isAllVisibleSelected ? "Desmarcar visíveis" : "Selecionar visíveis"}
                </Button>
                <Badge tone="neutral">{selectedCount} selecionada(s)</Badge>
                {selectedCount ? (
                  <Button tone="ghost" onClick={clearSelection}>
                    Limpar
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            ℹ️ Console: <code>__VT.office.delivery()</code>, <code>__VT.office.clearDelivery()</code>
          </div>
        </Card>

        {/* List */}
        <div style={{ marginTop: 14, display: "grid", gap: 12, paddingBottom: selectedCount ? 92 : 0 }}>
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
            const officeComment =
              t?.officeSignal && typeof t.officeSignal === "object"
                ? safeStr(t.officeSignal.comment)
                : safeStr(t.officeComment);

            const lockedByMaster = isClosedStatus(t.status);
            const disabled = busyId === t.id || lockedByMaster;

            const age = createdAt ? msToHuman(nowMs() - createdAt.getTime()) : "—";
            const lastSignalAgo = officeSignaledAt ? msToHuman(nowMs() - officeSignaledAt.getTime()) : "—";
            const preview = taskPreview(t);

            const primary = getPrimaryAction({ status: t.status, officeState });
            const pulse = shouldPulse({ officeState, status: t.status, visualAlert });

            const isSelected = selectedIds.has(t.id);

            return (
              <Card
                key={t.id}
                style={{
                  display: "grid",
                  gap: 12,
                  padding: padCard,
                  cursor: lockedByMaster ? "default" : "pointer",
                  border: isSelected ? "1px solid rgba(99,102,241,0.55)" : undefined,
                  boxShadow: isSelected ? "0 0 0 4px rgba(99,102,241,0.12)" : undefined,
                  ...(pulse ? { animation: "veroPulse 1.2s ease-in-out infinite" } : {}),
                }}
                onClick={(e) => {
                  const tag = String(e?.target?.tagName || "").toLowerCase();
                  const clickable = ["button", "a", "input", "textarea", "select", "label"].includes(tag);
                  if (clickable) return;
                  if (lockedByMaster) return;
                  toggleSelect(t.id);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={lockedByMaster}
                      onChange={() => toggleSelect(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: 18,
                        height: 18,
                        accentColor: "rgb(99,102,241)",
                        cursor: lockedByMaster ? "not-allowed" : "pointer",
                      }}
                      aria-label="Selecionar tarefa"
                    />
                  </div>

                  <div
                    style={{
                      fontSize: titleSize,
                      fontWeight: 800,
                      flex: 1,
                      minWidth: 240,
                      lineHeight: 1.2,
                      transform: `scale(${previewScale})`,
                      transformOrigin: "left center",
                    }}
                    title={preview}
                  >
                    {preview}
                  </div>

                  <Badge tone={pr.tone}>⚡ {pr.text}</Badge>
                  <Badge tone={st.tone}>📌 {st.text}</Badge>
                  <Badge tone="neutral">🚦 {signalLabel(officeState)}</Badge>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    flexWrap: "wrap",
                    opacity: 0.85,
                    fontSize: metaSize,
                    paddingTop: 2,
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
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

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {primary ? (
                    <Button
                      tone={primary.tone || "primary"}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSignal(t.id, primary.state, primary.comment || "", {
                          lock: Boolean(primary.lock),
                        });
                      }}
                      disabled={disabled || (!envOk && !mockMode)}
                    >
                      {primary.label}
                    </Button>
                  ) : null}

                  <Button
                    tone="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateSignal(t.id, OFFICE_SIGNAL.EM_ANDAMENTO, "", { lock: false });
                    }}
                    disabled={disabled || (!envOk && !mockMode)}
                  >
                    Em andamento
                  </Button>

                  <Button
                    tone="warn"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateSignal(t.id, OFFICE_SIGNAL.PRECISO_AJUDA, "", { lock: false });
                    }}
                    disabled={disabled || (!envOk && !mockMode)}
                  >
                    Preciso de ajuda
                  </Button>

                  <Button
                    tone="bad"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateSignal(t.id, OFFICE_SIGNAL.APRESENTOU_PROBLEMAS, "🚫 Apresentou problemas", {
                        lock: true,
                      });
                    }}
                    disabled={disabled || (!envOk && !mockMode)}
                  >
                    Apresentou problemas
                  </Button>

                  <Button
                    tone="ghost"
                    title="Reenviar notificação do sinal atual para o Telegram (sem alterar Firestore)"
                    onClick={(e) => {
                      e.stopPropagation();
                      resendTelegramOnly(t.id, officeState || OFFICE_SIGNAL.COMENTARIO, officeComment || "");
                    }}
                    disabled={disabled || (!envOk && !mockMode)}
                  >
                    Reenviar Telegram
                  </Button>

                  <CommentButton
                    task={t}
                    busy={disabled || (!envOk && !mockMode)}
                    onSave={(text) => updateSignal(t.id, OFFICE_SIGNAL.COMENTARIO, text, { lock: true })}
                    onOpenChange={() => {}}
                  />
                </div>

                <div style={{ fontSize: 12, opacity: 0.72 }}>
                  ℹ️ Conclusão final é feita pelo <b>Master</b> via Telegram.
                  {lockedByMaster ? (
                    <div style={{ marginTop: 6, opacity: 0.85 }}>
                      🔒 Master finalizou esta tarefa. A sinalização do Office está bloqueada.
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      </Shell>

      {/* Floating bulk bar */}
      {selectedCount ? (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 14,
            zIndex: 60,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              width: "min(1120px, calc(100vw - 24px))",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(10,12,24,0.78)",
              backdropFilter: "blur(10px)",
              boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
              padding: "12px 12px",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Badge tone="neutral">✅ {selectedCount} selecionada(s)</Badge>

            <Button
              tone="primary"
              disabled={selectedCount === 0 || (!envOk && !mockMode)}
              onClick={() => bulkUpdateSignal(OFFICE_SIGNAL.EM_ANDAMENTO, "", { lock: false })}
            >
              Em andamento
            </Button>

            <Button
              tone="warn"
              disabled={selectedCount === 0 || (!envOk && !mockMode)}
              onClick={() => bulkUpdateSignal(OFFICE_SIGNAL.PRECISO_AJUDA, "", { lock: false })}
            >
              Preciso de ajuda
            </Button>

            <Button
              tone="bad"
              disabled={selectedCount === 0 || (!envOk && !mockMode)}
              onClick={() =>
                bulkUpdateSignal(OFFICE_SIGNAL.APRESENTOU_PROBLEMAS, "🚫 Apresentou problemas", {
                  lock: true,
                })
              }
            >
              Apresentou problemas
            </Button>

            <Button
              tone="ghost"
              disabled={selectedCount === 0 || (!envOk && !mockMode)}
              onClick={bulkResendTelegram}
              title="Reenviar o sinal atual para o Telegram (sem alterar Firestore)"
            >
              Reenviar Telegram
            </Button>

            <div style={{ flex: 1 }} />

            <Button tone="ghost" onClick={() => setSelectedIds(new Set())}>
              Limpar seleção
            </Button>
          </div>
        </div>
      ) : null}

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

function CommentButton({ task, busy, onSave, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(safeStr(task.officeComment) || "");

  useEffect(() => {
    setText(safeStr(task.officeComment) || "");
  }, [task.officeComment]);

  useEffect(() => {
    if (typeof onOpenChange === "function") onOpenChange(open);
  }, [open, onOpenChange]);

  if (!open) {
    return (
      <Button
        tone="ghost"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Comentar
      </Button>
    );
  }

  return (
    <div
      style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ minWidth: "min(420px, 90vw)" }}>
        <label style={{ display: "block", fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
          Comentário
        </label>
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