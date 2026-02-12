// src/auth/useRole.js
/*eslint-disable*/
import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

function safeStr(v) {
  return String(v ?? "").trim();
}

function normalizeRole(v) {
  const r = safeStr(v);
  return r || null;
}

export default function useRole(uid) {
  const [role, setRole] = useState(null);

  // profile = users/{uid}
  const [profile, setProfile] = useState(null);

  // membership = memberships/{uid}
  const [membership, setMembership] = useState(null);
  const [isActive, setIsActive] = useState(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Sem uid: reseta e encerra
    if (!uid) {
      setRole(null);
      setProfile(null);
      setMembership(null);
      setIsActive(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const offUsers = onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        setProfile(d);
      },
      (err) => {
        console.error("[useRole] users snapshot error:", err);
        setProfile(null);
      }
    );

    const offMembership = onSnapshot(
      doc(db, "memberships", uid),
      (snap) => {
        const m = snap.exists() ? snap.data() : null;
        setMembership(m);

        const memRole = normalizeRole(m?.role);
        const memActive = m?.isActive === true;

        // ✅ fonte de verdade: memberships.role/isActive
        // fallback legacy: users.role (se membership não existir)
        setRole(memRole); // pode ser null enquanto profile ainda carrega
        setIsActive(memActive);
      },
      (err) => {
        console.error("[useRole] memberships snapshot error:", err);
        setMembership(null);
        setIsActive(null);
        setRole(null);
      }
    );

    return () => {
      offUsers();
      offMembership();
    };
  }, [uid]);

  // ✅ derivação final do role: membership.role > profile.role > null
  const effectiveRole = useMemo(() => {
    const memRole = normalizeRole(membership?.role);
    if (memRole) return memRole;

    const legacy = normalizeRole(profile?.role);
    if (legacy) return legacy;

    return null;
  }, [membership?.role, profile?.role]);

  // ✅ derivação final do isActive:
  // - se membership existe: usar membership.isActive
  // - se não existe: null (não decidido) — o guard vai bloquear depois
  const effectiveIsActive = useMemo(() => {
    if (membership) return membership?.isActive === true;
    return null;
  }, [membership]);

  // loading só encerra quando tiver pelo menos um ciclo de snapshot rodado
  useEffect(() => {
    if (!uid) return;
    // quando profile já foi setado (mesmo null) e membership já foi setado (mesmo null),
    // a gente considera carregado.
    // Como ambos começam null, precisamos do "primeiro tick" — então deixamos simples:
    // encerra loading quando qualquer snapshot rodar -> aqui usamos isActive !== undefined (mas no React state não existe undefined inicial)
    // Então: encerra loading após um pequeno atraso quando uid existe.
    // (Na prática os snapshots chegam rápido; isso evita travar a UI.)
    const t = setTimeout(() => setLoading(false), 150);
    return () => clearTimeout(t);
  }, [uid]);

  return {
    role: effectiveRole,
    profile,
    membership,
    isActive: effectiveIsActive,
    loading,
  };
}
