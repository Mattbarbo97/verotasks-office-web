// src/App.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import RequireAuth from "./auth/RequireAuth";

import Login from "./pages/Login";
import OfficePanel from "./pages/OfficePanel";
import MasterPanel from "./pages/MasterPanel";
import Collaborators from "./pages/Collaborators";
import TelegramLink from "./pages/TelegramLink";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      {/* Login */}
      <Route path="/login" element={<Login />} />

      {/* Root -> Office */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <Navigate to="/office" replace />
          </RequireAuth>
        }
      />

      {/* Office */}
      <Route
        path="/office"
        element={
          <RequireAuth>
            <OfficePanel />
          </RequireAuth>
        }
      />

      {/* Master */}
      <Route
        path="/master"
        element={
          <RequireAuth>
            <MasterPanel />
          </RequireAuth>
        }
      />

      {/* Colaboradores */}
      <Route
        path="/collaborators"
        element={
          <RequireAuth>
            <Collaborators />
          </RequireAuth>
        }
      />

      {/* Telegram */}
      <Route
        path="/telegram"
        element={
          <RequireAuth>
            <TelegramLink />
          </RequireAuth>
        }
      />

      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
