// src/auth/useAuthUser.js
/*eslint-disable  */
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, missing } from "../firebase";

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

    const unsub = onAuthStateChanged(
      auth,
      async (u) => {
        setUser(u || null);

        // Se logou, garante que existe users/{uid}
        try {
          if (u && db) {
            const ref = doc(db, "users", u.uid);
            const snap = await getDoc(ref);

            if (!snap.exists()) {
              await setDoc(
                ref,
                {
                  uid: u.uid,
                  email: u.email || "",
                  name: u.displayName || (u.email ? u.email.split("@")[0] : ""),
                  role: "office", // default
                  status: "active", // alinhado com o backend (telegramAuth.js usa status/role)
                  telegramUserId: "",
                  telegramChatId: "",
                  telegramLabel: "",
                  telegramLinkedAt: null,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            } else {
              await setDoc(ref, { updatedAt: serverTimestamp() }, { merge: true });
            }
          }
        } catch (e) {
          // Não trava login; só loga.
          // eslint-disable-next-line no-console
          console.warn("[useAuthUser] failed ensuring users/{uid}", e?.message || e);
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
