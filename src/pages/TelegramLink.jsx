// src/pages/TelegramLink.jsx
/*eslint-disable */
import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { Navigate, useNavigate } from "react-router-dom";

import { auth, db } from "../firebase";
import Shell from "../ui/Shell";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Toast from "../ui/Toast";

function safeStr(v) {
  return (v && String(v)) || "";
}

function masked(s) {
  const t = safeStr(s).trim();
  if (!t) return "—";
  if (t.length <= 8) return t;
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

// tenta rotas diferentes (até você me confirmar a rota real do backend)
async function consumeLinkToken({ baseUrl, token, idToken }) {
  const paths = [
    "/auth/telegram/consume-link-token",
    "/auth/telegram/consumeLinkToken",
    "/telegram/consume-link-token",
  ];

  let lastErr = null;

  for (const p of paths) {
    try {
      const url = `${baseUrl}${p}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // opcional: se teu backend validar Firebase ID Token
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ token }),
      });

      const raw = await res.text().catch(() => "");
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { ok: false, error: `Resposta não-JSON em ${p}` };
      }

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || `Falha HTTP ${res.status} em ${p}`);
      }

      return { ok: true, data, usedPath: p };
    } catch (e) {
      lastErr = e;
      // tenta o próximo path
    }
  }

  throw lastErr || new Error("Falha ao consumir token.");
}

export default function TelegramLink() {
  const nav = useNavigate();

  const user = auth.currentUser;
  const uid = user?.uid || "";
  const email = user?.email || "—";

  const BOT_BASE_URL = import.meta.env.VITE_BOT_BASE_URL || "";

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const telegram = profile?.telegram || null;
  const telegramLinked = Boolean(telegram?.linked);
  const telegramLabel = useMemo(() => {
    if (!telegramLinked) return "Não vinculado";
    const u = safeStr(telegram?.username);
    const c = safeStr(telegram?.chatId);
    if (u) return `@${u}`;
    if (c) return `chatId ${masked(c)}`;
    return "Vinculado";
  }, [telegramLinked, telegram]);

  // carrega o user doc
  useEffect(() => {
    if (!uid) return;

    (async () => {
      try {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        const d = snap.exists() ? snap.data() : null;

        // garante doc mínimo
        if (!d) {
          await setDoc(
            ref,
            {
              email: email || "",
              role: "office",
              active: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        const snap2 = await getDoc(ref);
        setProfile(snap2.exists() ? snap2.data() : null);
      } catch (e) {
        setToast(`⚠️ Falha ao ler seu perfil: ${e?.message || e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [uid, email]);

  if (!user) return <Navigate to="/login" replace />;

  async function refreshProfile() {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    setProfile(snap.exists() ? snap.data() : null);
  }

  async function onLink() {
    try {
      setToast(null);

      const t = safeStr(token).trim();
      if (!t) {
        setToast("⚠️ Cole o token gerado pelo bot (/link).");
        return;
      }
      if (!BOT_BASE_URL) {
        setToast("🚫 Falta configurar VITE_BOT_BASE_URL.");
        return;
      }

      setBusy(true);

      // opcional: pegar Firebase ID token (se teu backend validar)
      let idToken = "";
      try {
        idToken = await user.getIdToken?.();
      } catch {}

      const resp = await consumeLinkToken({
        baseUrl: BOT_BASE_URL,
        token: t,
        idToken,
      });

      // esperado do backend (exemplo):
      // { ok:true, chatId, username, firstName, linkedAt }
      const data = resp?.data || {};

      const telegramPatch = {
        linked: true,
        chatId: safeStr(data.chatId || data.chat_id),
        username: safeStr(data.username),
        firstName: safeStr(data.firstName || data.first_name),
        linkedAt: serverTimestamp(),
        source: "web",
        usedPath: resp.usedPath,
      };

      // grava no Firestore
      await setDoc(
        doc(db, "users", uid),
        {
          updatedAt: serverTimestamp(),
          telegram: telegramPatch,
        },
        { merge: true }
      );

      setToast(`✅ Telegram vinculado! ${telegramPatch.username ? `@${telegramPatch.username}` : ""}`.trim());
      setToken("");
      await refreshProfile();
    } catch (e) {
      setToast(`🚫 ${e?.message || "Falha ao vincular."}`);
    } finally {
      setBusy(false);
    }
  }

  async function onUnlink() {
    try {
      setToast(null);
      setBusy(true);

      await setDoc(
        doc(db, "users", uid),
        {
          updatedAt: serverTimestamp(),
          telegram: {
            linked: false,
            chatId: "",
            username: "",
            firstName: "",
            unlinkedAt: serverTimestamp(),
          },
        },
        { merge: true }
      );

      setToast("ℹ️ Telegram desvinculado (somente no painel).");
      await refreshProfile();
    } catch (e) {
      setToast(`⚠️ ${e?.message || "Falha ao desvincular."}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="VeroTasks"
      subtitle="Vincular Telegram"
      userLabel={email}
      role={profile?.role || "office"}
      telegramLinked={telegramLinked}
      showMasterNav={profile?.role === "master" || profile?.role === "admin"}
      onLogout={() => nav("/office")}
    >
      {toast ? (
        <Toast tone={toast.startsWith("✅") ? "ok" : toast.startsWith("ℹ️") ? "neutral" : toast.startsWith("⚠️") ? "warn" : "bad"}>
          <div style={{ whiteSpace: "pre-wrap" }}>{toast}</div>
        </Toast>
      ) : null}

      <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
        <Card>
          <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 16, fontWeight: 950 }}>Status do Telegram</div>
              <div style={{ opacity: 0.8, fontSize: 13 }}>
                {telegramLinked ? (
                  <>
                    ✅ Vinculado: <b>{telegramLabel}</b>
                    {telegram?.chatId ? (
                      <span style={{ opacity: 0.8 }}>
                        {" "}
                        • chatId: <code>{masked(telegram.chatId)}</code>
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>⚠️ Não vinculado. Cole o token para receber tarefas direcionadas no Telegram.</>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button tone="ghost" onClick={() => nav("/office")}>
                Ir para Office
              </Button>

              {(profile?.role === "master" || profile?.role === "admin") && (
                <Button tone="ghost" onClick={() => nav("/master")}>
                  Ir para Master
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 950 }}>Vincular com Token</div>
              <div style={{ opacity: 0.8, fontSize: 13, marginTop: 6 }}>
                1) No Telegram, fale com o bot e rode <code>/link</code>  
                <br />
                2) Cole aqui o token gerado e clique em <b>Vincular</b>.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
              <Input
                label="Token do Telegram"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Ex: 6F2A-1B9C-...."
              />

              <Button disabled={busy || loading} onClick={onLink}>
                {busy ? "Vinculando..." : "Vincular"}
              </Button>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button
                tone="ghost"
                disabled={busy || loading}
                onClick={() => {
                  setToken("");
                  setToast(null);
                }}
              >
                Limpar
              </Button>

              <Button tone="warn" disabled={busy || loading || !telegramLinked} onClick={onUnlink}>
                Desvincular
              </Button>
            </div>

            <div style={{ opacity: 0.7, fontSize: 12 }}>
              Backend: <code>{BOT_BASE_URL || "(não configurado)"}</code>
            </div>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
