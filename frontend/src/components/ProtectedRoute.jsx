import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading || user === null) {
    return (
      <div data-testid="auth-loading" className="min-h-screen flex items-center justify-center bg-base">
        <div className="text-muted-ohana">Loading…</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
