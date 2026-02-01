// src/routes/PrivateRoute.jsx
import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";

import { auth, firebaseError, missingKeys } from "../firebase";

export default function PrivateRoute({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const loc = useLocation();

  // Se Firebase ainda não foi configurado, mostra tela de setup (e não fica branco)
  if (firebaseError || !auth) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0b1020",
          color: "#e5e7eb",
          padding: 24,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22 }}>VeroTasks — Setup do Firebase</h1>
        <p style={{ opacity: 0.85, marginTop: 10 }}>
          O painel ainda não está com o Firebase configurado, por isso a tela ficava branca.
        </p>

        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 14,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>O que falta:</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", opacity: 0.9 }}>
            {missingKeys?.length ? missingKeys.join("\n") : firebaseError || "—"}
          </pre>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>
            Crie um arquivo <code>.env.local</code> na raiz do projeto com:
          </div>

          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              padding: 14,
              borderRadius: 14,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.12)",
              overflowX: "auto",
            }}
          >{`VITE_FIREBASE_API_KEY="..."
VITE_FIREBASE_AUTH_DOMAIN="..."
VITE_FIREBASE_PROJECT_ID="..."
VITE_FIREBASE_STORAGE_BUCKET="..."
VITE_FIREBASE_MESSAGING_SENDER_ID="..."
VITE_FIREBASE_APP_ID="..."`}</pre>

          <p style={{ opacity: 0.85, marginTop: 12 }}>
            Depois de criar/ajustar o <code>.env.local</code>, reinicie o Vite:
          </p>

          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              padding: 14,
              borderRadius: 14,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >{`# no terminal do Vite
CTRL + C
npm run dev`}</pre>

          <p style={{ opacity: 0.75, marginTop: 12 }}>
            *As chaves vêm do Firebase Console → Project Settings → Your apps → Web app → Config.
          </p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setReady(true);
    });
    return () => unsub();
  }, []);

  if (!ready) {
    return (
      <div style={{ padding: 24, color: "#cbd5e1" }}>
        Carregando sessão...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  return children;
}
