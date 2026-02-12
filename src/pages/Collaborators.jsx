// src/pages/Collaborators.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

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
import { db } from "../firebase";

function SectionTitle({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 950, fontSize: 14 }}>{title}</div>
      {subtitle ? <div style={{ fontSize: 12, opacity: 0.72, marginTop: 2 }}>{subtitle}</div> : null}
    </div>
  );
}

function GlassRow({ children }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        padding: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

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
    const qy = query(collection(db, "users"), orderBy("createdAt", "desc"));
    const off = onSnapshot(
      qy,
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
      setToast({
        open: true,
        kind: "error",
        title: "Dados inválidos",
        message: "Email e senha (mín. 6) são obrigatórios.",
      });
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
      setEmail("");
      setPass("");
      setDisplayName("");
      setNewRole("office");
    } catch (err) {
      setToast({
        open: true,
        kind: "error",
        title: "Falha",
        message: err?.message || "Não foi possível criar usuário.",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Shell title="VeroTasks" subtitle="Colaboradores" userLabel={`${userLabel} • (${role || "—"})`} showMasterNav={true}>
      <div style={{ display: "grid", gap: 14 }}>
        <Card>
          <SectionTitle
            title="Criar colaborador"
            subtitle="Master cria logins do escritório. Depois cada um vincula Telegram."
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 860 }}>
            <Input label="Nome (opcional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.75 }}>Role</label>
              <Select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                <option value="office">office</option>
                <option value="master">master</option>
              </Select>
            </div>

            <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Senha" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button onClick={onCreate} disabled={creating}>
              {creating ? "Criando…" : "Criar usuário"}
            </Button>

            <Button
              tone="ghost"
              onClick={() => {
                setEmail("");
                setPass("");
                setDisplayName("");
                setNewRole("office");
              }}
            >
              Limpar
            </Button>
          </div>

          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
            Regras: office vê tarefas e sinaliza; master decide finalização e prioridade.
          </div>
        </Card>

        <Card>
          <SectionTitle title="Lista de usuários" subtitle="Master vê todos. Office vê apenas o próprio (via rules)." />

          {loadingUsers ? (
            <Spinner />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {users.map((u) => (
                <GlassRow key={u.uid || u.id}>
                  <div style={{ minWidth: 260, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 900 }}>{u.displayName || u.email || u.uid}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                      {u.email || "—"} • role: {u.role || "—"} • telegram: {u.telegram?.linked ? "✅" : "—"}
                    </div>
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.65 }}>
                    {u.telegram?.username ? `@${u.telegram.username}` : ""}
                  </div>
                </GlassRow>
              ))}

              {users.length === 0 ? <div style={{ fontSize: 12, opacity: 0.65 }}>Nenhum usuário encontrado.</div> : null}
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
