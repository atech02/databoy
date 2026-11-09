"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";

export function PublicFooter() {
  const pathname = usePathname();
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isPublicPage = ["/", "/how-it-works", "/pricing", "/story", "/trust"].includes(pathname);
  const showStickyBar = isPublicPage && !user;
  const [menuOpen, setMenuOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);

  // Dynamic mobile menu check
  useEffect(() => {
    const checkMenuState = () => {
      setMenuOpen(document.body.classList.contains("mobile-menu-open"));
    };

    checkMenuState();
    window.addEventListener("mobileMenuStateChange", checkMenuState);
    return () => window.removeEventListener("mobileMenuStateChange", checkMenuState);
  }, []);

  // Smart scroll visibility control (Priority 4 scroll behavior & Near-Footer hiding)
  useEffect(() => {
    if (menuOpen) return; // Freeze visibility state changes when menu is open

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;

      // Threshold check to prevent jitter/flicker
      if (Math.abs(currentScrollY - lastScrollY) >= 15) {
        if (currentScrollY > lastScrollY && currentScrollY > 60) {
          // Scroll Down - hide bar smoothly
          setIsVisible(false);
        } else {
          // Scroll Up - show bar smoothly
          setIsVisible(true);
        }
        setLastScrollY(currentScrollY);
      }

      // Hide the floating bar when approaching the footer/recruitment areas (Revision 5)
      // If we are within 400px of the bottom of the page, hide the action bar
      const nearBottom = scrollHeight - currentScrollY - clientHeight < 400;
      setIsNearBottom(nearBottom);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY, menuOpen]);

  return (
    <footer className="border-t border-border/40 bg-muted/40 backdrop-blur-md w-full">
      {/* Dynamic mobile padding based on sticky bar active state */}
      <div className={`container mx-auto px-4 sm:px-6 py-4 md:py-6 md:pb-8 flex flex-col gap-2 md:gap-4 ${showStickyBar ? "pb-16" : "pb-4"}`}>
        
        {/* On mobile: single-column compact list. On desktop: 4-column rich grid (Revision 1 & 7) */}
        <div className="flex flex-col md:grid md:grid-cols-4 gap-2 md:gap-4 text-center md:text-left items-center md:items-start">
          <div className="md:col-span-2 flex flex-col gap-0.5 items-center md:items-start">
            <Link href="/" className="flex items-center gap-2">
              <img
                src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
                alt="DataBoy Logo"
                className="h-6.5 w-auto"
              />
            </Link>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-sm font-semibold leading-tight">
              Professional Academic Support Platform
            </p>
            <p className="text-[9px] text-muted-foreground/80 mt-0.5 max-w-sm">
              Powered by Xenon Technologies
            </p>
          </div>

          {/* Hidden on mobile viewports, visible on desktop footprints (Revision 1 & 9) */}
          <div className="hidden md:flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Company</span>
            <ul className="text-xs font-semibold text-muted-foreground flex flex-col gap-1">
              <li>Powered by Xenon Technologies</li>
            </ul>
          </div>

          <div className="hidden md:flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Resources</span>
            <ul className="text-xs font-semibold text-muted-foreground flex flex-col gap-1">
              <li><Link href="/become-writer" className="hover:text-foreground transition-colors">Become A Writer</Link></li>
              <li><Link href="/offline" className="hover:text-foreground transition-colors">Offline Cache Page</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border/10 pt-1.5 md:pt-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] sm:text-[11px] font-medium text-muted-foreground">
          <p>© {new Date().getFullYear()} Xenon Technologies. All rights reserved.</p>
        </div>

      </div>

      {/* Sticky Mobile Action Bar - Mobile Only (Revision 5 & 6) */}
      {showStickyBar && (
        <div 
          className={`mobile-bottom-action-bar fixed bottom-0 left-0 right-0 z-40 block md:hidden bg-background/95 border-t border-border/60 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.15)] backdrop-blur-md pb-safe transition-all duration-300 ease-in-out ${
            !menuOpen && isVisible && !isNearBottom ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
          }`}
        >
          <div className="flex items-center justify-between gap-4 max-w-md mx-auto">
            {/* Become A Writer - Secondary Action (Underlined text with minimal visual weight) */}
            <Link href="/become-writer" className="flex-[0.8] text-center">
              <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors py-2 px-1 block underline underline-offset-4">
                Become A Writer
              </span>
            </Link>

            {/* Sign Up As Student - Primary Action (Highly dominant premium gradient solid button) */}
            <Link href="/signup?role=customer" className="flex-[1.2]">
              <Button 
                variant="primary" 
                size="sm" 
                className="w-full font-black text-xs uppercase tracking-wider py-2.5 shadow-md shadow-primary/30 bg-gradient-to-r from-indigo-600 to-purple-600 border-none text-white hover:from-indigo-500 hover:to-purple-500"
              >
                Sign Up As Student
              </Button>
            </Link>
          </div>
        </div>
      )}
    </footer>
  );
}
