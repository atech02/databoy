"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";

export default function SettingsPage() {
  const { profile } = useAuth();
  const { toggleTheme, isDark } = useTheme();

  // Mock notification switch states
  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    smsAlerts: false,
    pushNotifications: true,
    escrowAlerts: true,
    assignmentUpdates: true,
  });

  // PWA Diagnostic States
  const [pwaStatus, setPwaStatus] = useState({
    isInstalled: false,
    isStandalone: false,
    serviceWorkerRegistered: false,
    offlineCapable: true,
    devicePlatform: "Unknown",
  });

  useEffect(() => {
    // Detect PWA mode and platform
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || 
                          (window.navigator as any).standalone === true;
    
    // Check service worker
    const hasSW = "serviceWorker" in navigator && navigator.serviceWorker.controller !== null;

    // Detect user agent
    const userAgent = window.navigator.userAgent.toLowerCase();
    let platform = "Desktop / Web Browser";
    if (/iphone|ipad|ipod/.test(userAgent)) {
      platform = "iOS Device";
    } else if (/android/.test(userAgent)) {
      platform = "Android Device";
    }

    setPwaStatus({
      isInstalled: isStandalone, // basic heuristic
      isStandalone: isStandalone,
      serviceWorkerRegistered: "serviceWorker" in navigator,
      offlineCapable: true,
      devicePlatform: platform,
    });
  }, []);

  const handleToggle = (key: keyof typeof notifications) => {
    setNotifications((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      
      {/* Back Button */}
      <div className="flex items-center">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left column: Menu/Details */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-sm">Settings Overview</CardTitle>
              <CardDescription>Configure notifications, platform preference and diagnostics.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="p-4 bg-secondary/30 rounded-xl flex flex-col gap-2 border border-border/20">
                <span className="text-xs text-muted-foreground uppercase font-semibold font-mono tracking-wider">Active Role</span>
                <div className="flex items-center justify-between">
                  <Badge variant="primary" className="uppercase font-mono text-[10px]">
                    {profile?.role || "user"}
                  </Badge>
                  {profile?.verificationStatus && (
                    <Badge variant={profile.verificationStatus === "approved" ? "success" : "warning"} className="uppercase font-mono text-[10px]">
                      {profile.verificationStatus}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 mt-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">Quick Links</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => window.location.href = "/profile"}
                  className="w-full text-left justify-start"
                >
                  Edit Profile
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Device and App Diagnostics Panel */}
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-sm">PWA Diagnostics</CardTitle>
              <CardDescription>Check installation and service worker state</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3.5">
              <div className="flex justify-between items-center text-xs border-b border-border/20 pb-2">
                <span className="text-muted-foreground">Running Mode</span>
                <span className="font-semibold">{pwaStatus.isStandalone ? "Installed PWA" : "Standard Web browser"}</span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-border/20 pb-2">
                <span className="text-muted-foreground">Platform</span>
                <span className="font-semibold">{pwaStatus.devicePlatform}</span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-border/20 pb-2">
                <span className="text-muted-foreground">Service Worker</span>
                <span className={`font-semibold ${pwaStatus.serviceWorkerRegistered ? "text-success" : "text-warning"}`}>
                  {pwaStatus.serviceWorkerRegistered ? "Active" : "Not Found"}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs pb-1">
                <span className="text-muted-foreground">Offline Support</span>
                <span className="font-semibold text-success">Enabled</span>
              </div>
              {pwaStatus.isStandalone ? (
                <Alert variant="success" className="mt-2 text-[11px] py-2 px-3">
                  DataBoy is installed on this device. You will experience fast transitions and persistent headers.
                </Alert>
              ) : (
                <div className="bg-primary/5 border border-primary/20 p-3 rounded-xl flex flex-col gap-1.5 mt-2">
                  <span className="text-xs font-bold text-primary">Install DataBoy PWA</span>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Install to your home screen for standard native back gesture support, offline mode, and push notifications.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Main Config Form */}
        <div className="md:col-span-2 flex flex-col gap-6">
          
          {/* Preferences Card */}
          <Card className="shadow-md border-border/40">
            <CardHeader className="border-b border-border/40">
              <CardTitle>Display Preferences</CardTitle>
              <CardDescription>Customise the interface visual appearance</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col gap-4">
              <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-xl border border-border/20">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-foreground">Dark Theme Appearance</span>
                  <p className="text-xs text-muted-foreground">Toggle the interface theme color between night and day modes.</p>
                </div>
                <button
                  onClick={toggleTheme}
                  className={`w-14 h-8 rounded-full transition-all duration-300 relative flex items-center px-1 border border-border/30 cursor-pointer ${
                    isDark ? "bg-primary" : "bg-secondary-foreground/20"
                  }`}
                  aria-label="Toggle Dark Mode"
                >
                  <div 
                    className={`w-6 h-6 rounded-full bg-neutral-50 shadow-md flex items-center justify-center transition-all duration-300 transform ${
                      isDark ? "translate-x-6" : "translate-x-0"
                    }`}
                  >
                    {isDark ? (
                      <span className="text-[10px] select-none">🌙</span>
                    ) : (
                      <span className="text-[10px] select-none">☀️</span>
                    )}
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Notifications Card */}
          <Card className="shadow-md border-border/40">
            <CardHeader className="border-b border-border/40">
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>Stay up-to-date with assignment milestones and payments</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col gap-4">
              
              <div className="flex items-center justify-between p-4 bg-secondary/10 rounded-xl border border-border/10">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-foreground">Email Alerts</span>
                  <p className="text-xs text-muted-foreground">Receive critical billing and assignment invoices in your inbox.</p>
                </div>
                <button
                  onClick={() => handleToggle("emailAlerts")}
                  className={`w-12 h-6.5 rounded-full transition-all duration-300 relative flex items-center px-1 border border-border/30 cursor-pointer ${
                    notifications.emailAlerts ? "bg-primary" : "bg-secondary-foreground/10"
                  }`}
                  aria-label="Toggle Email Alerts"
                >
                  <div 
                    className={`w-4.5 h-4.5 rounded-full bg-neutral-50 shadow-md transition-all duration-300 transform ${
                      notifications.emailAlerts ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-secondary/10 rounded-xl border border-border/10">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-foreground">SMS Notifications</span>
                  <p className="text-xs text-muted-foreground">Get instant text alerts when assignments are claimed or updated.</p>
                </div>
                <button
                  onClick={() => handleToggle("smsAlerts")}
                  className={`w-12 h-6.5 rounded-full transition-all duration-300 relative flex items-center px-1 border border-border/30 cursor-pointer ${
                    notifications.smsAlerts ? "bg-primary" : "bg-secondary-foreground/10"
                  }`}
                  aria-label="Toggle SMS Alerts"
                >
                  <div 
                    className={`w-4.5 h-4.5 rounded-full bg-neutral-50 shadow-md transition-all duration-300 transform ${
                      notifications.smsAlerts ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-secondary/10 rounded-xl border border-border/10">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-foreground">System Push Notifications</span>
                  <p className="text-xs text-muted-foreground">Enable desktop and mobile device notification popups.</p>
                </div>
                <button
                  onClick={() => handleToggle("pushNotifications")}
                  className={`w-12 h-6.5 rounded-full transition-all duration-300 relative flex items-center px-1 border border-border/30 cursor-pointer ${
                    notifications.pushNotifications ? "bg-primary" : "bg-secondary-foreground/10"
                  }`}
                  aria-label="Toggle Push Notifications"
                >
                  <div 
                    className={`w-4.5 h-4.5 rounded-full bg-neutral-50 shadow-md transition-all duration-300 transform ${
                      notifications.pushNotifications ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-secondary/10 rounded-xl border border-border/10">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-foreground">Escrow Release Alerts</span>
                  <p className="text-xs text-muted-foreground">Alert immediately when money is transferred to or released from contract.</p>
                </div>
                <button
                  onClick={() => handleToggle("escrowAlerts")}
                  className={`w-12 h-6.5 rounded-full transition-all duration-300 relative flex items-center px-1 border border-border/30 cursor-pointer ${
                    notifications.escrowAlerts ? "bg-primary" : "bg-secondary-foreground/10"
                  }`}
                  aria-label="Toggle Escrow Alerts"
                >
                  <div 
                    className={`w-4.5 h-4.5 rounded-full bg-neutral-50 shadow-md transition-all duration-300 transform ${
                      notifications.escrowAlerts ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

            </CardContent>
          </Card>

        </div>

      </div>

    </div>
  );
}
