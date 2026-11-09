"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";

export function PublicHeader() {
  const { toggleTheme, isDark } = useTheme();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    setMounted(true);
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Lock body scrolling when mobile drawer is open (Fix C & Webkit Scroll Locking)
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      document.body.classList.add("mobile-menu-open");
      window.dispatchEvent(new Event("mobileMenuStateChange"));

      // iOS Safari gesture/scroll prevention
      const preventDefault = (e: TouchEvent) => {
        const drawerElement = document.getElementById("mobile-drawer-panel");
        if (drawerElement && drawerElement.contains(e.target as Node)) {
          // Allow scrolling inside the drawer if needed
          return;
        }
        if (e.cancelable) {
          e.preventDefault();
        }
      };

      document.addEventListener("touchmove", preventDefault, { passive: false });

      return () => {
        document.body.style.overflow = "";
        document.documentElement.style.overflow = "";
        document.body.classList.remove("mobile-menu-open");
        window.dispatchEvent(new Event("mobileMenuStateChange"));
        document.removeEventListener("touchmove", preventDefault);
      };
    } else {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      document.body.classList.remove("mobile-menu-open");
      window.dispatchEvent(new Event("mobileMenuStateChange"));
    }
  }, [mobileMenuOpen]);

  return (
    <header className={`sticky top-0 w-full border-b border-border/40 bg-background/80 backdrop-blur-md transition-all duration-200 ${mobileMenuOpen ? "z-50" : "z-40"}`}>
      {/* Header height compressed to h-14 on desktop and mobile */}
      <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2 min-h-[44px]">
            <img
              src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
              alt="DataBoy Logo"
              className="h-7 w-auto"
            />
          </Link>
        </div>

        {mounted && !isMobile && (
          <nav className="flex items-center gap-3 lg:gap-4 xl:gap-5 text-[11px] lg:text-xs font-bold uppercase tracking-wider text-muted-foreground/85">
            <Link href="/" className="hover:text-primary transition-colors">Home</Link>
            <Link href="/how-it-works" className="hover:text-primary transition-colors">How It Works</Link>
            <Link href="/pricing" className="hover:text-primary transition-colors">Pricing</Link>
            <Link href="/story" className="hover:text-primary transition-colors">Origin Story</Link>
            <Link href="/trust" className="hover:text-primary transition-colors">Trust & Quality</Link>
            <Link href="/become-writer" className="hover:text-primary transition-colors">Become A Writer</Link>
          </nav>
        )}

        {/* Desktop Actions */}
        {mounted && !isMobile && (
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              className="p-1.5"
              title={`Switch to ${isDark ? "light" : "dark"} mode`}
            >
              {isDark ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.364l-.707-.707M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </Button>
            
            {user ? (
              <Link href="/dashboard">
                <Button variant="primary" size="sm" className="font-bold text-[10px] lg:text-xs uppercase tracking-wider px-3 lg:px-4">Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-[10px] lg:text-xs font-bold uppercase tracking-wider px-2.5">Sign In</Button>
                </Link>
                
                <Link href="/signup?role=customer">
                  <Button variant="primary" size="sm" className="font-bold text-[10px] lg:text-xs uppercase tracking-wider px-3 lg:px-4">Sign Up As Student</Button>
                </Link>
              </>
            )}
          </div>
        )}

        {/* Mobile Controls: Hamburger Menu only */}
        {mounted && isMobile && (
          <div className="flex items-center">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 text-foreground hover:text-primary transition-colors focus:outline-none min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
              aria-label="Open menu"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Mobile Drawer Overlay - Backdrop + Sliding Solid Panel Layout via React Portal to prevent stacking trapping */}
      {mounted && mobileMenuOpen && createPortal(
        <>
          {/* Backdrop Overlay - dims the background with a blur filter and blocks layout interaction */}
          <div 
            className="fixed inset-0 z-[9999] md:hidden animate-in fade-in duration-200 bg-black/45 backdrop-blur-[4px]"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Sliding panel layer - 100% solid responsive drawer width panel, slides from left, 100vh height */}
          <div 
            id="mobile-drawer-panel"
            className="fixed inset-y-0 left-0 z-[10000] w-[90vw] sm:w-[380px] max-w-[400px] h-full flex flex-col md:hidden animate-in slide-in-from-left duration-300 shadow-2xl"
            style={{ backgroundColor: isDark ? "#0F172A" : "#FCFCFC" }}
          >
            {/* Drawer Header with distinct surface shading */}
            <div 
              className="flex h-14 items-center justify-between px-4 border-b border-border/40 shrink-0"
              style={{ backgroundColor: isDark ? "#0A0E1A" : "#E2E8F0" }}
            >
              <Link href="/" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2">
                <img
                  src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
                  alt="DataBoy Logo"
                  className="h-7 w-auto"
                />
              </Link>
              
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-foreground hover:text-primary transition-colors focus:outline-none min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                aria-label="Close menu"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Drawer Links - STRICLY navigation links and controls only. overflow-y-auto allows internal scrolling */}
            <nav className="flex-1 flex flex-col p-5 gap-3 text-xs font-bold uppercase tracking-wider text-foreground overflow-y-auto">
              <Link 
                href="/" 
                onClick={() => setMobileMenuOpen(false)} 
                className="hover:text-primary transition-colors py-3 border-b border-border/10 min-h-[44px] flex items-center animate-in slide-in-from-left duration-200 delay-75"
              >
                Home
              </Link>
              <Link 
                href="/how-it-works" 
                onClick={() => setMobileMenuOpen(false)} 
                className="hover:text-primary transition-colors py-3 border-b border-border/10 min-h-[44px] flex items-center animate-in slide-in-from-left duration-200 delay-100"
              >
                How It Works
              </Link>
              <Link 
                href="/pricing" 
                onClick={() => setMobileMenuOpen(false)} 
                className="hover:text-primary transition-colors py-3 border-b border-border/10 min-h-[44px] flex items-center animate-in slide-in-from-left duration-200 delay-125"
              >
                Pricing
              </Link>
              <Link 
                href="/story" 
                onClick={() => setMobileMenuOpen(false)} 
                className="hover:text-primary transition-colors py-3 border-b border-border/10 min-h-[44px] flex items-center animate-in slide-in-from-left duration-200 delay-150"
              >
                Origin Story
              </Link>
              <Link 
                href="/trust" 
                onClick={() => setMobileMenuOpen(false)} 
                className="hover:text-primary transition-colors py-3 border-b border-border/10 min-h-[44px] flex items-center animate-in slide-in-from-left duration-200 delay-175"
              >
                Trust & Quality
              </Link>
              <Link 
                href="/become-writer" 
                onClick={() => setMobileMenuOpen(false)} 
                className="hover:text-primary transition-colors py-3 border-b border-border/10 min-h-[44px] flex items-center animate-in slide-in-from-left duration-200 delay-200"
              >
                Become a Writer
              </Link>

              {/* Theme Toggle row inside drawer */}
              <div className="flex items-center justify-between py-2 border-b border-border/10 mt-2 min-h-[44px]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Theme Mode</span>
                <button
                  onClick={toggleTheme}
                  className="flex items-center gap-2 text-xs font-bold text-foreground py-2 px-3 bg-secondary/50 rounded-lg min-h-[44px] cursor-pointer focus:outline-none"
                >
                  {isDark ? "☀️ Light Mode" : "🌙 Dark Mode"}
                </button>
              </div>

              {user ? (
                <Link 
                  href="/dashboard" 
                  onClick={() => setMobileMenuOpen(false)} 
                  className="mt-auto bg-primary text-primary-foreground text-center py-3 rounded-lg font-bold tracking-wider hover:bg-primary/90 transition-colors text-xs uppercase min-h-[44px] flex items-center justify-center"
                >
                  Dashboard
                </Link>
              ) : (
                <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-border/10">
                  <Link 
                    href="/login" 
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full"
                  >
                    <Button variant="outline" className="w-full py-3 text-xs font-bold uppercase tracking-wider min-h-[44px]">Sign In</Button>
                  </Link>
                  <Link 
                    href="/signup?role=customer" 
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full"
                  >
                    <Button variant="primary" className="w-full py-3 text-xs font-bold uppercase tracking-wider min-h-[44px]">Sign Up As Student</Button>
                  </Link>
                </div>
              )}
            </nav>
          </div>
        </>,
        document.body
      )}
    </header>
  );
}
