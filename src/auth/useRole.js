// src/auth/useRole.js
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export default function useRole(uid) {
  const [role, setRole] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Sem uid: reseta e encerra
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRole(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const ref = doc(db, "users", uid);

    const off = onSnapshot(
      ref,
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        setProfile(d);
        setRole(d?.role || null);
        setLoading(false);
      },
      (err) => {
        console.error("[useRole] snapshot error:", err);
        setProfile(null);
        setRole(null);
        setLoading(false);
      }
    );

    return () => off();
  }, [uid]);

  return { role, profile, loading };
}
