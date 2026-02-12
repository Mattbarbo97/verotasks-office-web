// src/pages/AccessBlocked.jsx
/*eslint-disable*/
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";

import Shell from "../ui/Shell";
import Card from "../ui/Card";
import Button from "../ui/Button";
import { auth } from "../firebase";

export default function AccessBlocked() {
  const nav = useNavigate();

  async function onLogout() {
    try {
      await signOut(auth);
    } catch {}
    nav("/login", { replace: true });
  }

  return (
    <Shell title="VeroTasks" subtitle="Acesso bloqueado">
      <Card style={{ display: "grid", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 950 }}>🚫 Seu acesso está bloqueado</div>

        <div style={{ opacity: 0.78, lineHeight: 1.5 }}>
          Seu login foi criado, mas <b>não está liberado</b> (ou foi desativado).
          <br />
          Peça para um <b>office_admin</b> liberar seu usuário em <b>🔐 Acessos</b>.
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button onClick={onLogout}>Sair</Button>

          <Link to="/login">
            <Button tone="ghost">Voltar ao login</Button>
          </Link>
        </div>

        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Dica: quando liberarem, basta entrar novamente e você terá acesso ao Office.
        </div>
      </Card>
    </Shell>
  );
}
