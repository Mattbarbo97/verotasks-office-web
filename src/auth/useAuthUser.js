// src/auth/useAuthUser.js
/* eslint-disable */
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, missing } from "../firebase";

function isPermissionDenied(err) {
  const code = err?.code || "";
  return code === "permission-denied" || code === "PERMISSION_DENIED";
}

export default function useAuthUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState("");

  useEffect(() => {
    // 1) Firebase env faltando
    if (Array.isArray(missing) && missing.length > 0) {
      setConfigError(`Firebase env faltando: ${missing.join(", ")}`);
      setUser(null);
      setLoading(false);
      return;
    }

    // 2) Firebase Auth não inicializou (auth null)
    if (!auth) {
      setConfigError("Firebase Auth não inicializou (auth=null).");
      setUser(null);
      setLoading(false);
      return;
    }

    setConfigError("");

    const unsub = onAuthStateChanged(
      auth,
      async (u) => {
        setUser(u || null);

        // Sem login -> encerra
        if (!u) {
          setLoading(false);
          return;
        }

        // Se não tiver Firestore, não tenta nada
        if (!db) {
          setLoading(false);
          return;
        }

        // ✅ Tenta garantir users/{uid}, mas NÃO pode travar login nem quebrar por rules.
        try {
          const ref = doc(db, "users", u.uid);
          const snap = await getDoc(ref);

          // Se não existir, tentamos criar um perfil mínimo.
          // IMPORTANTE: isso só funciona se suas rules permitirem create/update em users/{uid}.
          if (!snap.exists()) {
            await setDoc(
              ref,
              {
                uid: u.uid,
                email: u.email || "",
                name: u.displayName || (u.email ? u.email.split("@")[0] : ""),

                // fallback legacy (caso memberships esteja inacessível)
                role: "office",
                active: true,

                // metadados úteis
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } else {
            // Só atualiza updatedAt se tiver permissão; se não tiver, ignora.
            await setDoc(ref, { updatedAt: serverTimestamp() }, { merge: true });
          }
        } catch (e) {
          // Se rules bloquearem, não trava o login.
          if (isPermissionDenied(e)) {
            console.warn("[useAuthUser] sem permissão para ler/escrever users/{uid} (ok, seguindo).");
          } else {
            console.warn("[useAuthUser] failed ensuring users/{uid}", e?.message || e);
          }
        }

        setLoading(false);
      },
      (err) => {
        setConfigError(err?.message || "Falha no onAuthStateChanged.");
        setUser(null);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  return { user, loading, configError };
}
