// src/pages/MasterPanel.jsx
/* eslint-disable */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Shell from "../ui/Shell";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import Toast from "../ui/Toast";
import Spinner from "../ui/Spinner";
import useAuthUser from "../auth/useAuthUser";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  getDocFromServer,
} from "firebase/firestore";
import { db } from "../firebase";

import {
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_BADGE,
  TASK_STATUS,
  STATUS_LABEL,
} from "../tasks/task.constants";

/* =========================
   Helpers
   ========================= */

function safeStr(v) {
  return String(v ?? "").trim();
}
function toLower(v) {
  return safeStr(v).toLowerCase();
}
function fmtTS(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    if (!d) return "—";
    return d.toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}
function mergeUniq(arr) {
  const set = new Set();
  const out = [];
  for (const it of arr) {
    const s = safeStr(it);
    if (!s) continue;
    const k = s.toLowerCase();
    if (set.has(k)) continue;
    set.add(k);
    out.push(s);
  }
  return out;
}
function scoreSuggestion(needle, text) {
  const n = toLower(needle);
  const t = toLower(text);
  if (!n) return 0;
  if (t === n) return 100;
  if (t.startsWith(n)) return 80;
  if (t.includes(n)) return 50;
  return 0;
}
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   Normalização robusta (PT/EN/Telegram/Legacy)
   - Evita "sumir" tarefas quando status vem diferente
   ========================= */

function makeResolver(allowed = []) {
  const list = Array.isArray(allowed) ? allowed.map((x) => safeStr(x)) : [];
  const setLower = new Set(list.map((x) => x.toLowerCase()));

  function pickFirstExisting(candidates) {
    for (const c of candidates) {
      const v = safeStr(c);
      if (!v) continue;
      if (setLower.has(v.toLowerCase())) return v;
    }
    return "";
  }

  return { list, setLower, pickFirstExisting };
}

function normalizePriorityRaw(p) {
  const s = toLower(p);
  if (!s) return "";

  const map = {
    urgent: "urgent",
    urgente: "urgent",

    high: "high",
    alta: "high",

    medium: "medium",
    media: "medium",
    média: "medium",

    low: "low",
    baixa: "low",
  };

  // tenta direto
  if (map[s]) return map[s];

  // normaliza separadores
  const s2 = s.replace(/\s+/g, "_").replace(/-+/g, "_");
  if (map[s2]) return map[s2];

  return s; // fallback
}

function normalizeStatusRaw(st) {
  const s = toLower(st);
  if (!s) return "";

  // Canon PT (office legacy)
  if (s === "aberta") return "open";
  if (s === "pendente") return "pending";
  if (s === "deu_ruim") return "blocked";
  if (s === "deu ruim") return "blocked";
  if (s === "feito") return "done";
  if (s === "feito_detalhes") return "done_details";

  // EN / enum / bot
  const map = {
    open: "open",
    opened: "open",
    new: "open",

    pending: "pending",
    waiting: "pending",
    wait: "pending",
    review: "pending",
    in_review: "pending",
    "in-review": "pending",

    blocked: "blocked",
    fail: "blocked",
    failed: "blocked",
    error: "blocked",
    problem: "blocked",
    problems: "blocked",
    issue: "blocked",
    issues: "blocked",
    bad: "blocked",

    done: "done",
    ok: "done",
    success: "done",
    completed: "done",
    complete: "done",
    closed: "done",

    done_details: "done_details",
    done_detail: "done_details",
    details: "done_details",
    detail: "done_details",
    detalhes: "done_details",
    "feito (det.)": "done_details",
    "feito(det.)": "done_details",
  };

  if (map[s]) return map[s];

  const s2 = s.replace(/\s+/g, "_").replace(/-+/g, "_");
  if (map[s2]) return map[s2];

  return s; // fallback
}

function normalizePriorityToAllowed(p, allowedPriorities) {
  const { pickFirstExisting, list } = makeResolver(allowedPriorities);
  const raw = normalizePriorityRaw(p);

  // tenta casar com o que o projeto já usa
  const candidateOrder = [
    raw,
    // se o projeto usa PT
    raw === "high" ? "alta" : "",
    raw === "medium" ? "media" : "",
    raw === "low" ? "baixa" : "",
    raw === "urgent" ? "urgente" : "",
    // se veio PT e o projeto usa EN
    raw === "alta" ? "high" : "",
    raw === "media" ? "medium" : "",
    raw === "baixa" ? "low" : "",
    raw === "urgente" ? "urgent" : "",
    // defaults comuns
    "medium",
    "media",
    "high",
    "alta",
    "low",
    "baixa",
    "urgent",
    "urgente",
  ].filter(Boolean);

  const picked = pickFirstExisting(candidateOrder);
  if (picked) return picked;

  // fallback defensivo: se a lista existe, pega o primeiro, senão "medium"
  return list[0] || "medium";
}

function normalizeStatusToAllowed(st, allowedStatuses) {
  const { pickFirstExisting, list } = makeResolver(allowedStatuses);
  const raw = normalizeStatusRaw(st);

  const candidateOrder = [
    raw,
    // se o projeto usa PT
    raw === "open" ? "aberta" : "",
    raw === "pending" ? "pendente" : "",
    raw === "blocked" ? "deu_ruim" : "",
    raw === "done" ? "feito" : "",
    raw === "done_details" ? "feito_detalhes" : "",
    // se veio PT e o projeto usa EN
    raw === "aberta" ? "open" : "",
    raw === "pendente" ? "pending" : "",
    raw === "deu_ruim" ? "blocked" : "",
    raw === "feito" ? "done" : "",
    raw === "feito_detalhes" ? "done_details" : "",
    // defaults
    "open",
    "aberta",
    "pending",
    "pendente",
    "blocked",
    "deu_ruim",
    "done",
    "feito",
    "done_details",
    "feito_detalhes",
  ].filter(Boolean);

  const picked = pickFirstExisting(candidateOrder);
  if (picked) return picked;

  // fallback defensivo
  return list[0] || "open";
}

/** Labels PT-BR “bonitos” */
const PRIO_PRETTY = {
  urgent: "Urgente",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
  urgente: "Urgente",
  média: "Média",
};

const STATUS_PRETTY = {
  open: "Aberta",
  pending: "Pendente",
  blocked: "Deu ruim",
  done: "Feita",
  done_details: "Feita (det.)",
  feita: "Feita",
  pendente: "Pendente",
  deu_ruim: "Deu ruim",
  "deu ruim": "Deu ruim",
  feito: "Feita",
  feito_detalhes: "Feita (det.)",
  aberta: "Aberta",
};

function prioPretty(p) {
  const k = safeStr(p);
  return PRIO_PRETTY[k] || PRIORITY_LABEL?.[k] || k || "—";
}
function statusPretty(s) {
  const k = safeStr(s);
  return STATUS_PRETTY[k] || STATUS_LABEL?.[k] || k || "—";
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
  if (typeof officeSignal === "string") return safeStr(officeSignal);
  if (typeof officeSignal === "object" && officeSignal.state) return safeStr(officeSignal.state);
  return "";
}

function signalLabel(sig) {
  const s = safeStr(sig);
  if (!s) return "—";
  if (s === OFFICE_SIGNAL.EM_ANDAMENTO) return "Em andamento";
  if (s === OFFICE_SIGNAL.PRECISO_AJUDA) return "Precisa de ajuda";
  if (s === OFFICE_SIGNAL.APRESENTOU_PROBLEMAS) return "Apresentou problemas";
  if (s === OFFICE_SIGNAL.TAREFA_EXECUTADA) return "Tarefa executada";
  if (s === OFFICE_SIGNAL.COMENTARIO) return "Comentado";
  return s.replace(/[_-]+/g, " ").trim() || "—";
}

function getOfficeComment(t) {
  const a = safeStr(t?.officeComment);
  if (a) return a;
  if (t?.officeSignal && typeof t.officeSignal === "object") return safeStr(t.officeSignal.comment);
  return "";
}

function officeTone(state) {
  const s = toLower(state);
  if (!s) return "neutral";
  if (
    s.includes("tarefa_executada") ||
    s.includes("execut") ||
    s.includes("feito") ||
    s.includes("ok")
  )
    return "ok";
  if (s.includes("problema") || s.includes("ruim") || s.includes("erro") || s.includes("blocked"))
    return "bad";
  if (s.includes("pend") || s.includes("aguard") || s.includes("preciso"))
    return "warn";
  return "neutral";
}

function compactUserLabel(u) {
  const name = safeStr(u?.displayName || u?.name);
  if (name) return name;
  const email = safeStr(u?.email);
  if (email) return email;
  const uid = safeStr(u?.uid || u?.id);
  return uid || "—";
}

/* =========================
   Texto defensivo da task (Master + Office legacy)
   ========================= */

function taskTitle(t) {
  return (
    safeStr(t?.title) ||
    safeStr(t?.message) ||
    safeStr(t?.description) ||
    safeStr(t?.telegram?.rawText) ||
    safeStr(t?.telegram?.text) ||
    "—"
  );
}
function getTaskText(t) {
  const parts = [
    safeStr(t?.title),
    safeStr(t?.message),
    safeStr(t?.description),
    safeStr(t?.masterComment),
    safeStr(t?.officeComment),
    t?.officeSignal && typeof t.officeSignal === "object" ? safeStr(t.officeSignal.comment) : "",
    safeStr(t?.createdBy?.name),
    safeStr(t?.telegram?.rawText),
    safeStr(t?.telegram?.text),
  ];
  return parts.filter(Boolean).join(" ").trim();
}

/* =========================
   UI atoms (melhorados)
   ========================= */

function Pill({ children, tone = "neutral", title }) {
  const map = {
    neutral: "border-white/12 bg-white/6 text-white/80",
    ok: "border-emerald-400/25 bg-emerald-400/12 text-emerald-100",
    warn: "border-amber-400/25 bg-amber-400/12 text-amber-100",
    bad: "border-rose-400/25 bg-rose-400/12 text-rose-100",
    indigo: "border-indigo-400/30 bg-indigo-400/12 text-indigo-100",
  };
  const cls = map[tone] || map.neutral;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-full border ${cls}`}
      style={{ lineHeight: 1.1 }}
    >
      {children}
    </span>
  );
}

function Divider({ my = 12 }) {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.10)", margin: `${my}px 0` }} />;
}

/**
 * Row (card da tarefa) — aqui fica o “glass” menos transparente
 * sem precisar mexer no Card.jsx do projeto inteiro.
 */
function Row({ children }) {
  return (
    <div
      className="vero-glass border border-white/12 rounded-2xl"
      style={{
        padding: 14,
        background: "linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0.26))",
        boxShadow: "0 14px 38px rgba(0,0,0,0.45)",
      }}
    >
      {children}
    </div>
  );
}

function IconBtn({ children, style, ...props }) {
  return (
    <button
      {...props}
      style={{
        height: 36,
        padding: "0 12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        color: "#e5e7eb",
        cursor: props.disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        fontWeight: 900,
        opacity: props.disabled ? 0.55 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SmallBox({ title, children, tone = "neutral" }) {
  const map = {
    neutral: "border-white/12 bg-white/6",
    ok: "border-emerald-400/22 bg-emerald-400/10",
    warn: "border-amber-400/22 bg-amber-400/10",
    bad: "border-rose-400/22 bg-rose-400/10",
    indigo: "border-indigo-400/25 bg-indigo-400/10",
  };
  const cls = map[tone] || map.neutral;

  return (
    <div className={`rounded-2xl border p-3 ${cls}`} style={{ boxShadow: "0 10px 26px rgba(0,0,0,0.22)" }}>
      {title ? <div className="text-xs font-semibold text-white/88 mb-2">{title}</div> : null}
      <div className="text-xs text-white/78 whitespace-pre-wrap leading-relaxed">{children}</div>
    </div>
  );
}

function groupTone(key) {
  if (key === "done") return "ok";
  if (key === "blocked") return "bad";
  if (key === "pending") return "warn";
  return "indigo";
}

function statusGroupKey(st, allowedStatuses) {
  const canon = normalizeStatusToAllowed(st, allowedStatuses);
  const s = toLower(canon);

  // mapeia "variantes" possíveis do seu projeto
  if (s === "done" || s === "feito" || s === "done_details" || s === "feito_detalhes") return "done";
  if (s === "blocked" || s === "deu_ruim" || s === "deu ruim") return "blocked";
  if (s === "pending" || s === "pendente") return "pending";
  return "open";
}

function groupTitle(key) {
  if (key === "done") return "Finalizadas";
  if (key === "blocked") return "Problemas";
  if (key === "pending") return "Pendentes";
  return "Abertas";
}

function SectionHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div style={{ minWidth: 0 }}>
        <div className="text-[15px] sm:text-[16px] font-extrabold text-white/92" style={{ lineHeight: 1.2 }}>
          {title}
        </div>
        {subtitle ? <div className="text-xs text-white/60 mt-1 leading-relaxed">{subtitle}</div> : null}
      </div>
      {right ? <div className="flex items-center gap-2 flex-wrap">{right}</div> : null}
    </div>
  );
}

/* =========================
   Confirm Modal (sem window.confirm/prompt)
   ========================= */

function ConfirmModal({
  open,
  title = "Confirmar",
  message = "",
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  requireText = "", // ex: "EXCLUIR"
  busy = false,
  onClose,
  onConfirm,
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const canConfirm = useMemo(() => {
    if (!open) return false;
    if (busy) return false;
    if (!requireText) return true;
    return safeStr(typed).toUpperCase() === safeStr(requireText).toUpperCase();
  }, [open, busy, requireText, typed]);

  useEffect(() => {
    function onKey(e) {
      if (!open) return;
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onMouseDown={() => onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.70)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="vero-glass border border-white/12 rounded-2xl w-full"
        style={{
          maxWidth: 720,
          padding: 16,
          background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.34))",
          boxShadow: "0 24px 70px rgba(0,0,0,0.60)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div style={{ minWidth: 0 }}>
            <div className="text-[14px] font-extrabold text-white/92">{title}</div>
            {message ? (
              <div className="text-xs text-white/72 mt-2 whitespace-pre-wrap leading-relaxed">{message}</div>
            ) : null}
          </div>

          <button
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#e5e7eb",
              borderRadius: 12,
              height: 34,
              padding: "0 12px",
              cursor: "pointer",
              fontWeight: 900,
              opacity: busy ? 0.6 : 1,
            }}
            title="Fechar (Esc)"
            disabled={busy}
          >
            ✕
          </button>
        </div>

        {requireText ? (
          <>
            <Divider my={12} />
            <SmallBox title="Confirmação extra" tone={danger ? "bad" : "warn"}>
              Para confirmar, digite <b>{requireText}</b> abaixo.
            </SmallBox>
            <div className="mt-3">
              <Input
                label="Digite para confirmar"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={requireText}
              />
            </div>
          </>
        ) : null}

        <Divider my={12} />

        <div className="flex gap-2 flex-wrap justify-end">
          <Button tone="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            tone={danger ? "bad" : undefined}
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{ opacity: canConfirm ? 1 : 0.55 }}
          >
            {busy ? "Processando..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Main
   ========================= */

export default function MasterPanel() {
  const { user } = useAuthUser();

  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // DEBUG snapshot
  const [snapInfo, setSnapInfo] = useState({
    fromCache: false,
    hasPendingWrites: false,
    lastEvent: "",
    lastErr: "",
    size: 0,
  });

  // UX
  const [createOpen, setCreateOpen] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false); // "Detalhes" do topo
  const isDev = Boolean(import.meta?.env?.DEV);
  const [showDebug, setShowDebug] = useState(() => {
    try {
      return localStorage.getItem("vt_master_debug") === "1";
    } catch {
      return false;
    }
  });

  // filtros
  const [qText, setQText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [prioFilter, setPrioFilter] = useState("all");
  const [sort, setSort] = useState("recent");

  // paginação
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // agrupamento
  const [groupByStatus, setGroupByStatus] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  // form criar
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(() => normalizePriorityToAllowed("medium", PRIORITIES));
  const [assigneeUid, setAssigneeUid] = useState("");

  // editor modal
  const [editOpen, setEditOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState(() => normalizePriorityToAllowed("medium", PRIORITIES));
  const [editAssigneeUid, setEditAssigneeUid] = useState("");
  const [editStatus, setEditStatus] = useState(() => normalizeStatusToAllowed("open", TASK_STATUS));

  // toast
  const [toast, setToast] = useState({ open: false, kind: "info", title: "", message: "" });

  // sugestões
  const [showSug, setShowSug] = useState(false);
  const [sugIdx, setSugIdx] = useState(-1);
  const qWrapRef = useRef(null);

  // detalhes por task
  const [expanded, setExpanded] = useState(() => new Set());

  // seleção
  const [selected, setSelected] = useState(() => new Set());

  // bulk
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkPrio, setBulkPrio] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // visibilidade
  const [density, setDensity] = useState("compact");
  const [bigText, setBigText] = useState(false);

  // menu de ações por tarefa
  const [openMenuId, setOpenMenuId] = useState("");

  // confirm modal state
  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    message: "",
    confirmLabel: "Confirmar",
    cancelLabel: "Cancelar",
    danger: false,
    requireText: "",
    busy: false,
    onConfirm: null,
  });

  const userLabel = useMemo(() => user?.email || "", [user]);
  const uid = user?.uid || "";

  useEffect(() => {
    console.log("[MasterPanel] mounted", { uid: user?.uid, email: user?.email, path: window?.location?.pathname });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("vt_master_debug", showDebug ? "1" : "0");
    } catch {}
  }, [showDebug]);

  /* ---------- snapshots ---------- */
  useEffect(() => {
    if (!uid) {
      console.log("[snap] waiting auth user...");
      return;
    }

    console.log("[snap] subscribing...", { uid });

    const qt = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
    const qu = query(collection(db, "users"), orderBy("createdAt", "desc"));

    const offT = onSnapshot(
      qt,
      { includeMetadataChanges: true },
      (snap) => {
        const changes = snap.docChanges();
        const resumo = changes?.length
          ? changes
              .slice(0, 10)
              .map((c) => `${c.type}:${c.doc.id}`)
              .join(" | ")
          : "";

        setSnapInfo((s) => ({
          ...s,
          fromCache: snap.metadata.fromCache,
          hasPendingWrites: snap.metadata.hasPendingWrites,
          lastEvent: resumo || s.lastEvent,
          lastErr: "",
          size: snap.size,
        }));

        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("[tasks snapshot ERROR]", err);
        setSnapInfo((s) => ({ ...s, lastErr: err?.message || String(err || "snapshot_error") }));
        setToast({
          open: true,
          kind: "error",
          title: "Snapshot (tasks) falhou",
          message: err?.message || "Erro no listener do Firestore. Veja o console.",
        });
        setLoading(false);
      }
    );

    const offU = onSnapshot(
      qu,
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.error("[users snapshot ERROR]", err)
    );

    return () => {
      console.log("[snap] unsubscribing...");
      offT();
      offU();
    };
  }, [uid]);

  useEffect(() => {
    function onDocClick(e) {
      // fecha menu ao clicar fora
      if (!openMenuId) return;
      const el = e?.target;
      if (!el) return;
      // se clicar dentro de algo com data-vt-menu-root, não fecha
      const inside = el.closest?.("[data-vt-menu-root='1']");
      if (inside) return;
      setOpenMenuId("");
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenuId]);

  const userOptions = useMemo(() => {
    const rows = Array.isArray(users) ? users.slice() : [];
    return rows
      .map((u) => ({
        uid: u.uid || u.id,
        label: compactUserLabel(u),
        email: safeStr(u.email),
        role: safeStr(u.role),
      }))
      .filter((x) => x.uid);
  }, [users]);

  const userByUid = useMemo(() => {
    const m = new Map();
    for (const u of userOptions) m.set(u.uid, u);
    return m;
  }, [userOptions]);

  /* ---------- counts ---------- */
  const counts = useMemo(() => {
    const c = { open: 0, pending: 0, blocked: 0, done: 0, officePing: 0 };
    for (const t of tasks) {
      c[statusGroupKey(t.status, TASK_STATUS)]++;
      if (normalizeOfficeState(t.officeSignal)) c.officePing++;
    }
    return c;
  }, [tasks]);

  /* ---------- suggestions ---------- */
  const suggestions = useMemo(() => {
    const needle = safeStr(qText);
    if (!needle || needle.length < 2) return [];

    const titles = tasks.map((t) => taskTitle(t)).filter(Boolean);
    const people = userOptions.map((u) => safeStr(u.label)).filter(Boolean);

    const words = [];
    for (const t of tasks) {
      const txt = getTaskText(t);
      const parts = txt
        .split(/\s+/g)
        .map((w) => w.replace(/[^\p{L}\p{N}_-]+/gu, ""))
        .filter((w) => w.length >= 4 && w.length <= 24);
      for (const w of parts) words.push(w);
      if (words.length > 420) break;
    }

    const pool = mergeUniq([...titles, ...people, ...words]);

    return pool
      .map((s) => ({ s, sc: scoreSuggestion(needle, s) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc || a.s.length - b.s.length)
      .slice(0, 8)
      .map((x) => x.s);
  }, [qText, tasks, userOptions]);

  /* ---------- filtering ---------- */
  const filtered = useMemo(() => {
    const t = toLower(qText);
    let rows = Array.isArray(tasks) ? tasks.slice() : [];

    if (statusFilter !== "all") {
      rows = rows.filter(
        (r) => normalizeStatusToAllowed(r.status, TASK_STATUS) === normalizeStatusToAllowed(statusFilter, TASK_STATUS)
      );
    }

    if (prioFilter !== "all") {
      rows = rows.filter(
        (r) => normalizePriorityToAllowed(r.priority, PRIORITIES) === normalizePriorityToAllowed(prioFilter, PRIORITIES)
      );
    }

    if (t) rows = rows.filter((r) => toLower(getTaskText(r)).includes(t));

    if (sort === "recent") {
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } else if (sort === "old") {
      rows.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    } else if (sort === "priority") {
      // ranking defensivo (EN/PT)
      const w = {
        urgent: 5,
        urgente: 5,
        high: 4,
        alta: 4,
        medium: 3,
        media: 3,
        "média": 3,
        low: 2,
        baixa: 2,
      };
      rows.sort((a, b) => {
        const ap = normalizePriorityToAllowed(a.priority, PRIORITIES);
        const bp = normalizePriorityToAllowed(b.priority, PRIORITIES);
        return (w[toLower(bp)] || 3) - (w[toLower(ap)] || 3);
      });
    }

    return rows;
  }, [tasks, qText, statusFilter, prioFilter, sort]);

  useEffect(() => setPage(1), [qText, statusFilter, prioFilter, sort]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [pageSize]);

  const pageCount = useMemo(() => {
    const total = filtered.length;
    return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  }, [filtered.length, pageSize]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const visibleIds = useMemo(() => paged.map((t) => t.id).filter(Boolean), [paged]);

  const groupsInPage = useMemo(() => {
    const map = { open: [], pending: [], blocked: [], done: [] };
    for (const t of paged) {
      const g = statusGroupKey(t.status, TASK_STATUS);
      map[g].push(t);
    }
    return map;
  }, [paged]);

  /* ---------- selection helpers ---------- */
  const selectedIds = useMemo(() => Array.from(selected).filter(Boolean), [selected]);
  const selectedCount = selectedIds.length;

  const allVisibleSelected = useMemo(() => {
    if (visibleIds.length === 0) return false;
    for (const id of visibleIds) if (!selected.has(id)) return false;
    return true;
  }, [visibleIds, selected]);

  const someVisibleSelected = useMemo(() => {
    for (const id of visibleIds) if (selected.has(id)) return true;
    return false;
  }, [visibleIds, selected]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectAllPage() {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of visibleIds) n.add(id);
      return n;
    });
  }
  function clearAllPage() {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of visibleIds) n.delete(id);
      return n;
    });
  }
  function toggleAllVisible() {
    if (allVisibleSelected) clearAllPage();
    else selectAllPage();
  }
  function selectAllFiltered() {
    setSelected(new Set(filtered.map((t) => t.id).filter(Boolean)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  /* ---------- actions ---------- */
  async function createTask() {
    const t = title.trim();
    if (t.length < 3) {
      setToast({ open: true, kind: "error", title: "Título curto", message: "Mínimo 3 caracteres." });
      return;
    }

    try {
      await addDoc(collection(db, "tasks"), {
        title: t,
        description: description.trim(),
        status: normalizeStatusToAllowed("open", TASK_STATUS),
        priority: normalizePriorityToAllowed(priority, PRIORITIES),
        assigneeUid: assigneeUid || "",
        createdByUid: uid || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        officeSignal: null,
        officeSignaledAt: null,
        officeComment: "",
        masterComment: "",
      });

      setTitle("");
      setDescription("");
      setPriority(normalizePriorityToAllowed("medium", PRIORITIES));
      setAssigneeUid("");
      setToast({ open: true, kind: "ok", title: "Criado", message: "Tarefa criada com sucesso." });
      setCreateOpen(false);
    } catch (err) {
      console.error("[create] ERROR", err);
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha ao criar tarefa." });
    }
  }

  async function quickUpdate(taskId, patch) {
    try {
      const safePatch = { ...patch };

      if (Object.prototype.hasOwnProperty.call(safePatch, "status")) {
        safePatch.status = normalizeStatusToAllowed(safePatch.status, TASK_STATUS);
      }
      if (Object.prototype.hasOwnProperty.call(safePatch, "priority")) {
        safePatch.priority = normalizePriorityToAllowed(safePatch.priority, PRIORITIES);
      }

      await updateDoc(doc(db, "tasks", taskId), { ...safePatch, updatedAt: serverTimestamp() });
    } catch (err) {
      console.error("[update] ERROR", err);
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha ao atualizar." });
    }
  }

  function openEdit(t) {
    setEditTask(t);
    setEditTitle(taskTitle(t));
    setEditDescription(safeStr(t.description));
    setEditPriority(normalizePriorityToAllowed(t.priority, PRIORITIES));
    setEditAssigneeUid(safeStr(t.assigneeUid));
    setEditStatus(normalizeStatusToAllowed(t.status, TASK_STATUS));
    setEditOpen(true);
  }
  function closeEdit() {
    setEditOpen(false);
    setEditTask(null);
  }

  async function saveEdit() {
    if (!editTask?.id) return;

    const t = editTitle.trim();
    if (t.length < 3) {
      setToast({ open: true, kind: "error", title: "Título curto", message: "Mínimo 3 caracteres." });
      return;
    }

    try {
      await updateDoc(doc(db, "tasks", editTask.id), {
        title: t,
        description: editDescription.trim(),
        priority: normalizePriorityToAllowed(editPriority, PRIORITIES),
        assigneeUid: safeStr(editAssigneeUid),
        status: normalizeStatusToAllowed(editStatus, TASK_STATUS),
        updatedAt: serverTimestamp(),
      });

      setToast({ open: true, kind: "ok", title: "Salvo", message: "Alterações salvas." });
      closeEdit();
    } catch (err) {
      console.error("[edit] ERROR", err);
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha ao salvar." });
    }
  }

  // confirma no servidor se deletou mesmo
  async function assertDeletedOnServer(taskId) {
    const snap = await getDocFromServer(doc(db, "tasks", taskId));
    if (snap.exists()) {
      throw new Error(
        `Delete não persistiu no servidor (doc ainda existe). Possível RULES negando ou processo recriando. id=${taskId}`
      );
    }
    return true;
  }

  function openConfirm(cfg) {
    setConfirm((c) => ({
      ...c,
      open: true,
      busy: false,
      title: cfg.title || "Confirmar",
      message: cfg.message || "",
      confirmLabel: cfg.confirmLabel || "Confirmar",
      cancelLabel: cfg.cancelLabel || "Cancelar",
      danger: Boolean(cfg.danger),
      requireText: cfg.requireText || "",
      onConfirm: cfg.onConfirm || null,
    }));
  }
  function closeConfirm() {
    setConfirm((c) => ({ ...c, open: false, busy: false, onConfirm: null }));
  }

  function requestDeleteSingle(t) {
    openConfirm({
      title: "Confirmar exclusão",
      message:
        `Tem certeza que deseja excluir esta tarefa?\n\n` +
        `"${taskTitle(t) || "—"}"\n` +
        `ID: ${t.id}\n\n` +
        `Isso não tem volta.`,
      confirmLabel: "Excluir agora",
      cancelLabel: "Cancelar",
      danger: true,
      requireText: "",
      onConfirm: () => doDeleteSingle(t),
    });
  }

  async function doDeleteSingle(t) {
    if (!t?.id) return;

    setConfirm((c) => ({ ...c, busy: true }));
    try {
      await deleteDoc(doc(db, "tasks", t.id));

      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(t.id);
        return n;
      });
      setExpanded((prev) => {
        const n = new Set(prev);
        n.delete(t.id);
        return n;
      });

      await assertDeletedOnServer(t.id);

      setToast({ open: true, kind: "ok", title: "Excluída", message: "Tarefa removida (confirmado no servidor)." });
      closeConfirm();
    } catch (err) {
      console.error("[delete] ERROR", err);
      setConfirm((c) => ({ ...c, busy: false }));
      setToast({
        open: true,
        kind: "error",
        title: "Falha ao excluir",
        message:
          err?.message ||
          "Falha ao excluir. Se a tarefa 'volta', normalmente é rules negando ou conexão/listen instável.",
      });
    }
  }

  function requestBulkDelete() {
    if (selectedCount === 0) {
      setToast({
        open: true,
        kind: "info",
        title: "Nenhuma selecionada",
        message: "Marque as caixas das tarefas (à esquerda) para excluir em massa.",
      });
      return;
    }

    const requireText = selectedCount >= 10 ? "EXCLUIR" : "";
    openConfirm({
      title: "Excluir selecionadas",
      message:
        `Você está prestes a excluir ${selectedCount} tarefa(s).\n\n` +
        `Isso não tem volta.\n` +
        (requireText ? `\nConfirmação extra necessária.` : ""),
      confirmLabel: `Excluir ${selectedCount}`,
      cancelLabel: "Cancelar",
      danger: true,
      requireText,
      onConfirm: () => doBulkDelete(),
    });
  }

  async function doBulkDelete() {
    if (selectedCount === 0) return;

    setConfirm((c) => ({ ...c, busy: true }));
    setBulkBusy(true);

    const ids = selectedIds.slice();

    try {
      const parts = chunk(ids, 450);
      for (const part of parts) {
        const batch = writeBatch(db);
        for (const id of part) batch.delete(doc(db, "tasks", id));
        await batch.commit();
      }

      // valida 1 id no servidor (amostra)
      const sample = ids[0];
      if (sample) {
        try {
          await assertDeletedOnServer(sample);
        } catch (e) {
          console.warn("[bulkDelete] server confirm FAIL", e);
        }
      }

      setToast({ open: true, kind: "ok", title: "Excluídas", message: `Removidas ${ids.length} tarefa(s).` });
      clearSelection();
      closeConfirm();
      setBulkOpen(false);
    } catch (err) {
      console.error("[bulkDelete] ERROR", err);
      setConfirm((c) => ({ ...c, busy: false }));
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha ao excluir em massa." });
    } finally {
      setBulkBusy(false);
    }
  }

  function onPickSuggestion(s) {
    setQText(s);
    setShowSug(false);
    setSugIdx(-1);
    try {
      qWrapRef.current?.querySelector?.("input")?.focus?.();
    } catch {}
  }

  function onKeyDownSearch(e) {
    if (!showSug || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSugIdx((v) => Math.min(suggestions.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSugIdx((v) => Math.max(-1, v - 1));
    } else if (e.key === "Enter") {
      if (sugIdx >= 0 && sugIdx < suggestions.length) {
        e.preventDefault();
        onPickSuggestion(suggestions[sugIdx]);
      }
    } else if (e.key === "Escape") {
      setShowSug(false);
      setSugIdx(-1);
    }
  }

  function toggleExpand(id) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleGroup(key) {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  async function bulkApply() {
    if (selectedCount === 0) {
      setToast({
        open: true,
        kind: "info",
        title: "Nenhuma selecionada",
        message: "Marque as caixas das tarefas (à esquerda) para aplicar em massa.",
      });
      return;
    }

    const patch = {};
    if (bulkStatus) patch.status = normalizeStatusToAllowed(bulkStatus, TASK_STATUS);
    if (bulkPrio) patch.priority = normalizePriorityToAllowed(bulkPrio, PRIORITIES);
    if (bulkAssignee !== "") patch.assigneeUid = bulkAssignee === "__CLEAR__" ? "" : bulkAssignee;

    const keys = Object.keys(patch);
    if (keys.length === 0) {
      setToast({
        open: true,
        kind: "info",
        title: "Nada para aplicar",
        message: "Escolha status/prioridade/responsável antes de aplicar.",
      });
      return;
    }

    setBulkBusy(true);

    try {
      const ids = selectedIds.slice();
      const parts = chunk(ids, 450);

      for (const part of parts) {
        const batch = writeBatch(db);
        for (const id of part) batch.update(doc(db, "tasks", id), { ...patch, updatedAt: serverTimestamp() });
        await batch.commit();
      }

      setToast({ open: true, kind: "ok", title: "Aplicado", message: `Atualizado em ${selectedCount} tarefa(s).` });
      setBulkStatus("");
      setBulkPrio("");
      setBulkAssignee("");
      setBulkOpen(false);
    } catch (err) {
      console.error("[bulkApply] ERROR", err);
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha no update em massa." });
    } finally {
      setBulkBusy(false);
    }
  }

  /* =========================
     Render helpers
     ========================= */

  const pad = density === "compact" ? 12 : 16;
  const titleSize = bigText ? 16 : 14;

  const handleEscClose = useCallback(
    (e) => {
      if (e.key === "Escape") closeEdit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!editOpen) return;
    window.addEventListener("keydown", handleEscClose);
    return () => window.removeEventListener("keydown", handleEscClose);
  }, [editOpen, handleEscClose]);

  function TaskMenu({ t }) {
    const pr = normalizePriorityToAllowed(t.priority, PRIORITIES);
    const st = normalizeStatusToAllowed(t.status, TASK_STATUS);

    const menuBtnStyle = {
      width: "100%",
      textAlign: "left",
      padding: "10px 10px",
      fontSize: 12,
      fontWeight: 900,
      color: "rgba(255,255,255,0.88)",
      background: "transparent",
      border: "none",
      cursor: "pointer",
      lineHeight: 1.2,
    };

    function act(fn) {
      try {
        fn?.();
      } finally {
        setOpenMenuId("");
      }
    }

    const stOpen = normalizeStatusToAllowed("open", TASK_STATUS);
    const stPending = normalizeStatusToAllowed("pending", TASK_STATUS);
    const stBlocked = normalizeStatusToAllowed("blocked", TASK_STATUS);
    const stDone = normalizeStatusToAllowed("done", TASK_STATUS);

    return (
      <div
        data-vt-menu-root="1"
        className="vero-glass border border-white/12 rounded-2xl overflow-hidden"
        style={{
          position: "absolute",
          top: 40,
          right: 0,
          width: 240,
          zIndex: 60,
          background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.38))",
          boxShadow: "0 22px 62px rgba(0,0,0,0.60)",
        }}
      >
        <div style={{ padding: 10 }}>
          <div className="text-[11px] text-white/60 leading-relaxed">
            ID: <code className="text-white/80">{t.id}</code>
          </div>
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.10)" }} />

        <button style={menuBtnStyle} onClick={() => act(() => openEdit(t))}>
          ✏️ Editar
        </button>
        <button style={menuBtnStyle} onClick={() => act(() => requestDeleteSingle(t))}>
          🗑️ Excluir
        </button>

        <div style={{ height: 1, background: "rgba(255,255,255,0.10)" }} />

        <div style={{ padding: 10 }} className="text-[11px] text-white/65 font-extrabold">
          Status rápido
        </div>
        <button style={menuBtnStyle} onClick={() => act(() => (st === stOpen ? null : quickUpdate(t.id, { status: stOpen })))}>
          📌 Marcar como Aberta
        </button>
        <button style={menuBtnStyle} onClick={() => act(() => (st === stPending ? null : quickUpdate(t.id, { status: stPending })))}>
          ⏳ Marcar como Pendente
        </button>
        <button style={menuBtnStyle} onClick={() => act(() => (st === stBlocked ? null : quickUpdate(t.id, { status: stBlocked })))}>
          🟥 Marcar como Deu ruim
        </button>
        <button style={menuBtnStyle} onClick={() => act(() => (st === stDone ? null : quickUpdate(t.id, { status: stDone })))}>
          ✅ Marcar como Feita
        </button>

        <div style={{ height: 1, background: "rgba(255,255,255,0.10)" }} />

        <div style={{ padding: 10 }} className="text-[11px] text-white/65 font-extrabold">
          Prioridade rápida
        </div>
        {PRIORITIES.map((p) => {
          const norm = normalizePriorityToAllowed(p, PRIORITIES);
          return (
            <button
              key={p}
              style={menuBtnStyle}
              onClick={() => act(() => (toLower(pr) === toLower(norm) ? null : quickUpdate(t.id, { priority: norm })))}
            >
              ⚡ {prioPretty(norm)}
            </button>
          );
        })}
      </div>
    );
  }

  function TaskRow({ t }) {
    const pr = normalizePriorityToAllowed(t.priority, PRIORITIES);
    const st = normalizeStatusToAllowed(t.status, TASK_STATUS);

    const assignee = t.assigneeUid ? userByUid.get(t.assigneeUid)?.label || t.assigneeUid : "";
    const officeComment = getOfficeComment(t);
    const officeStateRaw = normalizeOfficeState(t.officeSignal);
    const officeState = signalLabel(officeStateRaw);

    const statusTone =
      toLower(st) === toLower(normalizeStatusToAllowed("done", TASK_STATUS)) ||
      toLower(st) === "feito" ||
      toLower(st) === "feito_detalhes" ||
      toLower(st) === "done_details"
        ? "ok"
        : toLower(st) === toLower(normalizeStatusToAllowed("blocked", TASK_STATUS)) ||
          toLower(st) === "deu_ruim" ||
          toLower(st) === "deu ruim"
        ? "bad"
        : toLower(st) === toLower(normalizeStatusToAllowed("pending", TASK_STATUS)) || toLower(st) === "pendente"
        ? "warn"
        : "neutral";

    const hasDetails = Boolean(safeStr(t.description) || officeComment || officeStateRaw);
    const isOpen = expanded.has(t.id);
    const isSel = selected.has(t.id);
    const menuOpen = openMenuId === t.id;

    const metaDot = <span className="text-white/30">•</span>;

    return (
      <Row>
        <div className="grid gap-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 260, flex: 1 }}>
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => toggleSelect(t.id)}
                style={{ marginTop: 5, transform: "scale(1.05)" }}
                aria-label="Selecionar tarefa"
              />

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: titleSize,
                    fontWeight: 950,
                    color: "rgba(255,255,255,0.94)",
                    lineHeight: 1.25,
                    letterSpacing: -0.2,
                  }}
                  title={taskTitle(t)}
                >
                  {taskTitle(t)}
                </div>

                <div className="mt-2 text-[12px] text-white/62 flex flex-wrap gap-x-2 gap-y-1" style={{ lineHeight: 1.35 }}>
                  <span>
                    Resp.: <b className="text-white/82">{assignee || "—"}</b>
                  </span>
                  {metaDot}
                  <span>
                    Criada: <b className="text-white/72">{fmtTS(t.createdAt)}</b>
                  </span>
                  {metaDot}
                  <span>
                    Atual.: <b className="text-white/72">{fmtTS(t.updatedAt)}</b>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap" style={{ rowGap: 8 }}>
              <span
                className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-full border ${
                  PRIORITY_BADGE?.[pr] || "border-white/12 bg-white/6"
                }`}
                title="Prioridade"
                style={{ lineHeight: 1.1 }}
              >
                <span aria-hidden>⚡</span> {prioPretty(pr)}
              </span>

              <Pill tone={statusTone} title="Status atual">
                <span aria-hidden>📌</span> {statusPretty(st)}
              </Pill>

              {officeStateRaw ? (
                <Pill tone={officeTone(officeStateRaw)} title={`Resposta do Office: ${officeState}`}>
                  <span aria-hidden>📩</span> {officeState}
                </Pill>
              ) : (
                <Pill tone="neutral" title="Sem resposta do Office">
                  <span aria-hidden>📭</span> Office: —
                </Pill>
              )}
            </div>
          </div>

          {/* Ações */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {hasDetails ? (
                <Button tone="ghost" onClick={() => toggleExpand(t.id)} style={{ height: 38 }}>
                  {isOpen ? "▾ Detalhes" : "▸ Detalhes"}
                </Button>
              ) : (
                <Button tone="ghost" disabled style={{ height: 38, opacity: 0.55 }}>
                  ▸ Detalhes
                </Button>
              )}

              <Button tone="ghost" onClick={() => openEdit(t)} style={{ height: 38 }}>
                ✏️ Editar
              </Button>

              {/* menu */}
              <div style={{ position: "relative" }} data-vt-menu-root="1">
                <Button
                  tone="ghost"
                  onClick={() => setOpenMenuId((cur) => (cur === t.id ? "" : t.id))}
                  style={{ height: 38, paddingLeft: 12, paddingRight: 12 }}
                  title="Mais ações"
                >
                  ⋯
                </Button>
                {menuOpen ? <TaskMenu t={t} /> : null}
              </div>
            </div>

            <span className="text-[11px] text-white/45" style={{ lineHeight: 1.2 }}>
              ID: <code style={{ opacity: 0.9 }}>{t.id}</code>
            </span>
          </div>

          {/* Details */}
          {hasDetails && isOpen ? (
            <div
              style={{
                padding: pad,
                borderRadius: 18,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div className="grid gap-2">
                {safeStr(t.description) ? (
                  <SmallBox title="Descrição">{safeStr(t.description)}</SmallBox>
                ) : (
                  <SmallBox title="Descrição" tone="neutral">
                    Sem descrição.
                  </SmallBox>
                )}

                {officeStateRaw ? (
                  <SmallBox title="Resposta do Office" tone={officeTone(officeStateRaw)}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div style={{ lineHeight: 1.35 }}>
                        <b className="text-white/88">{officeState || "—"}</b>
                        {t?.officeSignaledAt ? (
                          <span className="text-white/60"> {" • "} {fmtTS(t.officeSignaledAt)}</span>
                        ) : null}
                      </div>
                      <Pill tone={officeTone(officeStateRaw)}>{officeTone(officeStateRaw).toUpperCase()}</Pill>
                    </div>

                    {officeComment ? (
                      <div className="mt-2 text-white/82 whitespace-pre-wrap leading-relaxed">{officeComment}</div>
                    ) : (
                      <div className="mt-2 text-white/60 leading-relaxed">Sem comentário.</div>
                    )}
                  </SmallBox>
                ) : (
                  <SmallBox title="Resposta do Office" tone="neutral">
                    Ainda sem sinalização do Office.
                  </SmallBox>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </Row>
    );
  }

  /* =========================
     Render
     ========================= */

  return (
    <Shell title="VeroTasks" subtitle="Master — Tarefas" userLabel={userLabel} showMasterNav={true} role="master">
      {/* BARRA “SELEÇÃO ATIVA” */}
      {selectedCount > 0 ? (
        <div className="fixed left-0 right-0 bottom-3 z-50" style={{ paddingLeft: 12, paddingRight: 12 }}>
          <div
            className="vero-glass border border-white/12 rounded-2xl"
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              padding: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.32))",
              boxShadow: "0 18px 44px rgba(0,0,0,0.55)",
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone="warn" title="Tarefas selecionadas">
                ☑ Selecionadas: {selectedCount}
              </Pill>
              <span className="text-xs text-white/60 leading-relaxed">Use “Ações em massa” ou exclua.</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button tone="ghost" onClick={clearSelection} disabled={bulkBusy}>
                Limpar
              </Button>

              <Button
                tone="ghost"
                onClick={() => {
                  setBulkOpen(true);
                  const el = document.getElementById("bulk-anchor");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                disabled={bulkBusy}
              >
                Ações em massa
              </Button>

              <Button tone="bad" onClick={requestBulkDelete} disabled={bulkBusy}>
                🗑️ Excluir
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ padding: "12px 0 92px" }} className="grid gap-4">
        {/* HEADER */}
        <div className="sticky top-2 z-30" style={{ backdropFilter: "blur(12px)", paddingTop: 6, paddingBottom: 6 }}>
          <Card>
            <SectionHeader
              title="Master"
              subtitle={null}
              right={
                <>
                  <Pill tone="indigo">Total: {tasks.length}</Pill>
                  <Pill tone="indigo">Abertas: {counts.open}</Pill>
                  <Pill tone="warn">Pendentes: {counts.pending}</Pill>
                  <Pill tone="bad">Problemas: {counts.blocked}</Pill>
                  <Pill tone="ok">Finalizadas: {counts.done}</Pill>
                  <Pill tone="neutral">Office: {counts.officePing}</Pill>

                  <Pill tone={snapInfo.fromCache ? "warn" : "ok"} title="Origem do snapshot">
                    {snapInfo.fromCache ? "cache" : "server"}
                    {snapInfo.hasPendingWrites ? " · pending" : ""} · {snapInfo.size}
                  </Pill>
                </>
              }
            />

            <div className="flex items-center gap-2 flex-wrap mt-3">
              <Button tone="ghost" onClick={() => setCreateOpen((v) => !v)} style={{ height: 40 }}>
                {createOpen ? "▾ Nova tarefa" : "▸ Nova tarefa"}
              </Button>

              <Button tone="ghost" onClick={() => setBulkOpen((v) => !v)} style={{ height: 40 }}>
                {bulkOpen ? "▾ Ações em massa" : "▸ Ações em massa"}
              </Button>

              <Button tone="ghost" onClick={() => setHeaderOpen((v) => !v)} style={{ height: 40 }}>
                {headerOpen ? "▾ Detalhes" : "▸ Detalhes"}
              </Button>

              {isDev ? (
                <Button
                  tone="ghost"
                  onClick={() => setShowDebug((v) => !v)}
                  style={{ height: 40, opacity: showDebug ? 1 : 0.75 }}
                  title="Debug (somente DEV)"
                >
                  {showDebug ? "🐞 Debug ON" : "🐞 Debug"}
                </Button>
              ) : null}

              <span className="ml-auto text-xs text-white/55 leading-relaxed">
                Página <b className="text-white/80">{page}</b> / <b className="text-white/80">{pageCount}</b> · Visíveis{" "}
                <b className="text-white/80">{filtered.length}</b>
              </span>
            </div>

            {headerOpen ? (
              <div className="mt-3">
                <SmallBox title="Fluxo" tone="neutral">
                  Master cria/atribui → Office sinaliza → Master decide status final.
                </SmallBox>
              </div>
            ) : null}

            {isDev && showDebug ? (
              <div className="mt-3 grid gap-2">
                {snapInfo.lastErr ? (
                  <SmallBox title="DEBUG: último erro do listener (tasks)" tone="bad">
                    {snapInfo.lastErr}
                  </SmallBox>
                ) : null}

                {snapInfo.lastEvent ? (
                  <SmallBox title="DEBUG: últimas mudanças do snapshot" tone="neutral">
                    {snapInfo.lastEvent}
                  </SmallBox>
                ) : null}
              </div>
            ) : null}
          </Card>
        </div>

        {/* CRIAR */}
        {createOpen ? (
          <Card>
            <SectionHeader title="Nova tarefa" subtitle="Crie e direcione para um colaborador." />
            <div className="grid gap-3 mt-4 max-w-4xl">
              <Input
                label="Título"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Revisar OS / atualizar deploy"
              />

              <label className="block">
                <div className="vero-label mb-1">Descrição (opcional)</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detalhes, contexto, links..."
                  style={{
                    width: "100%",
                    minHeight: 120,
                    padding: 12,
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.34)",
                    color: "rgba(255,255,255,0.92)",
                    outline: "none",
                    lineHeight: 1.45,
                  }}
                />
                <div className="text-[11px] text-white/50 mt-1 leading-relaxed">
                  Dica: inclua “como testar” para o Office validar rápido.
                </div>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => {
                    const v = normalizePriorityToAllowed(p, PRIORITIES);
                    return (
                      <option key={p} value={v}>
                        {prioPretty(v)}
                      </option>
                    );
                  })}
                </Select>

                <Select label="Responsável" value={assigneeUid} onChange={(e) => setAssigneeUid(e.target.value)}>
                  <option value="">— Não atribuído —</option>
                  {userOptions.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.label}
                    </option>
                  ))}
                </Select>

                <Button onClick={createTask} disabled={!uid}>
                  Criar
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {/* LISTA + FILTROS */}
        <Card>
          <SectionHeader
            title="Tarefas"
            subtitle={null}
            right={
              <>
                <Pill tone="neutral">Filtradas: {filtered.length}</Pill>
                {selectedCount ? <Pill tone="warn">Selecionadas: {selectedCount}</Pill> : null}
              </>
            }
          />

          <Divider my={12} />

          <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
            <div className="lg:col-span-2 relative" ref={qWrapRef}>
              <Input
                label="Buscar"
                value={qText}
                onChange={(e) => {
                  setQText(e.target.value);
                  setShowSug(true);
                  setSugIdx(-1);
                }}
                onFocus={() => setShowSug(true)}
                onBlur={() => setTimeout(() => setShowSug(false), 160)}
                onKeyDown={onKeyDownSearch}
                placeholder="título, descrição, comentário..."
              />

              {showSug && suggestions.length > 0 ? (
                <div
                  className="absolute left-0 right-0 mt-1 rounded-2xl border border-white/12 vero-glass overflow-hidden"
                  style={{
                    zIndex: 40,
                    background: "linear-gradient(180deg, rgba(0,0,0,0.58), rgba(0,0,0,0.38))",
                    boxShadow: "0 16px 50px rgba(0,0,0,0.55)",
                  }}
                >
                  {suggestions.map((s, idx) => (
                    <button
                      key={s + idx}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPickSuggestion(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                      style={{
                        background: idx === sugIdx ? "rgba(255,255,255,0.08)" : "transparent",
                        lineHeight: 1.25,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos</option>
              {TASK_STATUS.map((s) => {
                const v = normalizeStatusToAllowed(s, TASK_STATUS);
                return (
                  <option key={s} value={v}>
                    {statusPretty(v)}
                  </option>
                );
              })}
            </Select>

            <Select label="Prioridade" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)}>
              <option value="all">Todas</option>
              {PRIORITIES.map((p) => {
                const v = normalizePriorityToAllowed(p, PRIORITIES);
                return (
                  <option key={p} value={v}>
                    {prioPretty(v)}
                  </option>
                );
              })}
            </Select>

            <Select label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Mais recentes</option>
              <option value="priority">Maior prioridade</option>
              <option value="old">Mais antigas</option>
            </Select>

            <Select label="Por página" value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value) || 20)}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="40">40</option>
            </Select>

            <div className="grid gap-2">
              <div className="flex gap-2 flex-wrap items-end">
                <IconBtn onClick={() => setGroupByStatus((v) => !v)} title="Agrupar por status">
                  {groupByStatus ? "☑ Agrupado" : "☐ Agrupar"}
                </IconBtn>

                <IconBtn onClick={() => setDensity((d) => (d === "compact" ? "normal" : "compact"))} title="Densidade">
                  {density === "compact" ? "↕ Compacto" : "↕ Normal"}
                </IconBtn>

                <IconBtn onClick={() => setBigText((v) => !v)} title="Fonte maior">
                  {bigText ? "A- Normal" : "A+ Maior"}
                </IconBtn>

                <IconBtn
                  onClick={() => {
                    setQText("");
                    setStatusFilter("all");
                    setPrioFilter("all");
                    setSort("recent");
                    setPage(1);
                  }}
                  title="Limpar filtros"
                >
                  Limpar
                </IconBtn>
              </div>
            </div>
          </div>

          {/* CONTROLES DE SELEÇÃO */}
          <div
            className="mt-4 rounded-2xl border border-white/12 vero-glass"
            style={{
              padding: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              background: "linear-gradient(180deg, rgba(0,0,0,0.48), rgba(0,0,0,0.30))",
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-white/70" style={{ cursor: "pointer", lineHeight: 1.2 }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                />
                <span>
                  Selecionar página (<b className="text-white/85">{visibleIds.length}</b>)
                </span>
              </label>

              {selectedCount ? <Pill tone="warn">☑ {selectedCount}</Pill> : <Pill tone="neutral">Seleção</Pill>}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button tone="ghost" onClick={selectAllFiltered} disabled={filtered.length === 0 || bulkBusy}>
                Tudo (filtro)
              </Button>
              <Button tone="ghost" onClick={clearSelection} disabled={selectedCount === 0 || bulkBusy}>
                Limpar
              </Button>
              <Button tone="bad" onClick={requestBulkDelete} disabled={selectedCount === 0 || bulkBusy}>
                Excluir
              </Button>
            </div>
          </div>

          {/* AÇÕES EM MASSA */}
          <div className="mt-4" id="bulk-anchor">
            <div
              className="vero-glass border border-white/12 rounded-2xl"
              style={{
                padding: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                cursor: "pointer",
                userSelect: "none",
                background: "linear-gradient(180deg, rgba(0,0,0,0.48), rgba(0,0,0,0.30))",
              }}
              onClick={() => setBulkOpen((v) => !v)}
              title="Abrir/fechar ações em massa"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone="neutral">⚙️ Ações em massa</Pill>
                <Pill tone={selectedCount ? "warn" : "neutral"}>Selecionadas: {selectedCount}</Pill>
              </div>

              <IconBtn style={{ opacity: 1 }}>{bulkOpen ? "▾" : "▸"}</IconBtn>
            </div>

            {bulkOpen ? (
              <div
                className="rounded-2xl border border-white/12"
                style={{
                  padding: 12,
                  marginTop: 8,
                  background: "rgba(0,0,0,0.30)",
                }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <Select label="Status (massa)" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                    <option value="">— manter —</option>
                    {TASK_STATUS.map((s) => {
                      const v = normalizeStatusToAllowed(s, TASK_STATUS);
                      return (
                        <option key={s} value={v}>
                          {statusPretty(v)}
                        </option>
                      );
                    })}
                  </Select>

                  <Select label="Prioridade (massa)" value={bulkPrio} onChange={(e) => setBulkPrio(e.target.value)}>
                    <option value="">— manter —</option>
                    {PRIORITIES.map((p) => {
                      const v = normalizePriorityToAllowed(p, PRIORITIES);
                      return (
                        <option key={p} value={v}>
                          {prioPretty(v)}
                        </option>
                      );
                    })}
                  </Select>

                  <Select label="Resp. (massa)" value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)}>
                    <option value="">— manter —</option>
                    <option value="__CLEAR__">— não atribuído —</option>
                    {userOptions.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.label}
                      </option>
                    ))}
                  </Select>

                  <div className="flex items-end gap-2">
                    <Button disabled={bulkBusy || selectedCount === 0} onClick={bulkApply}>
                      Aplicar
                    </Button>
                    <Button tone="bad" disabled={bulkBusy || selectedCount === 0} onClick={requestBulkDelete}>
                      Excluir
                    </Button>
                  </div>
                </div>

                <div className="text-[11px] text-white/55 mt-2 leading-relaxed">
                  Passos: selecione → escolha campos → aplicar.
                </div>
              </div>
            ) : null}
          </div>

          {/* paginação */}
          <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-white/60 leading-relaxed">
              Mostrando <b className="text-white/80">{paged.length}</b> de <b className="text-white/80">{filtered.length}</b>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <IconBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                ←
              </IconBtn>

              <div className="text-xs text-white/55 leading-relaxed">
                <b className="text-white/80">{page}</b> / <b className="text-white/80">{pageCount}</b>
              </div>

              <IconBtn onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
                →
              </IconBtn>

              <span className="text-xs text-white/55 ml-2">Ir:</span>
              <input
                value={String(page)}
                onChange={(e) => {
                  const v = Number(String(e.target.value).replace(/\D+/g, ""));
                  if (!v) return;
                  setPage(Math.max(1, Math.min(pageCount, v)));
                }}
                style={{
                  width: 64,
                  height: 36,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(0,0,0,0.30)",
                  color: "#e5e7eb",
                  padding: "0 10px",
                  outline: "none",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              />
            </div>
          </div>

          {/* Lista */}
          <div className="mt-4">
            {loading ? (
              <Spinner />
            ) : (
              <div className="grid gap-2">
                {paged.length === 0 ? (
                  <div
                    className="vero-glass border border-white/12 rounded-2xl p-4"
                    style={{
                      background: "linear-gradient(180deg, rgba(0,0,0,0.50), rgba(0,0,0,0.28))",
                    }}
                  >
                    <div className="text-sm text-white/82" style={{ lineHeight: 1.25 }}>
                      Nada encontrado.
                    </div>
                    <div className="text-xs text-white/58 mt-1 leading-relaxed">
                      Ajuste filtros, página ou busque outro termo.
                    </div>
                  </div>
                ) : null}

                {groupByStatus ? (
                  <>
                    {["open", "pending", "blocked", "done"].map((key) => {
                      const items = groupsInPage[key] || [];
                      const empty = items.length === 0;
                      const collapsed = collapsedGroups.has(key);

                      return (
                        <div key={key} style={{ display: "grid", gap: 8 }}>
                          <div
                            className="vero-glass border border-white/12 rounded-2xl"
                            style={{
                              padding: 12,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              background: "linear-gradient(180deg, rgba(0,0,0,0.50), rgba(0,0,0,0.30))",
                            }}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <Pill tone={groupTone(key)}>{groupTitle(key)}</Pill>
                              <Pill tone="neutral">{items.length} item(s)</Pill>
                              {empty ? <Pill tone="neutral">vazio</Pill> : null}
                            </div>

                            <IconBtn onClick={() => toggleGroup(key)} disabled={empty}>
                              {collapsed ? "▸" : "▾"}
                            </IconBtn>
                          </div>

                          {!collapsed && !empty ? (
                            <div className="grid gap-2" style={{ paddingLeft: 2, paddingRight: 2 }}>
                              {items.map((t) => (
                                <TaskRow key={t.id} t={t} />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <>
                    {paged.map((t) => (
                      <TaskRow key={t.id} t={t} />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Modal Edit */}
      {editOpen ? (
        <div
          onMouseDown={() => closeEdit()}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.70)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="vero-glass border border-white/12 rounded-2xl w-full"
            style={{
              maxWidth: 920,
              padding: 14,
              maxHeight: "min(82vh, 900px)",
              overflow: "auto",
              background: "linear-gradient(180deg, rgba(0,0,0,0.58), rgba(0,0,0,0.34))",
              boxShadow: "0 26px 80px rgba(0,0,0,0.65)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div style={{ fontWeight: 950, fontSize: 14, lineHeight: 1.2 }}>Editar tarefa</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4, lineHeight: 1.25 }}>
                  ID: <code style={{ opacity: 0.9 }}>{editTask?.id}</code>
                </div>
              </div>

              <button
                onClick={closeEdit}
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#e5e7eb",
                  borderRadius: 12,
                  height: 34,
                  padding: "0 12px",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
                title="Fechar (Esc)"
              >
                ✕
              </button>
            </div>

            <Divider my={12} />

            <div className="grid gap-3 md:grid-cols-5">
              <div className="md:col-span-3 grid gap-3">
                <Input label="Título" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />

                <label className="block">
                  <div className="vero-label mb-1">Descrição</div>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Detalhes, contexto, links..."
                    style={{
                      width: "100%",
                      minHeight: 170,
                      padding: 12,
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(0,0,0,0.34)",
                      color: "rgba(255,255,255,0.92)",
                      outline: "none",
                      lineHeight: 1.45,
                    }}
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Select label="Prioridade" value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                    {PRIORITIES.map((p) => {
                      const v = normalizePriorityToAllowed(p, PRIORITIES);
                      return (
                        <option key={p} value={v}>
                          {prioPretty(v)}
                        </option>
                      );
                    })}
                  </Select>

                  <Select label="Status" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    {TASK_STATUS.map((s) => {
                      const v = normalizeStatusToAllowed(s, TASK_STATUS);
                      return (
                        <option key={s} value={v}>
                          {statusPretty(v)}
                        </option>
                      );
                    })}
                  </Select>

                  <Select
                    label="Responsável"
                    value={editAssigneeUid}
                    onChange={(e) => setEditAssigneeUid(e.target.value)}
                  >
                    <option value="">— não atribuído —</option>
                    {userOptions.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="md:col-span-2 grid gap-2">
                <SmallBox title="Resumo" tone="indigo">
                  <div className="grid gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-full border ${
                          PRIORITY_BADGE?.[normalizePriorityToAllowed(editPriority, PRIORITIES)] || "border-white/12 bg-white/6"
                        }`}
                        style={{ lineHeight: 1.1 }}
                      >
                        ⚡ {prioPretty(editPriority)}
                      </span>
                      <Pill tone="neutral">📌 {statusPretty(editStatus)}</Pill>
                    </div>
                    <div className="text-[11px] text-white/68 leading-relaxed">
                      Criada: <b className="text-white/86">{fmtTS(editTask?.createdAt)}</b>
                      <br />
                      Atual.: <b className="text-white/86">{fmtTS(editTask?.updatedAt)}</b>
                    </div>
                  </div>
                </SmallBox>

                <SmallBox title="Resposta do Office" tone={officeTone(normalizeOfficeState(editTask?.officeSignal)) || "neutral"}>
                  {normalizeOfficeState(editTask?.officeSignal) ? (
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Pill tone={officeTone(normalizeOfficeState(editTask?.officeSignal))}>
                          📩 {signalLabel(normalizeOfficeState(editTask?.officeSignal))}
                        </Pill>
                        {editTask?.officeSignaledAt ? (
                          <span className="text-[11px] text-white/65">{fmtTS(editTask.officeSignaledAt)}</span>
                        ) : null}
                      </div>

                      {getOfficeComment(editTask) ? (
                        <div className="text-xs text-white/82 whitespace-pre-wrap leading-relaxed">
                          {getOfficeComment(editTask)}
                        </div>
                      ) : (
                        <div className="text-xs text-white/62 leading-relaxed">Sem comentário do escritório.</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-white/62 leading-relaxed">Ainda sem resposta do escritório.</div>
                  )}
                </SmallBox>
              </div>
            </div>

            <div className="mt-4 flex gap-2 flex-wrap justify-end">
              <Button tone="ghost" onClick={closeEdit}>
                Cancelar
              </Button>
              <Button onClick={saveEdit}>Salvar</Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        cancelLabel={confirm.cancelLabel}
        danger={confirm.danger}
        requireText={confirm.requireText}
        busy={confirm.busy}
        onClose={closeConfirm}
        onConfirm={() => confirm?.onConfirm?.()}
      />

      <Toast
        open={toast.open}
        kind={toast.kind}
        title={toast.title}
        message={toast.message}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
      />
    </Shell>
  );
}