// src/pages/OfficeAccess.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

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

function safeStr(v) {
  return String(v ?? "").trim();
}

function normLower(v) {
  return safeStr(v).toLowerCase();
}

function normalizeMembership(mem) {
  const role = safeStr(mem?.role);
  const isActive = mem?.isActive === true;
  return { role, isActive };
}

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

export default function OfficeAccess() {
  const { user } = useAuthUser();
  const { role: appRole } = useRole(user?.uid);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [memberships, setMemberships] = useState([]);
  const [loadingMemberships, setLoadingMemberships] = useState(true);

  const [filter, setFilter] = useState("");

  // criar usuário (via bot)
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("office_user");
  const [creating, setCreating] = useState(false);

  // ações por linha
  const [busyId, setBusyId] = useState("");

  const [toast, setToast] = useState({ open: false, kind: "info", title: "", message: "" });

  const userLabel = useMemo(() => user?.email || "", [user]);

  // ---------- users snapshot ----------
  useEffect(() => {
    const qy = query(collection(db, "users"), orderBy("createdAt", "desc"));
    const off = onSnapshot(
      qy,
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingUsers(false);
      },
      (e) => {
        console.error("[OfficeAccess] users snapshot error", e);
        setLoadingUsers(false);
      }
    );
    return () => off();
  }, []);

  // ---------- memberships snapshot ----------
  useEffect(() => {
    const qy = query(collection(db, "memberships"), orderBy("updatedAt", "desc"));
    const off = onSnapshot(
      qy,
      (snap) => {
        setMemberships(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingMemberships(false);
      },
      (e) => {
        console.error("[OfficeAccess] memberships snapshot error", e);
        setLoadingMemberships(false);
      }
    );
    return () => off();
  }, []);

  // index users by uid
  const userByUid = useMemo(() => {
    const m = new Map();
    for (const u of users) {
      const uid = u.uid || u.id;
      if (uid) m.set(uid, u);
    }
    return m;
  }, [users]);

  const rows = useMemo(() => {
    const f = normLower(filter);

    const merged = memberships.map((mem) => {
      const uid = mem.id;
      const u = userByUid.get(uid) || null;
      const nm = normalizeMembership(mem);

      return {
        uid,
        membership: mem,
        role: nm.role || "—",
        isActive: nm.isActive,
        email: safeStr(u?.email),
        displayName: safeStr(u?.displayName || u?.name),
        telegramLinked: Boolean(u?.telegram?.linked),
        telegramUser: safeStr(u?.telegram?.username),
        missingMembership: false,
      };
    });

    const usersWithoutMembership = users
      .map((u) => {
        const uid = u.uid || u.id;
        if (!uid) return null;
        const has = memberships.find((m) => m.id === uid);
        if (has) return null;

        return {
          uid,
          membership: null,
          role: "—",
          isActive: false,
          email: safeStr(u?.email),
          displayName: safeStr(u?.displayName || u?.name),
          telegramLinked: Boolean(u?.telegram?.linked),
          telegramUser: safeStr(u?.telegram?.username),
          missingMembership: true,
        };
      })
      .filter(Boolean);

    const all = [...merged, ...usersWithoutMembership];

    const filtered = all.filter((r) => {
      if (!f) return true;
      return (
        normLower(r.email).includes(f) ||
        normLower(r.displayName).includes(f) ||
        normLower(r.uid).includes(f) ||
        normLower(r.role).includes(f) ||
        normLower(r.telegramUser).includes(f)
      );
    });

    filtered.sort((a, b) => {
      const aA = a.isActive ? 0 : 1;
      const bA = b.isActive ? 0 : 1;
      if (aA !== bA) return aA - bA;

      const aM = a.missingMembership ? 0 : 1;
      const bM = b.missingMembership ? 0 : 1;
      if (aM !== bM) return aM - bM;

      return normLower(a.email || a.uid).localeCompare(normLower(b.email || b.uid));
    });

    return filtered;
  }, [memberships, users, userByUid, filter]);

  async function ensureMembership(uid, { role = "office_user", isActive = true } = {}) {
    const me = user?.uid || null;

    await setDoc(
      doc(db, "memberships", uid),
      {
        role,
        isActive,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdByUid: me,
      },
      { merge: true }
    );
  }

  async function setMembershipActive(uid, nextActive) {
    setBusyId(uid);
    try {
      const ref = doc(db, "memberships", uid);

      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await ensureMembership(uid, { role: "office_user", isActive: Boolean(nextActive) });
      } else {
        await updateDoc(ref, {
          isActive: Boolean(nextActive),
          updatedAt: serverTimestamp(),
        });
      }

      setToast({
        open: true,
        kind: "ok",
        title: "Acesso atualizado",
        message: nextActive ? "Usuário liberado (ativo)." : "Usuário bloqueado (inativo).",
      });
    } catch (e) {
      setToast({ open: true, kind: "error", title: "Falha", message: e?.message || "Não foi possível atualizar." });
    } finally {
      setBusyId("");
    }
  }

  async function setMembershipRole(uid, nextRole) {
    setBusyId(uid);
    try {
      const ref = doc(db, "memberships", uid);

      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await ensureMembership(uid, { role: nextRole, isActive: true });
      } else {
        await updateDoc(ref, {
          role: nextRole,
          updatedAt: serverTimestamp(),
        });
      }

      setToast({ open: true, kind: "ok", title: "Role atualizado", message: `Role definido para ${nextRole}.` });
    } catch (e) {
      setToast({ open: true, kind: "error", title: "Falha", message: e?.message || "Não foi possível atualizar role." });
    } finally {
      setBusyId("");
    }
  }

  async function onCreateUser() {
    if (!newEmail.trim() || newPass.trim().length < 6) {
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
      const resp = await apiFetch("/admin/createUser", {
        method: "POST",
        body: {
          email: newEmail.trim(),
          password: newPass.trim(),
          displayName: newName.trim(),
          role: "office",
        },
      });

      const createdUid = resp?.uid;
      if (createdUid) {
        await ensureMembership(createdUid, { role: newRole, isActive: true });
      }

      setToast({
        open: true,
        kind: "ok",
        title: "Usuário criado",
        message: "Login criado e acesso liberado (membership).",
      });

      setNewName("");
      setNewEmail("");
      setNewPass("");
      setNewRole("office_user");
    } catch (e) {
      setToast({ open: true, kind: "error", title: "Falha", message: e?.message || "Não foi possível criar usuário." });
    } finally {
      setCreating(false);
    }
  }

  const loading = loadingUsers || loadingMemberships;

  return (
    <Shell
      title="VeroTasks"
      subtitle="Gestão de Acessos"
      userLabel={`${userLabel} • (${appRole || "—"})`}
      showMasterNav={true}
      role={appRole}
    >
      <div style={{ display: "grid", gap: 14 }}>
        <Card>
          <SectionTitle
            title="Criar login + liberar acesso"
            subtitle="Cria o usuário (Auth) e salva membership (role/isActive)."
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 860 }}>
            <Input label="Nome (opcional)" value={newName} onChange={(e) => setNewName(e.target.value)} />

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.75 }}>Role (Office)</label>
              <Select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                <option value="office_user">office_user</option>
                <option value="office_admin">office_admin</option>
              </Select>
            </div>

            <Input label="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <Input label="Senha" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button onClick={onCreateUser} disabled={creating}>
              {creating ? "Criando…" : "Criar e liberar"}
            </Button>

            <Button
              tone="ghost"
              onClick={() => {
                setNewName("");
                setNewEmail("");
                setNewPass("");
                setNewRole("office_user");
              }}
            >
              Limpar
            </Button>
          </div>

          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
            Dica: <b>office_user</b> sinaliza tarefas; <b>office_admin</b> gerencia acessos.
          </div>
        </Card>

        <Card>
          <SectionTitle
            title="Pessoas e acessos"
            subtitle="Ativar/desativar e definir role. Também mostra users sem membership (para liberar)."
          />

          <div style={{ marginBottom: 12, maxWidth: 520 }}>
            <Input
              label="Buscar"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="email, nome, uid, role, telegram..."
            />
          </div>

          {loading ? (
            <Spinner />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {rows.map((r) => {
                const uid = r.uid;
                const busy = busyId === uid;

                return (
                  <GlassRow key={uid}>
                    <div style={{ minWidth: 260, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 900 }}>
                        {r.displayName || r.email || uid}
                        {r.missingMembership ? (
                          <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.8 }}>• sem membership</span>
                        ) : null}
                      </div>

                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                        {r.email || "—"} • uid: <span style={{ opacity: 0.9 }}>{uid}</span>
                      </div>

                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                        telegram: <b style={{ opacity: 0.95 }}>{r.telegramLinked ? "✅" : "—"}</b>{" "}
                        {r.telegramUser ? <span style={{ opacity: 0.85 }}>(@{r.telegramUser})</span> : null}
                      </div>

                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                        role: <b style={{ opacity: 0.95 }}>{r.role || "—"}</b> • status:{" "}
                        <b style={{ opacity: 0.95 }}>{r.isActive ? "ativo" : "inativo"}</b>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <label style={{ fontSize: 12, opacity: 0.75 }}>Role</label>
                        <Select
                          value={r.role === "office_admin" || r.role === "office_user" ? r.role : "office_user"}
                          onChange={(e) => setMembershipRole(uid, e.target.value)}
                          disabled={busy}
                        >
                          <option value="office_user">office_user</option>
                          <option value="office_admin">office_admin</option>
                        </Select>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <label style={{ fontSize: 12, opacity: 0.75 }}>Acesso</label>
                        <Button
                          onClick={() => setMembershipActive(uid, !r.isActive)}
                          disabled={busy}
                          tone={r.isActive ? "ghost" : "primary"}
                        >
                          {busy ? "Salvando…" : r.isActive ? "Bloquear" : "Ativar"}
                        </Button>
                      </div>

                      {r.missingMembership ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <label style={{ fontSize: 12, opacity: 0.75 }}>Membership</label>
                          <Button
                            onClick={async () => {
                              setBusyId(uid);
                              try {
                                await ensureMembership(uid, { role: "office_user", isActive: true });
                                setToast({
                                  open: true,
                                  kind: "ok",
                                  title: "Acesso liberado",
                                  message: "Membership criado e usuário ativado.",
                                });
                              } catch (e) {
                                setToast({
                                  open: true,
                                  kind: "error",
                                  title: "Falha",
                                  message: e?.message || "Não foi possível criar membership.",
                                });
                              } finally {
                                setBusyId("");
                              }
                            }}
                            disabled={busy}
                          >
                            Liberar
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </GlassRow>
                );
              })}

              {rows.length === 0 ? <div style={{ fontSize: 12, opacity: 0.65 }}>Nenhum registro encontrado.</div> : null}
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
