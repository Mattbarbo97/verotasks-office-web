// src/auth/RequireOfficeAdmin.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import useAuthUser from "./useAuthUser";
import useRole from "./useRole";
import Spinner from "../ui/Spinner";

export default function RequireOfficeAdmin({ children }) {
  const { user, loading } = useAuthUser();
  const { role, isActive, loading: roleLoading } = useRole(user?.uid);
  const loc = useLocation();

  if (loading || roleLoading) return <Spinner label="Verificando permissão..." />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  // ✅ sem membership ou inativo => bloqueado
  if (isActive === null || isActive === false) {
    return <Navigate to="/blocked" replace />;
  }

  const ok = role === "office_admin" || role === "admin";
  if (!ok) return <Navigate to="/office" replace />;

  return children;
}
