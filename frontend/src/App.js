import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/App.css";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import PilotBanner from "@/components/PilotBanner";
import Login from "@/pages/Login";
import AdminDashboard from "@/pages/AdminDashboard";
import TherapistsPage from "@/pages/TherapistsPage";
import ClientsPage from "@/pages/ClientsPage";
import MatchingPage from "@/pages/MatchingPage";
import SchedulePage from "@/pages/SchedulePage";
import InsurancePage from "@/pages/InsurancePage";
import MapPage from "@/pages/MapPage";
import UsersPage from "@/pages/UsersPage";
import TherapistPortal from "@/pages/TherapistPortal";
import ClientPortal from "@/pages/ClientPortal";
import { Toaster } from "@/components/ui/sonner";

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading || user === null) return <div className="min-h-screen flex items-center justify-center bg-base"><span className="text-muted-ohana">Loading…</span></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  if (user.role === "therapist") return <Navigate to="/therapist" replace />;
  if (user.role === "client") return <Navigate to="/client" replace />;
  return <Navigate to="/login" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PilotBanner />
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute roles={["admin"]}><Layout /></ProtectedRoute>}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/therapists" element={<TherapistsPage />} />
            <Route path="/admin/clients" element={<ClientsPage />} />
            <Route path="/admin/matching" element={<MatchingPage />} />
            <Route path="/admin/schedule" element={<SchedulePage />} />
            <Route path="/admin/insurance" element={<InsurancePage />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/map" element={<MapPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["therapist"]}><Layout /></ProtectedRoute>}>
            <Route path="/therapist" element={<TherapistPortal />} />
          </Route>

          <Route element={<ProtectedRoute roles={["client"]}><Layout /></ProtectedRoute>}>
            <Route path="/client" element={<ClientPortal />} />
          </Route>

          <Route path="/" element={<RoleRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster richColors position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
