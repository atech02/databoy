"use client";

import React from "react";
import { ProtectedRoute } from "@/components/providers/ProtectedRoute";

export default function UploadLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute allowedRoles={["customer"]}>
      {children}
    </ProtectedRoute>
  );
}
