"use client";

import React, { useEffect } from "react";
import { Button } from "./Button";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footerActions?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footerActions,
  size = "md"
}) => {
  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-5xl",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay Backdrop */}
      <div 
        className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-300 cursor-pointer"
        onClick={onClose}
      />
      
      {/* Modal Dialog Content Container */}
      <div className={`relative w-full ${sizeClasses[size]} rounded-xl border border-border bg-card text-card-foreground shadow-2xl transition-all duration-300 z-10 flex flex-col max-h-[90vh]`}>
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border/40">
          {title ? (
            <h3 className="text-lg font-bold tracking-tight text-foreground">{title}</h3>
          ) : (
            <div />
          )}
          <button 
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto flex-1 text-sm text-foreground/90 leading-relaxed">
          {children}
        </div>

        {/* Footer */}
        {footerActions && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border/40 bg-muted/15">
            {footerActions}
          </div>
        )}
      </div>
    </div>
  );
};
