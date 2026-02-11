// src/App.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import RequireAuth from "./auth/RequireAuth";
import RequireMaster from "./auth/RequireMaster";

import Login from "./pages/Login";
import OfficePanel from "./pages/OfficePanel";
import MasterPanel from "./pages/MasterPanel";
import Collaborators from "./pages/Collaborators";
import TelegramLink from "./pages/TelegramLink";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Área autenticada */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <Navigate to="/office" replace />
          </RequireAuth>
        }
      />

      <Route
        path="/office"
        element={
          <RequireAuth>
            <OfficePanel />
          </RequireAuth>
        }
      />

      <Route
        path="/telegram"
        element={
          <RequireAuth>
            <TelegramLink />
          </RequireAuth>
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
