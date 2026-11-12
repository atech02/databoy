"use client";

import React, { useState } from "react";
import { storageService, AuthorizedFileReference } from "@/services/storageService";

interface AuthorizedFileLinkProps {
  fileRef: AuthorizedFileReference;
  className?: string;
  children: React.ReactNode;
}

/**
 * Triggers short-lived backend-authorized R2 download URL resolution on click,
 * ensuring private documents are never exposed through permanent public URLs.
 */
export function AuthorizedFileLink({ fileRef, className, children }: AuthorizedFileLinkProps) {
  const [loading, setLoading] = useState(false);

  const handleOpen = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (loading) return;
    if (fileRef.url === "#") return;

    setLoading(true);
    try {
      await storageService.openAuthorizedFile(fileRef);
    } catch (err: any) {
      alert(err?.message || "Unable to authorize document download");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={loading}
      className={className}
    >
      {loading ? "Authorizing..." : children}
    </button>
  );
}
