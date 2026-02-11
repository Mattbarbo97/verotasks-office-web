// src/auth/RequireAuth.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import useAuthUser from "./useAuthUser";
import Spinner from "../ui/Spinner";

export default function RequireAuth({ children }) {
  const { user, loading } = useAuthUser();
  const loc = useLocation();

  if (loading) return <Spinner label="Carregando..." />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  return children;
}
