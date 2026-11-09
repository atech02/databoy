"use client";

import React from "react";
import { useRouter } from "next/navigation";

interface BackButtonProps {
  fallbackUrl?: string; // Route to navigate to if no browser history exists
  label?: string; // Text to display next to the arrow
  className?: string; // Custom classes
}

export function BackButton({
  fallbackUrl = "/dashboard",
  label = "Back",
  className = ""
}: BackButtonProps) {
  const router = useRouter();

  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    
    // Check if there is browser history within the app
    const hasHistory = typeof window !== "undefined" && window.history.length > 1;
    
    if (hasHistory) {
      router.back();
    } else {
      router.push(fallbackUrl);
    }
  };

  return (
    <button
      onClick={handleBack}
      className={`inline-flex items-center justify-center p-2 text-muted-foreground hover:text-foreground bg-transparent border-transparent transition-all active:scale-95 cursor-pointer ${className}`}
      aria-label={label}
      title={label}
    >
      <svg
        className="w-6 h-6 transition-transform duration-200 group-hover:-translate-x-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}
