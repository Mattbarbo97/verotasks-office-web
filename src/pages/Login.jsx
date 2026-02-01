import React, { useMemo, useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useLocation, useNavigate } from "react-router-dom";
import { auth } from "../firebase";

import Shell from "../ui/Shell";
import Card from "../ui/Card";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Toast from "../ui/Toast";

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const from = useMemo(() => loc.state?.from || "/office", [loc.state]);

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setToast(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
      nav(from, { replace: true });
    } catch (err) {
      setToast(err?.message || "Falha ao entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell center>
      <Card style={{ width: "min(420px, 92vw)" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>VeroTasks — Escritório</h1>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Login do painel (email e senha).
        </p>

        <form onSubmit={onSubmit} style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="office@empresa.com"
            autoComplete="email"
            required
          />

          <Input
            label="Senha"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

          <Button type="submit" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        {toast ? <Toast style={{ marginTop: 12 }}>{toast}</Toast> : null}
      </Card>
    </Shell>
  );
}
