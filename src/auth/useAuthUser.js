// src/auth/useAuthUser.js
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

export default function useAuthUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
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
                active: true,
                telegram: {
                  linked: false,
                  chatId: "",
                  username: "",
                  linkedAt: null,
                },
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } else {
            // mantém updatedAt mínimo (opcional)
            await setDoc(ref, { updatedAt: serverTimestamp() }, { merge: true });
          }
        }
      } catch (e) {
        // Se rules bloquearem, você vai ver aqui também.
        // Não trava login; apenas deixa o app continuar.
        // eslint-disable-next-line no-console
        console.warn("[useAuthUser] failed ensuring users/{uid}", e?.message || e);
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { user, loading };
}
