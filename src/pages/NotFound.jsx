// src/pages/NotFound.jsx
import React from "react";
import { Link } from "react-router-dom";
import Shell from "../ui/Shell";
import Card from "../ui/Card";
import Button from "../ui/Button";

export default function NotFound() {
  return (
    <Shell>
      <Card style={{ display: "grid", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>Página não encontrada</div>
        <div style={{ opacity: 0.75 }}>
          Essa rota não existe. Volte para o painel.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to="/office">
            <Button>Ir para Office</Button>
          </Link>
          <Link to="/telegram">
            <Button tone="ghost">Vincular Telegram</Button>
          </Link>
        </div>
      </Card>
    </Shell>
  );
}
