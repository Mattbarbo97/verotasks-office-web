import React, { useEffect, useMemo, useState } from "react";
import Shell from "../ui/Shell";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import Toast from "../ui/Toast";
import Spinner from "../ui/Spinner";
import useAuthUser from "../auth/useAuthUser";
import useRole from "../auth/useRole";
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_BADGE, TASK_STATUS, STATUS_LABEL } from "../tasks/task.constants";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";

export default function MasterPanel() {
  const { user } = useAuthUser();
  const { role } = useRole(user?.uid);

  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // filtros
  const [qText, setQText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [prioFilter, setPrioFilter] = useState("all");
  const [sort, setSort] = useState("recent");

  // form tarefa
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assigneeUid, setAssigneeUid] = useState("");

  const [toast, setToast] = useState({ open: false, kind: "info", title: "", message: "" });
  const userLabel = useMemo(() => user?.email || "", [user]);

  useEffect(() => {
    const qt = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
    const qu = query(collection(db, "users"), orderBy("createdAt", "desc"));

    const offT = onSnapshot(
      qt,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );

    const offU = onSnapshot(qu, (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      offT();
      offU();
    };
  }, []);

  const userOptions = useMemo(() => users.filter((u) => u.role === "office" || u.role === "master"), [users]);

  const filtered = useMemo(() => {
    const t = (qText || "").trim().toLowerCase();
    let rows = Array.isArray(tasks) ? tasks.slice() : [];

    if (statusFilter !== "all") {
      rows = rows.filter((r) => (r.status || "open") === statusFilter);
    }
    if (prioFilter !== "all") {
      rows = rows.filter((r) => (r.priority || "medium") === prioFilter);
    }
    if (t) {
      rows = rows.filter((r) => {
        const hay = `${r.title || ""} ${r.description || ""}`.toLowerCase();
        return hay.includes(t);
      });
    }

    if (sort === "recent") {
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    }
    if (sort === "priority") {
      const w = { urgent: 4, high: 3, medium: 2, low: 1 };
      rows.sort((a, b) => (w[b.priority || "medium"] || 2) - (w[a.priority || "medium"] || 2));
    }
    return rows;
  }, [tasks, qText, statusFilter, prioFilter, sort]);

  async function createTask() {
    const t = title.trim();
    if (t.length < 3) {
      setToast({ open: true, kind: "error", title: "Título curto", message: "Digite um título com pelo menos 3 caracteres." });
      return;
    }

    try {
      await addDoc(collection(db, "tasks"), {
        title: t,
        description: description.trim(),
        status: "open",
        priority,
        assigneeUid: assigneeUid || "",
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastSignalAt: null,
        lastSignalByUid: null,
        lastSignalKind: null,
      });

      setTitle(""); setDescription(""); setPriority("medium"); setAssigneeUid("");
      setToast({ open: true, kind: "ok", title: "Criado", message: "Tarefa criada com sucesso." });
    } catch (err) {
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha ao criar tarefa." });
    }
  }

  async function quickUpdate(taskId, patch) {
    try {
      await updateDoc(doc(db, "tasks", taskId), { ...patch, updatedAt: serverTimestamp() });
    } catch (err) {
      setToast({ open: true, kind: "error", title: "Erro", message: err?.message || "Falha ao atualizar." });
    }
  }

  return (
    <Shell title="VeroTasks" subtitle="Master — Tarefas" userLabel={`${userLabel} • (${role || "—"})`} showMasterNav={true}>
      <div className="grid gap-4">
        <Card title="Nova tarefa" subtitle="Crie e direcione para um colaborador. Prioridade filtra no Office e no Master.">
          <div className="grid gap-3 max-w-4xl">
            <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Revisar OS / atualizar deploy" />

            <label className="block">
              <div className="vero-label mb-1">Descrição (opcional)</div>
              <textarea
                className="w-full min-h-[90px] p-3 rounded-2xl vero-glass border border-white/10 outline-none focus:border-indigo-400/40"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </Select>

              <Select label="Responsável" value={assigneeUid} onChange={(e) => setAssigneeUid(e.target.value)}>
                <option value="">— Todos (não atribuído) —</option>
                {userOptions.map((u) => (
                  <option key={u.uid || u.id} value={u.uid || u.id}>
                    {u.displayName || u.email || u.uid}
                  </option>
                ))}
              </Select>

              <Button onClick={createTask}>Criar</Button>
            </div>
          </div>
        </Card>

        <Card
          title="Tarefas"
          subtitle="Filtros e ordenação (polido). Office vê tudo, mas só sinaliza. Master decide final."
        >
          <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 mb-3">
            <div className="lg:col-span-2">
              <Input label="Buscar" value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Título/descrição..." />
            </div>
            <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos</option>
              {TASK_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
            <Select label="Prioridade" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)}>
              <option value="all">Todas</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
            <Select label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Mais recentes</option>
              <option value="priority">Maior prioridade</option>
            </Select>
            <div className="flex items-end">
              <Button variant="ghost" onClick={() => { setQText(""); setStatusFilter("all"); setPrioFilter("all"); setSort("recent"); }}>
                Limpar filtros
              </Button>
            </div>
          </div>

          {loading ? (
            <Spinner />
          ) : (
            <div className="space-y-2">
              {filtered.map((t) => {
                const pr = t.priority || "medium";
                const st = t.status || "open";
                return (
                  <div key={t.id} className="vero-glass rounded-2xl border border-white/10 p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold truncate">{t.title || "—"}</div>
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-2xl border ${PRIORITY_BADGE[pr]}`}>
                          {PRIORITY_LABEL[pr]}
                        </span>
                        <span className="inline-flex items-center text-xs px-2 py-1 rounded-2xl border border-white/10 bg-white/5">
                          {STATUS_LABEL[st] || st}
                        </span>
                      </div>
                      {t.description ? (
                        <div className="text-xs text-white/60 mt-1 line-clamp-2">{t.description}</div>
                      ) : null}

                      <div className="text-xs text-white/45 mt-2">
                        Resp.:{" "}
                        {t.assigneeUid
                          ? (users.find((u) => (u.uid || u.id) === t.assigneeUid)?.displayName ||
                            users.find((u) => (u.uid || u.id) === t.assigneeUid)?.email ||
                            t.assigneeUid)
                          : "— todos —"}
                      </div>
                    </div>

                    <div className="shrink-0 grid gap-2">
                      <Select value={pr} onChange={(e) => quickUpdate(t.id, { priority: e.target.value })}>
                        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                      </Select>

                      <Select value={t.assigneeUid || ""} onChange={(e) => quickUpdate(t.id, { assigneeUid: e.target.value })}>
                        <option value="">— não atribuído —</option>
                        {userOptions.map((u) => (
                          <option key={u.uid || u.id} value={u.uid || u.id}>
                            {u.displayName || u.email || u.uid}
                          </option>
                        ))}
                      </Select>

                      <Select value={st} onChange={(e) => quickUpdate(t.id, { status: e.target.value })}>
                        {TASK_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </Select>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 ? <div className="text-xs text-white/50">Nada encontrado.</div> : null}
            </div>
          )}
        </Card>
      </div>

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
