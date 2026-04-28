import React, { useState } from "react";

/**
 * Persistent warning banner shown while the app is in non-HIPAA pilot mode.
 *
 * Rendered when REACT_APP_PILOT_BANNER === "true" (default ON in production
 * until the HIPAA path in infra/README.md is completed). Dismissal is per-tab
 * only — we deliberately do NOT persist dismissal so the warning re-appears
 * on every reload.
 */
export default function PilotBanner() {
  const enabled = (process.env.REACT_APP_PILOT_BANNER || "true") === "true";
  const [dismissed, setDismissed] = useState(false);
  if (!enabled || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        backgroundColor: "#7f1d1d",
        color: "#fff",
        fontSize: 14,
        fontWeight: 600,
        textAlign: "center",
        padding: "8px 40px 8px 16px",
        borderBottom: "1px solid #450a0a",
      }}
    >
      PILOT ENVIRONMENT &mdash; DO NOT ENTER REAL PROTECTED HEALTH INFORMATION (PHI). Use synthetic / test data only.
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss pilot warning for this tab"
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          background: "transparent",
          color: "#fff",
          border: "none",
          fontSize: 16,
          cursor: "pointer",
          lineHeight: 1,
          padding: "4px 8px",
        }}
      >
        ×
      </button>
    </div>
  );
}
