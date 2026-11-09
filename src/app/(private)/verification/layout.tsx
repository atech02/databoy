"use client";

import React from "react";
import { ProtectedRoute } from "@/components/providers/ProtectedRoute";

export default function VerificationLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={["writer"]}>
      {children}
    </ProtectedRoute>
  );
}
