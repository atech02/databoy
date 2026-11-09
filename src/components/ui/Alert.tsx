"use client";

import React, { useState } from "react";

export interface AlertProps {
  variant?: "success" | "warning" | "error" | "info";
  title?: string;
  children: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  variant = "info",
  title,
  children,
  dismissible = false,
  onDismiss,
  className = ""
}) => {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  const handleDismiss = () => {
    setIsVisible(false);
    if (onDismiss) onDismiss();
  };

  const variants = {
    success: "bg-emerald-500/10 text-emerald-800 border-emerald-500/25 dark:text-emerald-400 dark:bg-emerald-500/5",
    warning: "bg-amber-500/10 text-amber-800 border-amber-500/25 dark:text-amber-400 dark:bg-amber-500/5",
    error: "bg-destructive/10 text-destructive border-destructive/20",
    info: "bg-blue-500/10 text-blue-850 border-blue-500/25 dark:text-blue-400 dark:bg-blue-500/5",
  };

  const icons = {
    success: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div className={`flex gap-3 p-4 rounded-lg border text-sm ${variants[variant]} ${className}`} role="alert">
      <div className="flex-shrink-0">{icons[variant]}</div>
      
      <div className="flex-1 flex flex-col gap-0.5">
        {title && <span className="font-bold leading-tight">{title}</span>}
        <div className="leading-relaxed opacity-95">{children}</div>
      </div>

      {dismissible && (
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 rounded-md p-1 hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100 transition-all cursor-pointer"
          aria-label="Dismiss alert"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};
