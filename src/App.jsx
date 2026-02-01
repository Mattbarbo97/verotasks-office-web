import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import PrivateRoute from "./routes/PrivateRoute";

import Login from "./pages/Login";
import OfficePanel from "./pages/OfficePanel";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/office" replace />} />
      <Route path="/login" element={<Login />} />

      <Route
        path="/office"
        element={
          <PrivateRoute>
            <OfficePanel />
          </PrivateRoute>
        }
      />

      <Route path="*" element={<Navigate to="/office" replace />} />
    </Routes>
  );
}
