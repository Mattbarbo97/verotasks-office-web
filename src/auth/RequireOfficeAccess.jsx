// src/auth/RequireOfficeAccess.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import useAuthUser from "./useAuthUser";
import useRole from "./useRole";
import Spinner from "../ui/Spinner";

export default function RequireOfficeAccess({ children }) {
  const { user, loading } = useAuthUser();
  const { isActive, loading: roleLoading } = useRole(user?.uid);
  const loc = useLocation();

  if (loading || roleLoading) return <Spinner label="Verificando acesso..." />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  // ✅ Sem membership (isActive null) ou membership inativo => bloqueado
  if (isActive === null || isActive === false) {
    return <Navigate to="/blocked" replace />;
  }

  return children;
}

