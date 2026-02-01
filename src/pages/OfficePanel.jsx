// src/pages/OfficePanel.jsx
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
  getDoc,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import Shell from "../ui/Shell";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Input from "../ui/Input";
import Toast from "../ui/Toast";
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
   Office signal (canon)
   ========================= */

// ✅ SINAIS CANÔNICOS (bate com o backend)
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

const TAB = {
  PENDING: "pending",
  CLOSED: "closed",
  ALL: "all",
};

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
  const msg = safeStr(t.source?.text).toLowerCase();

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
   Sound alerts (frontend)
   - Toca quando chega tarefa NOVA pendente
   - Toca quando sinal vira "preciso_ajuda" ou "apresentou_problemas"
   - Anti-spam: throttle + mute 30min
   ========================= */

function makeBeepBlobUrl() {
  // Beep simples via WebAudio gerado on-demand, sem arquivo.
  // (Criamos um WAV básico via data URI? Aqui vamos de WebAudio direto ao tocar.)
  return null;
}

async function playBeep({ volume = 0.7 } = {}) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.value = 880; // Hz
    g.gain.value = Math.max(0, Math.min(1, Number(volume) || 0.7));

    o.connect(g);
    g.connect(ctx.destination);

    o.start();
    // beep curto
    await new Promise((r) => setTimeout(r, 180));
    o.stop();

    // encerra contexto
    await ctx.close().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
export default function OfficePanel() {
  const [tasks, setTasks] = useState([]);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);

  // filtros (novo)
  const [tab, setTab] = useState(TAB.PENDING); // pending | closed | all
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "" = todos
  const [prioFilter, setPrioFilter] = useState(""); // "" = todos
  const [sortBy, setSortBy] = useState(SORT.NEWEST);
  const [busyId, setBusyId] = useState(null);

  // admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);

  // create user form (admin)
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newName, setNewName] = useState("");
  const [apiBusy, setApiBusy] = useState(false);

  // 🔊 Som
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.7);
  const [muteUntilMs, setMuteUntilMs] = useState(0);

  const lastBeepMsRef = useRef(0);
  const seenPendingIdsRef = useRef(new Set()); // tarefas pendentes já vistas
  const lastOfficeStateByIdRef = useRef(new Map()); // id -> officeState anterior

  // ✅ Endpoint do backend (Render)
  const BOT_BASE_URL = import.meta.env.VITE_BOT_BASE_URL || "";
  const OFFICE_SECRET = import.meta.env.VITE_OFFICE_API_SECRET || "";
  const ADMIN_SECRET =
    import.meta.env.VITE_ADMIN_API_SECRET || import.meta.env.VITE_OFFICE_API_SECRET || "";

  // ===== DEBUG: envs =====
  useEffect(() => {
    const masked = (s) => (s ? `${String(s).slice(0, 4)}…${String(s).slice(-4)}` : "(empty)");
    console.log("[OfficePanel] ENV BOT_BASE_URL:", BOT_BASE_URL || "(empty)");
    console.log("[OfficePanel] ENV OFFICE_SECRET:", masked(OFFICE_SECRET));
    console.log("[OfficePanel] ENV ADMIN_SECRET:", masked(ADMIN_SECRET));
    console.log("[OfficePanel] location.origin:", window.location.origin);
  }, [BOT_BASE_URL, OFFICE_SECRET, ADMIN_SECRET]);

  // ---------- Admin check ----------
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;

    (async () => {
      try {
        const ref = doc(db, "settings", "admins", u.uid);
        const snap = await getDoc(ref);
        setIsAdmin(snap.exists());
      } catch {
        setIsAdmin(false);
      } finally {
        setCheckingAdmin(false);
      }
    })();
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

  // ---------- Sound: load saved prefs ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem("vero_office_sound_prefs");
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.enabled === "boolean") setSoundEnabled(p.enabled);
        if (typeof p.volume === "number") setSoundVolume(Math.max(0, Math.min(1, p.volume)));
        if (typeof p.muteUntilMs === "number") setMuteUntilMs(p.muteUntilMs);
      }
    } catch {}
  }, []);

  // ---------- Sound: persist prefs ----------
  useEffect(() => {
    try {
      localStorage.setItem(
        "vero_office_sound_prefs",
        JSON.stringify({ enabled: soundEnabled, volume: soundVolume, muteUntilMs })
      );
    } catch {}
  }, [soundEnabled, soundVolume, muteUntilMs]);

  // ---------- Sound: trigger rules ----------
  useEffect(() => {
    // Regras:
    // 1) Nova tarefa em status aberta/pendente => beep
    // 2) Mudança de sinal para "preciso_ajuda" ou "apresentou_problemas" => beep
    // Anti-spam: beep no max a cada 4s (local) + mute

    if (!soundEnabled) return;
    if (muteUntilMs && nowMs() < muteUntilMs) return;

    const throttleMs = 4000;
    const canBeep = () => nowMs() - (lastBeepMsRef.current || 0) > throttleMs;

    let shouldBeep = false;

    // 1) novas pendentes
    for (const t of tasks) {
      if (!t?.id) continue;
      const isPending = ["aberta", "pendente"].includes(String(t.status || ""));
      if (!isPending) continue;

      if (!seenPendingIdsRef.current.has(t.id)) {
        // marca como vista e toca
        seenPendingIdsRef.current.add(t.id);
        // evita beep inicial em “lote grande”: toca só se já tinha algo visto antes
        // (se for o primeiro carregamento, esse set estará vazio até agora)
        // Estratégia: se já existia pelo menos 1 item visto antes, beep.
        if (seenPendingIdsRef.current.size > 1) shouldBeep = true;
      }
    }

    // 2) mudanças críticas de sinal do escritório
    for (const t of tasks) {
      if (!t?.id) continue;

      const curState = normalizeOfficeState(t.officeSignal);
      const prev = lastOfficeStateByIdRef.current.get(t.id) || "";

      if (curState && curState !== prev) {
        // mudou de sinal
        if (
          curState === OFFICE_SIGNAL.PRECISO_AJUDA ||
          curState === OFFICE_SIGNAL.APRESENTOU_PROBLEMAS
        ) {
          shouldBeep = true;
        }
      }

      lastOfficeStateByIdRef.current.set(t.id, curState);
    }

    if (shouldBeep && canBeep()) {
      lastBeepMsRef.current = nowMs();
      // tentar tocar (pode falhar se browser exigir “gesture”)
      playBeep({ volume: soundVolume }).then((ok) => {
        if (!ok) {
          // se falhar, avisa o usuário uma vez (sem spam)
          // (não vamos setar toast sempre; só se nunca avisou)
          const key = "vero_office_sound_warned";
          try {
            const warned = localStorage.getItem(key);
            if (!warned) {
              localStorage.setItem(key, "1");
              setToast("🔊 Ative o áudio: clique em qualquer botão na página para liberar o som.");
            }
          } catch {}
        }
      });
    }
  }, [tasks, soundEnabled, soundVolume, muteUntilMs]);

  // ---------- Office API call ----------
  async function callOfficeSignalApi({ taskId, state, comment, by }) {
    console.log("[office/signal] preparing request", {
      taskId,
      state,
      hasBase: !!BOT_BASE_URL,
      hasSecret: !!OFFICE_SECRET,
      by,
      commentLen: String(comment || "").length,
    });

    if (!BOT_BASE_URL || !OFFICE_SECRET) {
      console.warn("[office/signal] skipped: missing env", { BOT_BASE_URL, hasSecret: !!OFFICE_SECRET });
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
        }),
      });
    } catch (netErr) {
      console.error("[office/signal] fetch failed (network/CORS?)", netErr);
      throw new Error(`Falha de rede/CORS: ${netErr?.message || netErr}`);
    }

    console.log("[office/signal] response status", res.status);

    const raw = await res.text().catch(() => "");
    console.log("[office/signal] response raw (first 300)", String(raw || "").slice(0, 300));

    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (jsonErr) {
      console.error("[office/signal] JSON parse failed", jsonErr);
      throw new Error(`Resposta não-JSON do backend (status ${res.status}).`);
    }

    console.log("[office/signal] response json", data);

    if (!res.ok || !data.ok) {
      throw new Error(data?.error || `Falha HTTP ${res.status}`);
    }

    return data;
  }

  const updateSignal = useCallback(
    async (taskId, state, comment = "", { lock = false } = {}) => {
      console.log("[updateSignal] click", { taskId, state, lock, comment });

      setBusyId(taskId);
      setErr(null);
      setToast(null);

      // “gesture” do usuário → libera áudio em muitos browsers
      if (soundEnabled && (!muteUntilMs || nowMs() >= muteUntilMs)) {
        playBeep({ volume: 0.001 }).catch(() => {}); // beep inaudível só pra destravar
      }

      try {
        const u = auth.currentUser;
        const byEmail = u?.email || "office-web";
        const byUid = u?.uid || "office-web";

        console.log("[updateSignal] currentUser", { byEmail, byUid, hasUser: !!u });

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

        console.log("[updateSignal] updateDoc patch", patch);

        await updateDoc(ref, patch);

        console.log("[updateSignal] Firestore updated OK, calling backend...");

        try {
          const resp = await callOfficeSignalApi({
            taskId,
            state,
            comment,
            by: { uid: byUid, email: byEmail },
          });

          // backend novo pode responder telegramOk=false e ok=true
          if (resp?.telegramOk === false) {
            setToast(
              `⚠️ Sinal salvo, mas não consegui avisar o master agora.\n${resp?.telegram?.description || "Telegram falhou."}`
            );
          } else if (resp?.notified === true) {
            setToast("✅ Sinal enviado ao master.");
          } else if (resp?.reason === "cooldown") {
            setToast("🕒 Sinal salvo. Anti-spam: master já foi avisado recentemente (~90s).");
          } else if (resp?.reason === "duplicate" || resp?.skipped) {
            setToast("ℹ️ Sinal idêntico ao anterior. Não reenviado.");
          } else {
            setToast("✅ Sinal salvo. (Sem nova notificação agora.)");
          }
        } catch (apiErr) {
          console.error("[updateSignal] backend notify failed", apiErr);
          setToast(`⚠️ Sinal salvo, mas falhou avisar o master.\n${apiErr?.message || "Erro no backend."}`);
        }
      } catch (e) {
        console.error("[updateSignal] failed", e);
        setErr(e?.message || "Falha ao sinalizar.");
      } finally {
        setBusyId(null);
      }
    },
    [BOT_BASE_URL, OFFICE_SECRET, soundEnabled, muteUntilMs, soundVolume]
  );

  async function onLogout() {
    await signOut(auth);
  }

  async function createUserViaBot() {
    try {
      setToast(null);

      if (!isAdmin) {
        setToast("🚫 Você não é admin para criar usuários.");
        return;
      }
      if (!BOT_BASE_URL) {
        setToast("🚫 Faltou configurar VITE_BOT_BASE_URL no Netlify.");
        return;
      }
      if (!ADMIN_SECRET) {
        setToast("🚫 Faltou configurar VITE_ADMIN_API_SECRET (ou VITE_OFFICE_API_SECRET) no Netlify.");
        return;
      }
      if (!newEmail.trim() || !newPass || newPass.length < 6) {
        setToast("⚠️ Preencha email e senha (mínimo 6 caracteres).");
        return;
      }

      setApiBusy(true);

      const res = await fetch(`${BOT_BASE_URL}/admin/createUser`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": ADMIN_SECRET,
        },
        body: JSON.stringify({
          email: newEmail.trim(),
          password: newPass,
          name: newName || newEmail.trim().split("@")[0],
          role: "office",
          active: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data?.error || `Falha HTTP ${res.status}`);

      setToast(`✅ Usuário criado: ${data.email} (${data.uid})`);
      setNewEmail("");
      setNewPass("");
      setNewName("");
    } catch (e) {
      setToast(e?.message || "Falha ao criar usuário.");
    } finally {
      setApiBusy(false);
    }
  }

  // ---------- Visible (tabs + filtros + ordenação) ----------
  const visible = useMemo(() => {
    let base = tasks;

    // TAB
    if (tab === TAB.PENDING) base = base.filter((t) => ["aberta", "pendente"].includes(String(t.status || "")));
    if (tab === TAB.CLOSED) base = base.filter((t) => isClosedStatus(String(t.status || "")));

    // status filter (exato)
    if (statusFilter) base = base.filter((t) => String(t.status || "") === statusFilter);

    // prioridade filter
    if (prioFilter) base = base.filter((t) => String(t.priority || "") === prioFilter);

    // busca
    base = base.filter((t) => includesText(t, filter));

    // ordenação
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

  // counters
  const counts = useMemo(() => {
    const pending = tasks.filter((t) => ["aberta", "pendente"].includes(String(t.status || ""))).length;
    const closed = tasks.filter((t) => isClosedStatus(String(t.status || ""))).length;
    return { pending, closed, all: tasks.length };
  }, [tasks]);

  const isMuted = muteUntilMs && nowMs() < muteUntilMs;
  const muteLeft = isMuted ? msToHuman(muteUntilMs - nowMs()) : "";
  return (
    <Shell>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>VeroTasks — Painel do Escritório</h1>
          <div style={{ opacity: 0.75, marginTop: 4 }}>
            Logado como: {auth.currentUser?.email || "—"}
            {checkingAdmin ? "" : isAdmin ? " • (admin)" : " • (office)"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <Input
            label="Buscar"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Nome, mensagem, comentário..."
          />

          {/* TABS */}
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

          {/* STATUS FILTER */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12, opacity: 0.75 }}>Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                height: 40,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "#e5e7eb",
                padding: "0 10px",
                outline: "none",
                minWidth: 160,
              }}
            >
              <option value="">Todos</option>
              <option value="aberta">Aberta</option>
              <option value="pendente">Pendente</option>
              <option value="feito">Feito</option>
              <option value="feito_detalhes">Feito (detalhes)</option>
              <option value="deu_ruim">Deu ruim</option>
            </select>
          </div>

          {/* PRIORITY FILTER */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12, opacity: 0.75 }}>Prioridade</label>
            <select
              value={prioFilter}
              onChange={(e) => setPrioFilter(e.target.value)}
              style={{
                height: 40,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "#e5e7eb",
                padding: "0 10px",
                outline: "none",
                minWidth: 140,
              }}
            >
              <option value="">Todas</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
          </div>

          {/* SORT */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12, opacity: 0.75 }}>Ordenar</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                height: 40,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "#e5e7eb",
                padding: "0 10px",
                outline: "none",
                minWidth: 160,
              }}
            >
              <option value={SORT.NEWEST}>Mais recentes</option>
              <option value={SORT.OLDEST}>Mais antigas</option>
              <option value={SORT.PRIORITY}>Prioridade</option>
              <option value={SORT.LAST_SIGNAL}>Último sinal</option>
            </select>
          </div>

          {/* SOUND */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12, opacity: 0.75 }}>Som</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Button
                tone={soundEnabled ? "primary" : "ghost"}
                onClick={() => {
                  setSoundEnabled((v) => !v);
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
                    const ok = await playBeep({ volume: soundVolume });
                    setToast(ok ? "🔊 Teste: ok." : "🔊 Não consegui tocar (clique em qualquer botão e tente de novo).");
                  }}
                >
                  Testar
                </Button>
              </div>
            </div>
          </div>

          <Button onClick={onLogout} tone="ghost">
            Sair
          </Button>
        </div>
      </div>

      {/* TOASTS */}
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

      {/* ADMIN CARD */}
      {isAdmin ? (
        <Card style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Admin — Criar usuário do escritório</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10 }}>
            <Input label="Nome" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Priscila" />
            <Input
              label="Email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="office@empresa.com"
            />
            <Input
              label="Senha"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="mín. 6"
            />
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.75 }}>Ação</label>
              <Button disabled={apiBusy} onClick={createUserViaBot}>
                {apiBusy ? "Criando..." : "Criar usuário"}
              </Button>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            *Este fluxo cria o usuário via BOT (Admin SDK) e grava o perfil no Firestore.
          </div>
        </Card>
      ) : null}

      {/* LIST */}
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

          const locked = Boolean(t.officeSignalLock) || isClosedStatus(t.status);
          const disabled = busyId === t.id || locked;

          const age = createdAt ? msToHuman(nowMs() - createdAt.getTime()) : "—";
          const lastSignalAgo = officeSignaledAt ? msToHuman(nowMs() - officeSignaledAt.getTime()) : "—";

          return (
            <Card key={t.id} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 900, flex: 1, minWidth: 240 }}>
                  {safeStr(t.source?.text) || "(sem mensagem)"}
                </div>

                <Badge tone={pr.tone}>⚡ {pr.text}</Badge>
                <Badge tone={st.tone}>📌 {st.text}</Badge>
                <Badge tone="neutral">🚦 {signalLabel(officeState)}</Badge>
              </div>

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", opacity: 0.85 }}>
                <div>
                  🧾 ID: <code style={{ opacity: 0.9 }}>{t.id}</code>
                </div>
                <div>
                  👤 De: <b>{safeStr(t.createdBy?.name) || "—"}</b>
                </div>
                <div>🕒 Criada: {createdAt ? fmtDateTime(createdAt) : "—"} • <b>{age}</b></div>
                <div>
                  🧷 Último sinal: {officeSignaledAt ? fmtDateTime(officeSignaledAt) : "—"} • <b>{lastSignalAgo}</b>
                </div>
              </div>

              {t.details ? (
                <div style={{ background: "rgba(255,255,255,0.04)", padding: 12, borderRadius: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Detalhes (master)</div>
                  <div style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>{safeStr(t.details)}</div>
                </div>
              ) : null}

              {t.officeComment ? (
                <div style={{ background: "rgba(255,255,255,0.04)", padding: 12, borderRadius: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Comentário do escritório</div>
                  <div style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>{safeStr(t.officeComment)}</div>
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button
                  onClick={() => updateSignal(t.id, OFFICE_SIGNAL.EM_ANDAMENTO, "", { lock: false })}
                  disabled={disabled}
                >
                  Em andamento
                </Button>

                <Button
                  tone="warn"
                  onClick={() => updateSignal(t.id, OFFICE_SIGNAL.PRECISO_AJUDA, "", { lock: false })}
                  disabled={disabled}
                >
                  Preciso de ajuda
                </Button>

                <Button
                  tone="bad"
                  onClick={() =>
                    updateSignal(t.id, OFFICE_SIGNAL.APRESENTOU_PROBLEMAS, "🚫 Apresentou problemas", { lock: true })
                  }
                  disabled={disabled}
                >
                  Apresentou problemas
                </Button>

                <Button
                  tone="primary"
                  onClick={() =>
                    updateSignal(t.id, OFFICE_SIGNAL.TAREFA_EXECUTADA, "✅ Tarefa executada", { lock: true })
                  }
                  disabled={disabled}
                >
                  Tarefa executada
                </Button>

                <CommentButton
                  task={t}
                  busy={disabled}
                  onSave={(text) => updateSignal(t.id, OFFICE_SIGNAL.COMENTARIO, text, { lock: true })}
                />
              </div>

              <div style={{ fontSize: 12, opacity: 0.72 }}>
                *O escritório apenas sinaliza. <b>Conclusão final</b> é exclusiva do Master/Telegram.
                {locked ? (
                  <div style={{ marginTop: 6, opacity: 0.85 }}>
                    🔒 Sinalização bloqueada para evitar spam (aguardando ação do Master).
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </Shell>
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
