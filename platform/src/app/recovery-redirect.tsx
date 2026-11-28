"use client";

import { useEffect } from "react";

// Dashboard reset emails return to the configured Site URL. Forward their
// fragment to the recovery page without exposing its tokens to the server.
export function RecoveryRedirect() {
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.get("type") === "recovery") {
      window.location.replace("/reset-password" + window.location.hash);
    }
  }, []);
  return null;
}
