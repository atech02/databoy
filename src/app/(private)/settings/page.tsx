"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { userService } from "@/services/userService";
import { notificationService, NotificationConfigStatus, PushRegistrationState } from "@/services/notificationService";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";

export default function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { toggleTheme, isDark } = useTheme();

  // Persisted notification preferences (Phase 2)
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [notifConfig, setNotifConfig] = useState<NotificationConfigStatus | null>(null);

  const [saving, setSaving] = useState(false);
  const [togglingPush, setTogglingPush] = useState(false);
  const [showPushExplainModal, setShowPushExplainModal] = useState(false);
  const [pushState, setPushState] = useState<PushRegistrationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // PWA Diagnostic States
  const [pwaStatus, setPwaStatus] = useState({
    isInstalled: false,
    isStandalone: false,
    serviceWorkerRegistered: false,
    offlineCapable: true,
    devicePlatform: "Unknown",
  });

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    const userAgent = window.navigator.userAgent.toLowerCase();
    let platform = "Desktop / Web Browser";
    if (/iphone|ipad|ipod/.test(userAgent)) {
      platform = "iOS Device";
    } else if (/android/.test(userAgent)) {
      platform = "Android Device";
    }

    setPwaStatus({
      isInstalled: isStandalone,
      isStandalone: isStandalone,
      serviceWorkerRegistered: "serviceWorker" in navigator,
      offlineCapable: true,
      devicePlatform: platform,
    });
  }, []);

  useEffect(() => {
    if (profile?.preferences) {
      setInAppNotifications(profile.preferences.inAppNotifications !== false);
      setEmailNotifications(profile.preferences.emailNotifications !== false);
      setPushNotifications(profile.preferences.pushNotifications === true);
    }
  }, [profile]);

  const loadNotificationStatus = async () => {
    try {
      const status = await notificationService.getNotificationStatus();
      setNotifConfig(status);
      setInAppNotifications(status.preferences.inAppNotifications);
      setEmailNotifications(status.preferences.emailNotifications);
      setPushNotifications(status.preferences.pushNotifications);
    } catch {
      // Fallback to local profile preferences
    }
  };

  useEffect(() => {
    if (profile?.uid) {
      loadNotificationStatus();
    }
  }, [profile?.uid]);

  const handleTogglePreference = async (
    key: "inAppNotifications" | "emailNotifications",
    nextVal: boolean
  ) => {
    if (!profile) return;
    setError(null);
    setSuccess(null);

    if (key === "inAppNotifications") setInAppNotifications(nextVal);
    if (key === "emailNotifications") setEmailNotifications(nextVal);

    setSaving(true);
    try {
      const updated = {
        inAppNotifications: key === "inAppNotifications" ? nextVal : inAppNotifications,
        emailNotifications: key === "emailNotifications" ? nextVal : emailNotifications,
        pushNotifications,
      };
      try {
        await notificationService.updatePreferences(updated);
      } catch {
        await userService.updateUserProfile(profile.uid, {
          preferences: {
            ...profile.preferences,
            notifications: {
              inApp: updated.inAppNotifications,
              email: updated.emailNotifications,
              push: updated.pushNotifications,
            },
            ...updated,
          },
        });
      }
      await refreshProfile();
      await loadNotificationStatus();
      setSuccess("Notification preference saved.");
    } catch (err: any) {
      setError(err?.message || "Failed to update notification preference.");
    } finally {
      setSaving(false);
    }
  };

  const handlePushToggleClick = async () => {
    setError(null);
    setSuccess(null);

    if (pushNotifications) {
      setTogglingPush(true);
      try {
        await notificationService.disablePushNotifications(false);
        setPushNotifications(false);
        await refreshProfile();
        await loadNotificationStatus();
        setSuccess("Push notifications disabled and device unregistered.");
      } catch (err: any) {
        setError(err?.message || "Failed to disable push notifications.");
      } finally {
        setTogglingPush(false);
      }
    } else {
      setShowPushExplainModal(true);
    }
  };

  const handleConfirmEnablePush = async () => {
    setShowPushExplainModal(false);
    setTogglingPush(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await notificationService.enablePushNotifications();
      setPushState(res.state);
      if (!res.success || res.state !== "enabled") {
        setError(res.error || "Could not enable push notifications.");
        setPushNotifications(false);
      } else {
        setPushNotifications(true);
        await refreshProfile();
        await loadNotificationStatus();
        setSuccess("Push notifications enabled for this device.");
      }
    } catch (err: any) {
      setPushState("registration_failed");
      setPushNotifications(false);
      setError(err?.message || "Failed to enable push notifications.");
    } finally {
      setTogglingPush(false);
    }
  };

  const pushSupport = notificationService.isBrowserPushSupported();

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-10">
      <div className="flex items-center">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
      </div>

      {error && (
        <Alert variant="error" title="Settings Error">
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" title="Updated">
          {success}
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column: Menu/Details */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-sm">Settings Overview</CardTitle>
              <CardDescription>Configure notifications, platform appearance and diagnostics.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="p-4 bg-secondary/30 rounded-xl flex flex-col gap-2 border border-border/20">
                <span className="text-xs text-muted-foreground uppercase font-semibold font-mono tracking-wider">
                  Active Role
                </span>
                <div className="flex items-center justify-between flex-wrap gap-1.5">
                  <Badge variant="primary" className="uppercase font-mono text-[10px]">
                    {profile?.role || "user"}
                  </Badge>
                  {profile?.verificationStatus && profile.verificationStatus !== "draft" && (
                    <Badge
                      variant={profile.verificationStatus === "approved" ? "success" : "warning"}
                      className="uppercase font-mono text-[10px]"
                    >
                      {profile.verificationStatus.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 mt-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                  Quick Links
                </span>
                <Link href="/profile" className="w-full">
                  <Button variant="outline" size="sm" className="w-full text-left justify-start">
                    Manage Profile & Security
                  </Button>
                </Link>
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
                <span className="font-semibold">
                  {pwaStatus.isStandalone ? "Installed PWA" : "Standard Web browser"}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-border/20 pb-2">
                <span className="text-muted-foreground">Platform</span>
                <span className="font-semibold">{pwaStatus.devicePlatform}</span>
              </div>
              <div className="flex justify-between items-center text-xs border-b border-border/20 pb-2">
                <span className="text-muted-foreground">Service Worker</span>
                <span
                  className={`font-semibold ${
                    pwaStatus.serviceWorkerRegistered ? "text-success" : "text-warning"
                  }`}
                >
                  {pwaStatus.serviceWorkerRegistered ? "Supported" : "Not Found"}
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
          {/* Display Preferences Card */}
          <Card className="shadow-sm border-border/40">
            <CardHeader className="border-b border-border/40">
              <CardTitle>Display Preferences</CardTitle>
              <CardDescription>Customise the interface visual appearance</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col gap-4">
              <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-xl border border-border/20">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-foreground">Dark Theme Appearance</span>
                  <p className="text-xs text-muted-foreground">
                    Toggle the interface theme color between night and day modes.
                  </p>
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

          {/* Synchronized Notification Preferences Card (Phase 2) */}
          <Card className="shadow-sm border-border/40">
            <CardHeader className="border-b border-border/40">
              <CardTitle>Account Notifications</CardTitle>
              <CardDescription>
                Manage your two primary notification channels and PWA device push registration. Essential security messages cannot be disabled.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col gap-4">
              {/* 1. In-App Notifications */}
              <div className="flex items-center justify-between gap-4 p-4 bg-secondary/10 rounded-xl border border-border/20">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-foreground">In-App Notifications</span>
                  <p className="text-xs text-muted-foreground">
                    Display order, assignment, payment, contract, and writer application alerts in the Notification Centre.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleTogglePreference("inAppNotifications", !inAppNotifications)}
                  className={`w-12 h-6.5 shrink-0 rounded-full transition-all duration-300 relative flex items-center px-1 border border-border/30 cursor-pointer ${
                    inAppNotifications ? "bg-primary" : "bg-secondary-foreground/20"
                  }`}
                  aria-label="Toggle In-App Notifications"
                >
                  <div
                    className={`w-4.5 h-4.5 rounded-full bg-neutral-50 shadow-md transition-all duration-300 transform ${
                      inAppNotifications ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 2. Email Notifications */}
              <div className="flex flex-col gap-2 p-4 bg-secondary/10 rounded-xl border border-border/20">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold text-foreground">Email Notifications</span>
                    <p className="text-xs text-muted-foreground">
                      Receive non-essential transaction, assignment, and application updates at{" "}
                      <strong>{profile?.email}</strong>.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleTogglePreference("emailNotifications", !emailNotifications)}
                    className={`w-12 h-6.5 shrink-0 rounded-full transition-all duration-300 relative flex items-center px-1 border border-border/30 cursor-pointer ${
                      emailNotifications ? "bg-primary" : "bg-secondary-foreground/20"
                    }`}
                    aria-label="Toggle Email Notifications"
                  >
                    <div
                      className={`w-4.5 h-4.5 rounded-full bg-neutral-50 shadow-md transition-all duration-300 transform ${
                        emailNotifications ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {notifConfig && !notifConfig.emailDelivery.configured && (
                  <p className="text-[11px] text-muted-foreground bg-background/80 border border-border/30 rounded-lg px-3 py-2">
                    <strong>Provider Status:</strong> Preference saved. Outbound email delivery requires server configuration (<code>EMAIL_PROVIDER</code>, <code>RESEND_API_KEY</code> or <code>SENDGRID_API_KEY</code>, <code>EMAIL_FROM_ADDRESS</code>).
                  </p>
                )}
              </div>

              {/* 3. Mobile & Tablet Push Notifications */}
              <div className="flex flex-col gap-2 p-4 bg-secondary/10 rounded-xl border border-border/20">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-foreground">
                        Mobile, Tablet & Desktop Push Notifications
                      </span>
                      {notifConfig && notifConfig.pushDevices.count > 0 && (
                        <Badge variant="success" className="text-[10px]">
                          {notifConfig.pushDevices.count} device{notifConfig.pushDevices.count > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enable Progressive Web App push notifications via Firebase Cloud Messaging on supported devices.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={pushNotifications ? "outline" : "secondary"}
                    size="sm"
                    onClick={handlePushToggleClick}
                    isLoading={togglingPush}
                    disabled={
                      (!pushSupport.supported ||
                        notificationService.getPushReadinessState(pushNotifications).state ===
                          "configuration_missing") &&
                      !pushNotifications
                    }
                    className="shrink-0 text-xs font-bold"
                  >
                    {pushNotifications ? "Disable Push" : "Enable Push"}
                  </Button>
                </div>
                {(() => {
                  const readiness = notificationService.getPushReadinessState(pushNotifications);
                  const effectiveState = pushState || readiness.state;
                  if (effectiveState === "enabled") return null;
                  if (effectiveState === "unsupported") {
                    return (
                      <span className="text-[11px] text-muted-foreground">
                        ℹ️ Status: <strong>unsupported</strong> — {pushSupport.reason}
                      </span>
                    );
                  }
                  if (effectiveState === "configuration_missing") {
                    return (
                      <span className="text-[11px] text-muted-foreground">
                        ℹ️ Status: <strong>configuration_missing</strong> — {readiness.reason}
                      </span>
                    );
                  }
                  if (effectiveState === "permission_denied") {
                    return (
                      <span className="text-[11px] text-muted-foreground">
                        ℹ️ Status: <strong>permission_denied</strong> — Browser notification permission is denied. In-app notifications remain active.
                      </span>
                    );
                  }
                  if (effectiveState === "registration_failed") {
                    return (
                      <span className="text-[11px] text-muted-foreground">
                        ℹ️ Status: <strong>registration_failed</strong> — Device push registration could not be completed. In-app notifications remain active.
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Push Permission Explanation Modal */}
      <Modal
        isOpen={showPushExplainModal}
        onClose={() => setShowPushExplainModal(false)}
        title="Enable Push Notifications"
        size="sm"
        footerActions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowPushExplainModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirmEnablePush}>
              Continue & Request Permission
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-xs text-muted-foreground leading-relaxed">
          <p className="text-foreground font-semibold">
            Why DataBoy requests browser notification permission:
          </p>
          <ul className="list-disc pl-4 flex flex-col gap-1.5">
            <li>Receive instant alerts when assignments, drafts, or quotes are updated.</li>
            <li>Get immediate confirmation of escrow payments and payouts.</li>
            <li>Stay informed on writer application review decisions.</li>
          </ul>
          <p>
            You can disable push notifications and unregister this device at any time.
          </p>
        </div>
      </Modal>
    </div>
  );
}
