"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useNotifications } from "@/hooks/useNotifications";
import { ProtectedRoute } from "@/components/providers/ProtectedRoute";
import { Button } from "@/components/ui/Button";

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  const { logout, user, profile } = useAuth();
  const { toggleTheme, isDark } = useTheme();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(profile?.uid);
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close notification panel when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    if (notifOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifOpen]);

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

  const handleLogout = async () => {
    try {
      await logout();
      router.replace("/");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  let navItems: { label: string; href: string }[] = [];

  if (profile?.role === "customer") {
    navItems = [
      { label: "Home", href: "/dashboard" },
      { label: "Assist with Assignment", href: "/projects/upload" },
      { label: "Assist with Research", href: "/research/request" },
      { label: "Profile", href: "/profile" },
      { label: "Settings", href: "/settings" },
    ];
  } else if (profile?.role === "writer") {
    navItems = [
      { label: "Home", href: "/dashboard" },
      { label: "Verification", href: "/verification" },
      { label: "Profile", href: "/profile" },
      { label: "Settings", href: "/settings" },
    ];
  } else if (profile?.role === "admin") {
    navItems = [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Assignments", href: "/admin?tab=assignments" },
      { label: "Verification", href: "/admin?tab=verifications" },
      { label: "Users", href: "/admin?tab=overview" },
      { label: "Reports", href: "/admin?tab=overview" },
      { label: "Settings", href: "/settings" },
    ];
  } else {
    navItems = [
      { label: "Home", href: "/dashboard" },
      { label: "Profile", href: "/profile" },
      { label: "Settings", href: "/settings" },
    ];
  }

  return (
    <ProtectedRoute>
      <div className="flex flex-col flex-1 min-h-screen bg-background text-foreground transition-colors duration-300">
        
        {/* Navigation Bar */}
        <header className="border-b border-border/40 bg-card/65 backdrop-blur-md sticky top-0 z-30">
          <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="flex items-center gap-2 min-h-[44px]">
                <img
                  src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
                  alt="DataBoy Logo"
                  className="h-8 w-auto"
                />
                {mounted && !isMobile && (
                  <span className="font-bold tracking-tight text-foreground text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase text-[9px]">Portal</span>
                )}
              </Link>

              {mounted && !isMobile && (
                <nav className="flex items-center gap-2">
                  {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Notification Bell — desktop */}
              {mounted && (
                <div className="relative" ref={notifRef}>
                  <button
                    onClick={() => setNotifOpen(o => !o)}
                    className="relative p-2 rounded-lg hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
                    aria-label="Notifications"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger text-white text-[9px] font-black rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Notification Dropdown */}
                  {notifOpen && (
                    <div className="absolute right-0 top-full mt-2 w-80 z-50 rounded-xl border border-border/50 shadow-2xl bg-card overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-secondary/20">
                        <span className="text-xs font-black uppercase tracking-wider text-foreground">Notifications</span>
                        {unreadCount > 0 && (
                          <button
                            onClick={() => markAllRead()}
                            className="text-[10px] font-bold text-primary hover:text-primary/80 cursor-pointer"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">No notifications yet.</div>
                        ) : (
                          notifications.slice(0, 15).map(n => (
                            <div
                              key={n.id}
                              className={`px-4 py-3 border-b border-border/20 cursor-pointer hover:bg-secondary/30 transition-colors ${
                                !n.read ? "bg-primary/5" : ""
                              }`}
                              onClick={async () => {
                                await markRead(n.id);
                                setNotifOpen(false);
                                if (n.relatedUrl) router.push(n.relatedUrl);
                              }}
                            >
                              <div className="flex items-start gap-2">
                                {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />}
                                <div className={`flex flex-col gap-0.5 ${n.read ? "pl-3.5" : ""}`}>
                                  <span className="text-[11px] font-bold text-foreground">{n.title}</span>
                                  <span className="text-[10px] text-muted-foreground leading-relaxed">{n.message}</span>
                                  <span className="text-[9px] text-muted-foreground/60 font-mono mt-0.5">
                                    {new Date(n.createdAt).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {mounted && !isMobile && (
                <div className="flex items-center gap-4">
                  {/* Theme Toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleTheme}
                    className="p-2 cursor-pointer"
                    title="Toggle Theme"
                  >
                    {isDark ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.364l-.707-.707M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                  </Button>

                  {/* User Identity Info */}
                  {user && (
                    <div className="flex flex-col items-end text-xs">
                      <span className="font-bold text-foreground">{user.displayName || "DataBoy User"}</span>
                      <span className="text-muted-foreground font-medium">{user.email}</span>
                    </div>
                  )}

                  {/* Logout Button */}
                  <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
                    Log Out
                  </Button>
                </div>
              )}

              {/* Mobile Navigation Trigger - simplified minimalist header trigger */}
              {mounted && isMobile && (
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="p-2 rounded-lg hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Toggle menu"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Mobile Drawer Overlay - Backdrop + Sliding Opaque Responsive Panel using createPortal */}
          {mounted && mobileMenuOpen && createPortal(
            <>
              {/* Backdrop Overlay - dims background with blur filter */}
              <div 
                className="fixed inset-0 z-[9999] md:hidden animate-in fade-in duration-200 bg-black/45 backdrop-blur-[4px]"
                onClick={() => setMobileMenuOpen(false)}
              />

              {/* Sliding responsive panel */}
              <div 
                id="mobile-drawer-panel"
                className="fixed inset-y-0 left-0 z-[10000] w-[90vw] sm:w-[380px] max-w-[400px] h-full flex flex-col md:hidden animate-in slide-in-from-left duration-300 shadow-2xl"
                style={{ backgroundColor: isDark ? "#0F172A" : "#FCFCFC" }}
              >
                {/* Drawer Header */}
                <div 
                  className="flex h-14 items-center justify-between px-4 border-b border-border/40 shrink-0"
                  style={{ backgroundColor: isDark ? "#0A0E1A" : "#E2E8F0" }}
                >
                  <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2">
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

                {/* Navigation links, details, and controls */}
                <nav className="flex-1 flex flex-col p-5 gap-3 text-xs font-bold uppercase tracking-wider text-foreground overflow-y-auto">
                  
                  {/* User Identity Details inside drawer */}
                  {user && (
                    <div className="flex flex-col gap-1 pb-3 mb-2 border-b border-border/10">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-foreground text-sm lowercase font-mono">
                          {user.displayName || "DataBoy User"}
                        </span>
                        {profile && (
                          <span className="text-[8px] tracking-widest font-black uppercase bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                            {profile.role === "customer" ? "Student" : profile.role}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground normal-case font-normal">{user.email}</span>
                    </div>
                  )}

                  {/* Navigation Items */}
                  {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`text-sm font-semibold px-4 py-3 rounded-lg transition-colors min-h-[44px] flex items-center ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}

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

                  {/* Logout Button */}
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleLogout();
                    }} 
                    className="mt-auto w-full py-3 min-h-[44px]"
                  >
                    Log Out
                  </Button>
                </nav>
              </div>
            </>
          , document.body)}
        </header>

        {/* Dynamic page content */}
        <main className="flex-1 container mx-auto px-4 sm:px-6 py-8">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
