"use client";

import React, { useEffect } from "react";

export function PwaProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (
      typeof window !== "undefined" && 
      "serviceWorker" in navigator && 
      process.env.NODE_ENV === "production"
    ) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((registration) => {
            console.log("DataBoy PWA Service Worker registered with scope:", registration.scope);
          })
          .catch((error) => {
            console.error("DataBoy PWA Service Worker registration failed:", error);
          });
      });
    }
  }, []);

  return <>{children}</>;
}
