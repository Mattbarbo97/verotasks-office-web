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
function normalizePriority(p) {
  const x = safeStr(p);
  return x || "medium";
}
function normalizeStatus(s) {
  const x = safeStr(s);
  return x || "open";
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
};
const STATUS_PRETTY = {
  open: "Aberta",
  pending: "Pendente",
  blocked: "Deu ruim",
  done: "Feita",
  feita: "Feita",
  pendente: "Pendente",
  deu_ruim: "Deu ruim",
  feito: "Feita",
};

function prioPretty(p) {
  const k = normalizePriority(p);
  return PRIO_PRETTY[k] || PRIORITY_LABEL?.[k] || k;
}
function statusPretty(s) {
  const k = normalizeStatus(s);
  return STATUS_PRETTY[k] || STATUS_LABEL?.[k] || k;
}

function getOfficeComment(t) {
  const a = safeStr(t?.officeComment);
  if (a) return a;
  if (t?.officeSignal && typeof t.officeSignal === "object") return safeStr(t.officeSignal.comment);
  return "";
}
function getOfficeSignalLabel(t) {
  const sig = t?.officeSignal;
  if (!sig) return "";
  if (typeof sig === "string") return sig;
  if (typeof sig === "object" && sig.state) return safeStr(sig.state);
  return "";
}
function officeTone(state) {
  const s = toLower(state);
  if (!s) return "neutral";
  if (s.includes("execut") || s.includes("feito") || s.includes("ok")) return "ok";
  if (s.includes("ruim") || s.includes("erro") || s.includes("bloq") || s.includes("blocked")) return "bad";
  if (s.includes("pend") || s.includes("aguard")) return "warn";
  return "neutral";
}
function officeLabel(state) {
  const s = safeStr(state);
  if (!s) return "";
  return s.replace(/[_-]+/g, " ").trim();
}
function compactUserLabel(u) {
  const name = safeStr(u?.displayName || u?.name);
  if (name) return name;
  const email = safeStr(u?.email);
  if (email) return email;
  const uid = safeStr(u?.uid || u?.id);
  return uid || "—";
}
function getTaskText(t) {
  return `${safeStr(t.title)} ${safeStr(t.description)} ${safeStr(t.masterComment)} ${safeStr(
    t.officeComment
  )}`.trim();
}
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   UI atoms
   ========================= */

function Pill({ children, tone = "neutral", title }) {
  const map = {
    neutral: "border-white/10 bg-white/5 text-white/80",
    ok: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
    warn: "border-amber-400/20 bg-amber-400/10 text-amber-100",
    bad: "border-rose-400/20 bg-rose-400/10 text-rose-100",
    indigo: "border-indigo-400/25 bg-indigo-400/10 text-indigo-100",
  };
  const cls = map[tone] || map.neutral;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${cls}`}
    >
      {children}
    </span>
  );
}

function Divider({ my = 12 }) {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: `${my}px 0` }} />;
}

function Row({ children }) {
  return (
    <div className="vero-glass border border-white/10 rounded-2xl" style={{ padding: 14 }}>
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
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.05)",
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
    neutral: "border-white/10 bg-white/5",
    ok: "border-emerald-400/20 bg-emerald-400/8",
    warn: "border-amber-400/20 bg-amber-400/8",
    bad: "border-rose-400/20 bg-rose-400/8",
    indigo: "border-indigo-400/25 bg-indigo-400/8",
  };
  const cls = map[tone] || map.neutral;

  return (
    <div className={`rounded-2xl border p-3 ${cls}`}>
      {title ? <div className="text-xs font-semibold text-white/85 mb-2">{title}</div> : null}
      <div className="text-xs text-white/75 whitespace-pre-wrap leading-relaxed">{children}</div>
    </div>
  );
}

function groupTone(key) {
  if (key === "done") return "ok";
  if (key === "blocked") return "bad";
  if (key === "pending") return "warn";
  return "indigo";
}
function statusGroupKey(st) {
  const s = normalizeStatus(st);
  if (s === "done" || s === "feito") return "done";
  if (s === "blocked" || s === "deu_ruim") return "blocked";
  if (s === "pending" || s === "pendente") return "pending";
  return "open";
}
function groupTitle(key) {
  if (key === "done") return "Finalizadas";
  if (key === "blocked") return "Problemas (deu ruim)";
  if (key === "pending") return "Pendentes";
  return "Abertas";
}

function SectionHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <div className="text-[15px] sm:text-[16px] font-extrabold text-white/90">{title}</div>
        {subtitle ? <div className="text-xs text-white/60 mt-1">{subtitle}</div> : null}
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
        background: "rgba(0,0,0,0.66)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="vero-glass border border-white/10 rounded-2xl w-full"
        style={{
          maxWidth: 720,
          padding: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div style={{ minWidth: 0 }}>
            <div className="text-[14px] font-extrabold text-white/90">{title}</div>
            {message ? <div className="text-xs text-white/70 mt-2 whitespace-pre-wrap">{message}</div> : null}
          </div>

          <button
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
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
  const [priority, setPriority] = useState("medium");
  const [assigneeUid, setAssigneeUid] = useState("");

  // editor modal
  const [editOpen, setEditOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState("medium");
  const [editAssigneeUid, setEditAssigneeUid] = useState("");
  const [editStatus, setEditStatus] = useState("open");

  // toast
  const [toast, setToast] = useState({ open: false, kind: "info", title: "", message: "" });

  // sugestões
  const [showSug, setShowSug] = useState(false);
  const [sugIdx, setSugIdx] = useState(-1);
  const qWrapRef = useRef(null);

  // detalhes
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

        if (resumo) {
          console.log("[tasks snapshot] changes:", resumo, {
            fromCache: snap.metadata.fromCache,
            pending: snap.metadata.hasPendingWrites,
            size: snap.size,
          });
        }

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
        console.log("[users snapshot] ok:", snap.size);
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
      c[statusGroupKey(t.status)]++;
      if (getOfficeSignalLabel(t)) c.officePing++;
    }
    return c;
  }, [tasks]);

  /* ---------- suggestions ---------- */
  const suggestions = useMemo(() => {
    const needle = safeStr(qText);
    if (!needle || needle.length < 2) return [];

    const titles = tasks.map((t) => safeStr(t.title)).filter(Boolean);
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

    if (statusFilter !== "all") rows = rows.filter((r) => normalizeStatus(r.status) === statusFilter);
    if (prioFilter !== "all") rows = rows.filter((r) => normalizePriority(r.priority) === prioFilter);
    if (t) rows = rows.filter((r) => toLower(getTaskText(r)).includes(t));

    if (sort === "recent") {
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } else if (sort === "old") {
      rows.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    } else if (sort === "priority") {
      const w = { urgent: 5, high: 4, medium: 3, low: 2, alta: 5, media: 3, baixa: 2 };
      rows.sort((a, b) => (w[normalizePriority(b.priority)] || 3) - (w[normalizePriority(a.priority)] || 3));
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
      const g = statusGroupKey(t.status);
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
      console.log("[create] START", { uid, title: t, assigneeUid });
      await addDoc(collection(db, "tasks"), {
        title: t,
        description: description.trim(),
        status: "open",
        priority,
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
      setPriority("medium");
      setAssigneeUid("");
      setToast({ open: true, kind: "ok", title: "Criado", message: "Tarefa criada com sucesso." });
      setCreateOpen(false);
      console.log("[create] OK");
    } catch (err) {
      console.error("[create] ERROR", err);
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha ao criar tarefa." });
    }
  }

  async function quickUpdate(taskId, patch) {
    try {
      console.log("[update] patch", { taskId, patch });
      await updateDoc(doc(db, "tasks", taskId), { ...patch, updatedAt: serverTimestamp() });
    } catch (err) {
      console.error("[update] ERROR", err);
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha ao atualizar." });
    }
  }

  function openEdit(t) {
    setEditTask(t);
    setEditTitle(safeStr(t.title));
    setEditDescription(safeStr(t.description));
    setEditPriority(normalizePriority(t.priority));
    setEditAssigneeUid(safeStr(t.assigneeUid));
    setEditStatus(normalizeStatus(t.status));
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
      console.log("[edit] SAVE", { id: editTask.id });
      await updateDoc(doc(db, "tasks", editTask.id), {
        title: t,
        description: editDescription.trim(),
        priority: normalizePriority(editPriority),
        assigneeUid: safeStr(editAssigneeUid),
        status: normalizeStatus(editStatus),
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
        `"${safeStr(t.title) || "—"}"\n` +
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
      console.log("[delete] START", { id: t.id, title: safeStr(t.title), uid, email: user?.email });

      await deleteDoc(doc(db, "tasks", t.id));
      console.log("[delete] deleteDoc resolved", t.id);

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
      console.log("[delete] CONFIRMED on server", t.id);

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
    console.log("[bulkDelete] START", { count: ids.length, ids: ids.slice(0, 12) });

    try {
      const parts = chunk(ids, 450);
      for (const part of parts) {
        const batch = writeBatch(db);
        for (const id of part) batch.delete(doc(db, "tasks", id));
        await batch.commit();
        console.log("[bulkDelete] batch committed", { size: part.length });
      }

      // valida 1 id no servidor (amostra) pra garantir que não está “sumindo e voltando”
      const sample = ids[0];
      if (sample) {
        try {
          await assertDeletedOnServer(sample);
          console.log("[bulkDelete] server confirm OK", sample);
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
    if (bulkStatus) patch.status = bulkStatus;
    if (bulkPrio) patch.priority = bulkPrio;
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

    // Sem window.confirm — aplica direto com toast (padrão SaaS)
    setBulkBusy(true);
    console.log("[bulkApply] START", { selectedCount, patch });

    try {
      const ids = selectedIds.slice();
      const parts = chunk(ids, 450);

      for (const part of parts) {
        const batch = writeBatch(db);
        for (const id of part) batch.update(doc(db, "tasks", id), { ...patch, updatedAt: serverTimestamp() });
        await batch.commit();
        console.log("[bulkApply] batch committed", { size: part.length });
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
  const selectH = density === "compact" ? 40 : 42;

  const handleEscClose = useCallback((e) => {
    if (e.key === "Escape") closeEdit();
  }, []);

  useEffect(() => {
    if (!editOpen) return;
    window.addEventListener("keydown", handleEscClose);
    return () => window.removeEventListener("keydown", handleEscClose);
  }, [editOpen, handleEscClose]);

  function TaskRow({ t }) {
    const pr = normalizePriority(t.priority);
    const st = normalizeStatus(t.status);

    const assignee = t.assigneeUid ? userByUid.get(t.assigneeUid)?.label || t.assigneeUid : "";
    const officeComment = getOfficeComment(t);
    const officeStateRaw = getOfficeSignalLabel(t);
    const officeState = officeLabel(officeStateRaw);

    const statusTone =
      st === "done" || st === "feito"
        ? "ok"
        : st === "blocked" || st === "deu_ruim"
        ? "bad"
        : st === "pending" || st === "pendente"
        ? "warn"
        : "neutral";

    const hasDetails = Boolean(safeStr(t.description) || officeComment || officeStateRaw);
    const isOpen = expanded.has(t.id);
    const isSel = selected.has(t.id);

    return (
      <Row>
        <div className="grid gap-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div style={{ display: "flex", gap: 12, alignItems: "start", minWidth: 280, flex: 1 }}>
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => toggleSelect(t.id)}
                style={{ marginTop: 5, transform: "scale(1.07)" }}
                aria-label="Selecionar tarefa"
              />

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: titleSize,
                    fontWeight: 950,
                    color: "rgba(255,255,255,0.92)",
                    lineHeight: 1.15,
                    letterSpacing: -0.2,
                  }}
                >
                  {safeStr(t.title) || "—"}
                </div>

                <div className="mt-2 text-xs text-white/65 flex flex-wrap gap-x-3 gap-y-1">
                  <span>
                    Resp.: <b className="text-white/85">{assignee || "— não atribuído —"}</b>
                  </span>
                  <span>
                    Criada: <b className="text-white/75">{fmtTS(t.createdAt)}</b>
                  </span>
                  <span>
                    Atual.: <b className="text-white/75">{fmtTS(t.updatedAt)}</b>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${
                  PRIORITY_BADGE?.[pr] || "border-white/10 bg-white/5"
                }`}
                title="Prioridade"
              >
                <span aria-hidden>⚡</span> {prioPretty(pr)}
              </span>

              <Pill tone={statusTone} title="Status atual">
                <span aria-hidden>📌</span> {statusPretty(st)}
              </Pill>

              {officeStateRaw ? (
                <Pill tone={officeTone(officeStateRaw)} title={`Resposta do Office: ${officeState}`}>
                  <span aria-hidden>📩</span> Office: {officeState}
                </Pill>
              ) : (
                <Pill tone="neutral" title="Sem resposta do Office">
                  <span aria-hidden>📭</span> Office: —
                </Pill>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
            <div className="lg:col-span-3">
              <Select
                label="Prioridade"
                value={pr}
                onChange={(e) => quickUpdate(t.id, { priority: e.target.value })}
                style={{ height: selectH }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {prioPretty(p)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="lg:col-span-4">
              <Select
                label="Responsável"
                value={safeStr(t.assigneeUid)}
                onChange={(e) => quickUpdate(t.id, { assigneeUid: e.target.value })}
                style={{ height: selectH }}
              >
                <option value="">— não atribuído —</option>
                {userOptions.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="lg:col-span-3">
              <Select
                label="Status"
                value={st}
                onChange={(e) => quickUpdate(t.id, { status: e.target.value })}
                style={{ height: selectH }}
              >
                {TASK_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {statusPretty(s)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="lg:col-span-2 flex items-end justify-end gap-2 flex-wrap">
              {hasDetails ? (
                <Button tone="ghost" onClick={() => toggleExpand(t.id)} style={{ height: 40, width: "100%" }}>
                  {isOpen ? "▾ Detalhes" : "▸ Detalhes"}
                </Button>
              ) : (
                <div className="w-full" />
              )}
            </div>
          </div>

          {/* Action bar (mais visível) */}
          <div
            className="rounded-2xl border border-white/10"
            style={{
              padding: 12,
              background: "linear-gradient(90deg, rgba(99,102,241,0.12), rgba(0,0,0,0.18))",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Button tone="ghost" onClick={() => openEdit(t)} style={{ height: 40 }}>
                ✏️ Editar
              </Button>

              <Button tone="bad" onClick={() => requestDeleteSingle(t)} style={{ height: 40 }}>
                🗑️ Excluir
              </Button>

              {officeComment ? (
                <Pill tone="neutral" title="Comentário do Office (prévia)">
                  <span aria-hidden>💬</span>{" "}
                  {officeComment.length > 52 ? officeComment.slice(0, 52) + "…" : officeComment}
                </Pill>
              ) : null}
            </div>

            <span className="text-[11px] text-white/55">
              ID: <code style={{ opacity: 0.9 }}>{t.id}</code>
            </span>
          </div>

          {/* Details */}
          {hasDetails && isOpen ? (
            <div style={{ padding: pad, borderRadius: 18, background: "rgba(0,0,0,0.18)" }}>
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
                      <div>
                        <b className="text-white/85">{officeLabel(officeStateRaw) || "—"}</b>
                        {t?.officeSignaledAt ? (
                          <span className="text-white/60"> · {fmtTS(t.officeSignaledAt)}</span>
                        ) : null}
                      </div>
                      <Pill tone={officeTone(officeStateRaw)}>{officeTone(officeStateRaw).toUpperCase()}</Pill>
                    </div>

                    {officeComment ? (
                      <div className="mt-2 text-white/80 whitespace-pre-wrap">{officeComment}</div>
                    ) : (
                      <div className="mt-2 text-white/55">Sem comentário.</div>
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
            className="vero-glass border border-white/10 rounded-2xl"
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              padding: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone="warn" title="Tarefas selecionadas">
                ☑ Selecionadas: {selectedCount}
              </Pill>
              <span className="text-xs text-white/60">Dica: selecione mais marcando as caixas à esquerda.</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button tone="ghost" onClick={clearSelection} disabled={bulkBusy}>
                Limpar seleção
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
                Ajustar em massa
              </Button>

              <Button tone="bad" onClick={requestBulkDelete} disabled={bulkBusy}>
                🗑️ Excluir selecionadas
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ padding: "12px 0 92px" }} className="grid gap-4">
        {/* VISÃO RÁPIDA */}
        <div className="sticky top-2 z-30" style={{ backdropFilter: "blur(12px)", paddingTop: 6, paddingBottom: 6 }}>
          <Card>
            <SectionHeader
              title="Visão rápida"
              subtitle="Fluxo: Master cria/atribui → Office sinaliza → Master decide status final."
              right={
                <>
                  <Pill tone="indigo">📌 Total: {tasks.length}</Pill>
                  <Pill tone="indigo">🟦 Abertas: {counts.open}</Pill>
                  <Pill tone="warn">🟨 Pendentes: {counts.pending}</Pill>
                  <Pill tone="bad">🟥 Problemas: {counts.blocked}</Pill>
                  <Pill tone="ok">✅ Finalizadas: {counts.done}</Pill>
                  <Pill tone="neutral">📩 Office: {counts.officePing}</Pill>

                  <Pill tone={snapInfo.fromCache ? "warn" : "ok"} title="Snapshot metadata">
                    {snapInfo.fromCache ? "📦 cache" : "🌐 server"} {snapInfo.hasPendingWrites ? "· ✍ pending" : ""} ·{" "}
                    {snapInfo.size}
                  </Pill>
                </>
              }
            />

            {snapInfo.lastErr ? (
              <div className="mt-3">
                <SmallBox title="DEBUG: último erro do listener (tasks)" tone="bad">
                  {snapInfo.lastErr}
                </SmallBox>
              </div>
            ) : null}

            {snapInfo.lastEvent ? (
              <div className="mt-3">
                <SmallBox title="DEBUG: últimas mudanças do snapshot" tone="neutral">
                  {snapInfo.lastEvent}
                </SmallBox>
              </div>
            ) : null}

            <Divider my={12} />

            <div className="flex items-center gap-2 flex-wrap">
              <Button tone="ghost" onClick={() => setCreateOpen((v) => !v)} style={{ height: 40 }}>
                {createOpen ? "▾ Nova tarefa" : "▸ Nova tarefa"}
              </Button>

              <Button tone="ghost" onClick={() => setBulkOpen((v) => !v)} style={{ height: 40 }}>
                {bulkOpen ? "▾ Ações em massa" : "▸ Ações em massa"}
              </Button>

              <span className="ml-auto text-xs text-white/55">
                Página <b className="text-white/80">{page}</b> / <b className="text-white/80">{pageCount}</b> · Visíveis{" "}
                <b className="text-white/80">{filtered.length}</b>
              </span>
            </div>
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
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(0,0,0,0.28)",
                    color: "rgba(255,255,255,0.90)",
                    outline: "none",
                  }}
                />
                <div className="text-[11px] text-white/45 mt-1">Dica: inclua “como testar” para o Office validar rápido.</div>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {prioPretty(p)}
                    </option>
                  ))}
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
            subtitle="Para excluir várias: marque as caixas → clique “Excluir selecionadas” (barra no rodapé)."
            right={
              <>
                <Pill tone="neutral">Visíveis: {filtered.length}</Pill>
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
                  className="absolute left-0 right-0 mt-1 rounded-2xl border border-white/10 vero-glass overflow-hidden"
                  style={{ zIndex: 40 }}
                >
                  {suggestions.map((s, idx) => (
                    <button
                      key={s + idx}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPickSuggestion(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                      style={{ background: idx === sugIdx ? "rgba(255,255,255,0.06)" : "transparent" }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos</option>
              {TASK_STATUS.map((s) => (
                <option key={s} value={s}>
                  {statusPretty(s)}
                </option>
              ))}
            </Select>

            <Select label="Prioridade" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)}>
              <option value="all">Todas</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {prioPretty(p)}
                </option>
              ))}
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
            className="mt-4 rounded-2xl border border-white/10 vero-glass"
            style={{
              padding: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-white/70" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                />
                <span>
                  Selecionar itens desta página (<b className="text-white/85">{visibleIds.length}</b>)
                </span>
              </label>

              {selectedCount ? (
                <Pill tone="warn">☑ Selecionadas: {selectedCount}</Pill>
              ) : (
                <Pill tone="neutral">Marque caixas para ações em massa</Pill>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button tone="ghost" onClick={selectAllFiltered} disabled={filtered.length === 0 || bulkBusy}>
                Selecionar tudo (filtro)
              </Button>
              <Button tone="ghost" onClick={clearSelection} disabled={selectedCount === 0 || bulkBusy}>
                Limpar seleção
              </Button>
              <Button tone="bad" onClick={requestBulkDelete} disabled={selectedCount === 0 || bulkBusy}>
                Excluir selecionadas
              </Button>
            </div>
          </div>

          {/* AÇÕES EM MASSA */}
          <div className="mt-4" id="bulk-anchor">
            <div
              className="vero-glass border border-white/10 rounded-2xl"
              style={{
                padding: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                cursor: "pointer",
                userSelect: "none",
              }}
              onClick={() => setBulkOpen((v) => !v)}
              title="Abrir/fechar ações em massa"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone="neutral">⚙️ Ações em massa</Pill>
                <Pill tone={selectedCount ? "warn" : "neutral"}>Selecionadas: {selectedCount}</Pill>
                <span className="text-xs text-white/50">
                  {selectedCount ? "Aplique status/prioridade/responsável para todas" : "Selecione tarefas para habilitar"}
                </span>
              </div>

              <IconBtn style={{ opacity: 1 }}>{bulkOpen ? "▾ Recolher" : "▸ Abrir"}</IconBtn>
            </div>

            {bulkOpen ? (
              <div className="rounded-2xl border border-white/10 bg-black/20" style={{ padding: 12, marginTop: 8 }}>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <Select label="Status (massa)" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                    <option value="">— manter —</option>
                    {TASK_STATUS.map((s) => (
                      <option key={s} value={s}>
                        {statusPretty(s)}
                      </option>
                    ))}
                  </Select>

                  <Select label="Prioridade (massa)" value={bulkPrio} onChange={(e) => setBulkPrio(e.target.value)}>
                    <option value="">— manter —</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {prioPretty(p)}
                      </option>
                    ))}
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

                <div className="text-[11px] text-white/55 mt-2">
                  Passos: (1) marque as caixas → (2) escolha o que alterar → (3) clique Aplicar.
                </div>
              </div>
            ) : null}
          </div>

          {/* paginação */}
          <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-white/60">
              Mostrando <b className="text-white/80">{paged.length}</b> de <b className="text-white/80">{filtered.length}</b>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <IconBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                ← Anterior
              </IconBtn>

              <div className="text-xs text-white/55">
                Página <b className="text-white/80">{page}</b> / <b className="text-white/80">{pageCount}</b>
              </div>

              <IconBtn onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
                Próxima →
              </IconBtn>

              <span className="text-xs text-white/55 ml-3">Ir para:</span>
              <input
                value={String(page)}
                onChange={(e) => {
                  const v = Number(String(e.target.value).replace(/\D+/g, ""));
                  if (!v) return;
                  setPage(Math.max(1, Math.min(pageCount, v)));
                }}
                style={{
                  width: 70,
                  height: 36,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.25)",
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
                  <div className="vero-glass border border-white/10 rounded-2xl p-4">
                    <div className="text-sm text-white/80">Nada encontrado.</div>
                    <div className="text-xs text-white/55 mt-1">Ajuste filtros, página ou busque outro termo.</div>
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
                            className="vero-glass border border-white/10 rounded-2xl"
                            style={{
                              padding: 12,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <Pill tone={groupTone(key)}>{groupTitle(key)}</Pill>
                              <Pill tone="neutral">Qtd: {items.length}</Pill>
                              {empty ? <span className="text-xs text-white/45">Sem itens nessa página</span> : null}
                            </div>

                            <div className="flex items-center gap-2">
                              <IconBtn onClick={() => toggleGroup(key)} disabled={empty}>
                                {collapsed ? "▸ Expandir" : "▾ Recolher"}
                              </IconBtn>
                            </div>
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

      {/* Modal Edit (mantive igual) */}
      {editOpen ? (
        <div
          onMouseDown={() => closeEdit()}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.62)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="vero-glass border border-white/10 rounded-2xl w-full"
            style={{ maxWidth: 920, padding: 14, maxHeight: "min(82vh, 900px)", overflow: "auto" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div style={{ fontWeight: 950, fontSize: 14 }}>Editar tarefa</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  ID: <code style={{ opacity: 0.9 }}>{editTask?.id}</code>
                </div>
              </div>

              <button
                onClick={closeEdit}
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
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
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.28)",
                      color: "rgba(255,255,255,0.90)",
                      outline: "none",
                    }}
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Select label="Prioridade" value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {prioPretty(p)}
                      </option>
                    ))}
                  </Select>

                  <Select label="Status" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    {TASK_STATUS.map((s) => (
                      <option key={s} value={s}>
                        {statusPretty(s)}
                      </option>
                    ))}
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
                        className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${
                          PRIORITY_BADGE?.[normalizePriority(editPriority)] || "border-white/10 bg-white/5"
                        }`}
                      >
                        ⚡ {prioPretty(editPriority)}
                      </span>
                      <Pill tone="neutral">📌 {statusPretty(editStatus)}</Pill>
                    </div>
                    <div className="text-[11px] text-white/65">
                      Criada: <b className="text-white/85">{fmtTS(editTask?.createdAt)}</b>
                      <br />
                      Atual.: <b className="text-white/85">{fmtTS(editTask?.updatedAt)}</b>
                    </div>
                  </div>
                </SmallBox>

                <SmallBox title="Resposta do Office" tone={officeTone(getOfficeSignalLabel(editTask)) || "neutral"}>
                  {getOfficeSignalLabel(editTask) ? (
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Pill tone={officeTone(getOfficeSignalLabel(editTask))}>
                          📩 {officeLabel(getOfficeSignalLabel(editTask))}
                        </Pill>
                        {editTask?.officeSignaledAt ? (
                          <span className="text-[11px] text-white/65">{fmtTS(editTask.officeSignaledAt)}</span>
                        ) : null}
                      </div>

                      {getOfficeComment(editTask) ? (
                        <div className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed">
                          {getOfficeComment(editTask)}
                        </div>
                      ) : (
                        <div className="text-xs text-white/60">Sem comentário do escritório.</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-white/60">Ainda sem resposta do escritório.</div>
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
