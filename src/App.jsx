// src/App.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import RequireAuth from "./auth/RequireAuth";
import RequireMaster from "./auth/RequireMaster";
import RequireOfficeAdmin from "./auth/RequireOfficeAdmin";
import RequireOfficeAccess from "./auth/RequireOfficeAccess";

import Login from "./pages/Login";
import OfficePanel from "./pages/OfficePanel";
import MasterPanel from "./pages/MasterPanel";
import Collaborators from "./pages/Collaborators";
import TelegramLink from "./pages/TelegramLink";
import NotFound from "./pages/NotFound";

import OfficeAccess from "./pages/OfficeAccess";
import AccessBlocked from "./pages/AccessBlocked";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Bloqueado (sem membership/sem acesso) */}
      <Route
        path="/blocked"
        element={
          <RequireAuth>
            <AccessBlocked />
          </RequireAuth>
        }
      />

      {/* Área autenticada */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <Navigate to="/office" replace />
          </RequireAuth>
        }
      />

      {/* Office (exige membership ativo) */}
      <Route
        path="/office"
        element={
          <RequireOfficeAccess>
            <OfficePanel />
          </RequireOfficeAccess>
        }
      />

      {/* ✅ Office Admin-only: gestão de acessos/pessoas */}
      <Route
        path="/office/access"
        element={
          <RequireOfficeAdmin>
            <OfficeAccess />
          </RequireOfficeAdmin>
        }
      />

      {/* Telegram link (exige membership ativo) */}
      <Route
        path="/telegram"
        element={
          <RequireOfficeAccess>
            <TelegramLink />
          </RequireOfficeAccess>
        }
      />

      {/* Master-only */}
      <Route
        path="/master"
        element={
          <RequireMaster>
            <MasterPanel />
          </RequireMaster>
        }
      />

      <Route
        path="/collaborators"
        element={
          <RequireMaster>
            <Collaborators />
          </RequireMaster>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
