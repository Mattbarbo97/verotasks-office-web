// src/auth/RequireMaster.jsx
import React from "react";
import { Navigate } from "react-router-dom";
import useAuthUser from "./useAuthUser";
import useRole from "./useRole";
import Spinner from "../ui/Spinner";

export default function RequireMaster({ children }) {
  const { user, loading } = useAuthUser();
  const { role, loading: roleLoading } = useRole(user?.uid);

  if (loading || roleLoading) return <Spinner label="Verificando permissão..." />;

  if (!user) return <Navigate to="/login" replace />;

  if (role !== "master") return <Navigate to="/office" replace />;

  return children;
}
