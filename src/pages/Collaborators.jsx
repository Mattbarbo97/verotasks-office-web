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
import { apiFetch } from "../lib/api";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";

export default function Collaborators() {
  const { user } = useAuthUser();
  const { role } = useRole(user?.uid);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newRole, setNewRole] = useState("office");
  const [creating, setCreating] = useState(false);

  const [toast, setToast] = useState({ open: false, kind: "info", title: "", message: "" });

  const userLabel = useMemo(() => user?.email || "", [user]);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
    const off = onSnapshot(
      q,
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingUsers(false);
      },
      () => setLoadingUsers(false)
    );
    return () => off();
  }, []);

  async function onCreate() {
    if (!email.trim() || pass.trim().length < 6) {
      setToast({ open: true, kind: "error", title: "Dados inválidos", message: "Email e senha (mín. 6) são obrigatórios." });
      return;
    }

    setCreating(true);
    try {
      await apiFetch("/admin/createUser", {
        method: "POST",
        body: {
          email: email.trim(),
          password: pass.trim(),
          displayName: displayName.trim(),
          role: newRole,
        },
      });

      setToast({ open: true, kind: "ok", title: "Colaborador criado", message: "Usuário criado e perfil salvo." });
      setEmail(""); setPass(""); setDisplayName(""); setNewRole("office");
    } catch (err) {
      setToast({ open: true, kind: "error", title: "Falha", message: err?.message || "Não foi possível criar usuário." });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Shell title="VeroTasks" subtitle="Colaboradores" userLabel={`${userLabel} • (${role || "—"})`} showMasterNav={true}>
      <div className="grid gap-4">
        <Card title="Criar colaborador" subtitle="Master cria logins do escritório. Depois cada um vincula Telegram.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
            <Input label="Nome (opcional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Select label="Role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="office">office</option>
              <option value="master">master</option>
            </Select>
            <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Senha" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>

          <div className="mt-3 flex gap-2">
            <Button onClick={onCreate} disabled={creating}>
              {creating ? "Criando…" : "Criar usuário"}
            </Button>
            <Button variant="ghost" onClick={() => { setEmail(""); setPass(""); setDisplayName(""); setNewRole("office"); }}>
              Limpar
            </Button>
          </div>

          <div className="text-xs text-white/50 mt-2">
            Regras: office vê tarefas e sinaliza; master decide finalização e prioridade.
          </div>
        </Card>

        <Card title="Lista de usuários" subtitle="Master vê todos. Office vê apenas o próprio (via rules).">
          {loadingUsers ? (
            <Spinner />
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.uid || u.id} className="vero-glass rounded-2xl border border-white/10 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{u.displayName || u.email || u.uid}</div>
                    <div className="text-xs text-white/60 truncate">
                      {u.email || "—"} • role: {u.role || "—"} • telegram: {u.telegram?.linked ? "✅" : "—"}
                    </div>
                  </div>
                  <div className="text-xs text-white/50">
                    {u.telegram?.username ? `@${u.telegram.username}` : ""}
                  </div>
                </div>
              ))}
              {users.length === 0 ? <div className="text-xs text-white/50">Nenhum usuário encontrado.</div> : null}
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
