"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js. Production-only: in dev, an active SW would
 * intercept Turbopack's HMR requests and serve stale chunks.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("service worker registration failed", err);
    });
  }, []);
  return null;
}
