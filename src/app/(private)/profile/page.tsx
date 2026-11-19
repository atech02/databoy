"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { userService } from "@/services/userService";
import { notificationService, NotificationConfigStatus, PushRegistrationState } from "@/services/notificationService";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Loader } from "@/components/ui/Loader";
import { Modal } from "@/components/ui/Modal";
import {
  UNIVERSITIES,
  FACULTIES,
  MAJORS,
  YEARS_OF_STUDY,
} from "@/utils/lookups";

const PLACEHOLDER_VALUES = new Set(["confidential", "academic department", "n/a", "none", ""]);

function isCleanSavedValue(val?: string | null): boolean {
  if (!val || typeof val !== "string") return false;
  return !PLACEHOLDER_VALUES.has(val.trim().toLowerCase());
}

function getLookupLabel(list: Array<{ value: string; label: string }>, raw?: string | null): string {
  if (!isCleanSavedValue(raw)) return "";
  const trimmed = raw!.trim();
  const match = list.find((item) => item.value === trimmed || item.label.toLowerCase() === trimmed.toLowerCase());
  return match ? match.label : trimmed;
}

function getMajorLookupLabel(faculty?: string | null, major?: string | null): string {
  if (!isCleanSavedValue(major)) return "";
  const trimmed = major!.trim();
  if (faculty && MAJORS[faculty]) {
    const match = MAJORS[faculty].find(
      (m) => m.value === trimmed || m.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (match) return match.label;
  }
  for (const facList of Object.values(MAJORS)) {
    const match = facList.find((m) => m.value === trimmed || m.label.toLowerCase() === trimmed.toLowerCase());
    if (match) return match.label;
  }
  return trimmed;
}

export default function ProfilePage() {
  const { profile, refreshProfile, sendPasswordReset, loading } = useAuth();

  // Saved snapshot values from profile
  const savedDetails = useMemo(() => {
    const acad = profile?.academic;
    return {
      fullName: (profile?.displayName || "").trim(),
      phone: isCleanSavedValue(acad?.phone) ? acad!.phone.trim() : "",
      university: isCleanSavedValue(acad?.university) ? acad!.university.trim() : "",
      faculty: isCleanSavedValue(acad?.faculty) ? acad!.faculty.trim() : "",
      major: isCleanSavedValue(acad?.major) ? acad!.major.trim() : "",
      yearOfStudy: isCleanSavedValue(acad?.yearOfStudy) ? acad!.yearOfStudy.trim() : "",
    };
  }, [profile]);

  // Calculate actual saved profile completeness synchronized strictly with saved data
  const savedCompletionPercentage = useMemo(() => {
    let filled = 0;
    const total = 6;
    if (savedDetails.fullName) filled++;
    if (savedDetails.phone) filled++;
    if (savedDetails.university) filled++;
    if (savedDetails.faculty) filled++;
    if (savedDetails.major) filled++;
    if (savedDetails.yearOfStudy) filled++;
    return Math.round((filled / total) * 100);
  }, [savedDetails]);

  const isSavedProfileComplete = savedCompletionPercentage === 100;

  // View vs Edit mode state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [hasInitializedMode, setHasInitializedMode] = useState(false);

  // Editable form states
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [university, setUniversity] = useState("");
  const [faculty, setFaculty] = useState("");
  const [major, setMajor] = useState("");
  const [yearOfStudy, setYearOfStudy] = useState("");

  // Unsaved changes confirmation modal
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  // Notification preferences states (Phase 2)
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [notifConfig, setNotifConfig] = useState<NotificationConfigStatus | null>(null);
  const [showPushExplainModal, setShowPushExplainModal] = useState(false);
  const [togglingPush, setTogglingPush] = useState(false);
  const [pushState, setPushState] = useState<PushRegistrationState | null>(null);

  // Password reset confirmation dialog states (Phase 3)
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false);
  const [sendingResetEmail, setSendingResetEmail] = useState(false);
  const [passwordResetConfirmation, setPasswordResetConfirmation] = useState<string | null>(null);

  // Action loading & feedback banners
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Populate form state from saved profile
  const populateFormFromSaved = () => {
    setFullName(savedDetails.fullName);
    setPhone(savedDetails.phone);
    setUniversity(savedDetails.university);
    setFaculty(savedDetails.faculty);
    setMajor(savedDetails.major);
    setYearOfStudy(savedDetails.yearOfStudy);
  };

  useEffect(() => {
    if (profile) {
      if (!hasInitializedMode) {
        populateFormFromSaved();
        // Rule 1: When a user has not completed their profile, display the editable form.
        // Otherwise default to read-only view mode.
        setIsEditingProfile(!isSavedProfileComplete);
        setHasInitializedMode(true);
      } else if (!isEditingProfile) {
        populateFormFromSaved();
      }

      if (profile.preferences) {
        setInAppNotifications(profile.preferences.inAppNotifications !== false);
        setEmailNotifications(profile.preferences.emailNotifications !== false);
        setPushNotifications(profile.preferences.pushNotifications === true);
      }
    }
  }, [profile, isSavedProfileComplete, hasInitializedMode]);

  // Load backend notification config status (email provider check & push devices)
  const loadNotificationStatus = async () => {
    try {
      const status = await notificationService.getNotificationStatus();
      setNotifConfig(status);
      setInAppNotifications(status.preferences.inAppNotifications);
      setEmailNotifications(status.preferences.emailNotifications);
      setPushNotifications(status.preferences.pushNotifications);
    } catch {
      // Fallback to profile preferences if backend is unreachable in offline mode
    }
  };

  useEffect(() => {
    if (profile?.uid) {
      loadNotificationStatus();
    }
  }, [profile?.uid]);

  // Detect unsaved changes while in edit mode
  const isDirty = useMemo(() => {
    if (!isEditingProfile) return false;
    return (
      fullName.trim() !== savedDetails.fullName ||
      phone.trim() !== savedDetails.phone ||
      university !== savedDetails.university ||
      faculty !== savedDetails.faculty ||
      major !== savedDetails.major ||
      yearOfStudy !== savedDetails.yearOfStudy
    );
  }, [isEditingProfile, fullName, phone, university, faculty, major, yearOfStudy, savedDetails]);

  // Prevent accidental browser tab close / reload when unsaved changes exist (Rule 9)
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const activeMajors = useMemo(() => {
    const base = faculty ? MAJORS[faculty] || [] : [];
    if (major && !base.some((m) => m.value === major)) {
      return [...base, { value: major, label: getMajorLookupLabel(faculty, major) || major }];
    }
    return base;
  }, [faculty, major]);

  const universityOptions = useMemo(() => {
    const base = [{ value: "", label: "Select University / College" }, ...UNIVERSITIES];
    if (university && !base.some((u) => u.value === university)) {
      base.push({ value: university, label: university });
    }
    return base;
  }, [university]);

  const facultyOptions = useMemo(() => {
    const base = [{ value: "", label: "Select Faculty / Department" }, ...FACULTIES];
    if (faculty && !base.some((f) => f.value === faculty)) {
      base.push({ value: faculty, label: faculty });
    }
    return base;
  }, [faculty]);

  const majorOptions = useMemo(() => {
    return [{ value: "", label: faculty ? "Select Degree Major / Program" : "Select a Faculty First" }, ...activeMajors];
  }, [activeMajors, faculty]);

  const yearOptions = useMemo(() => {
    const base = [{ value: "", label: "Select Year of Study" }, ...YEARS_OF_STUDY];
    if (yearOfStudy && !base.some((y) => y.value === yearOfStudy)) {
      base.push({ value: yearOfStudy, label: yearOfStudy });
    }
    return base;
  }, [yearOfStudy]);

  const getApplicationStatusLabel = (status?: string) => {
    switch (status) {
      case "approved":
        return { label: "Approved", variant: "success" as const };
      case "under_review":
        return { label: "Under Review", variant: "info" as const };
      case "pending_review":
        return { label: "Pending Review", variant: "warning" as const };
      case "clarification_required":
        return { label: "Clarification Required", variant: "warning" as const };
      case "rejected":
        return { label: "Rejected", variant: "danger" as const };
      default:
        return { label: "Not Applied", variant: "secondary" as const };
    }
  };

  // Handler: Enter Edit Mode
  const handleStartEdit = () => {
    setError(null);
    setSuccess(null);
    populateFormFromSaved();
    setIsEditingProfile(true);
  };

  // Handler: Cancel Edit Mode (with unsaved-change protection)
  const handleCancelEdit = () => {
    if (isDirty) {
      setShowDiscardModal(true);
      return;
    }
    populateFormFromSaved();
    setError(null);
    setIsEditingProfile(false);
  };

  const confirmDiscardChanges = () => {
    setShowDiscardModal(false);
    populateFormFromSaved();
    setError(null);
    setIsEditingProfile(false);
  };

  // Handler: Save Personal & Academic Details
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    const cleanName = fullName.trim();
    const cleanPhone = phone.trim();

    if (cleanName.length < 2) {
      setError("Please enter your full name (at least 2 characters).");
      return;
    }
    if (cleanPhone.length < 7) {
      setError("Please provide a valid contact phone number.");
      return;
    }
    if (!university || !faculty || !major || !yearOfStudy) {
      setError("Please complete University, Faculty, Degree Major, and Year of Study.");
      return;
    }

    setSavingProfile(true);
    setError(null);
    setSuccess(null);

    try {
      let filled = 0;
      if (cleanName) filled++;
      if (cleanPhone) filled++;
      if (university) filled++;
      if (faculty) filled++;
      if (major) filled++;
      if (yearOfStudy) filled++;
      const newCompletion = Math.round((filled / 6) * 100);

      // Update only permitted personal & academic fields — never touch role, verificationStatus, or financial fields
      await userService.updateUserProfile(profile.uid, {
        displayName: cleanName,
        profileCompletion: newCompletion,
        isOnboarded: true,
        academic: {
          ...profile.academic,
          phone: cleanPhone,
          university,
          faculty,
          major,
          yearOfStudy,
        },
      });

      await refreshProfile();
      // Rule 2 & 7: After successful saving, automatically switch to read-only mode
      setIsEditingProfile(false);
      setSuccess("Your personal and academic profile details have been saved.");
    } catch (err: any) {
      // Rule 8: Retain user's input and display appropriate error
      setError(err?.message || "Failed to update profile details. Your changes have been retained so you can retry.");
    } finally {
      setSavingProfile(false);
    }
  };

  // Handler: Save Account Notification Preferences (Phase 2)
  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSavingPrefs(true);
    setError(null);
    setSuccess(null);

    try {
      try {
        await notificationService.updatePreferences({
          inAppNotifications,
          emailNotifications,
          pushNotifications,
        });
      } catch {
        // Fallback direct profile preference update if backend API is offline
        await userService.updateUserProfile(profile.uid, {
          preferences: {
            ...profile.preferences,
            notifications: {
              inApp: inAppNotifications,
              email: emailNotifications,
              push: pushNotifications,
            },
            inAppNotifications,
            emailNotifications,
            pushNotifications,
          },
        });
      }
      await refreshProfile();
      await loadNotificationStatus();
      setSuccess("Your notification preferences have been saved.");
    } catch (err: any) {
      setError(err?.message || "Failed to save notification preferences.");
    } finally {
      setSavingPrefs(false);
    }
  };

  // Handler: Toggle Push Notifications (Phase 2C)
  const handlePushToggleClick = async () => {
    setError(null);
    setSuccess(null);

    if (pushNotifications) {
      // Disabling push notifications and unregistering device
      setTogglingPush(true);
      try {
        await notificationService.disablePushNotifications(false);
        setPushNotifications(false);
        await refreshProfile();
        await loadNotificationStatus();
        setSuccess("Push notifications have been disabled for this device.");
      } catch (err: any) {
        setError(err?.message || "Failed to unregister push notifications.");
      } finally {
        setTogglingPush(false);
      }
    } else {
      // Explain why permission is required BEFORE requesting browser permission
      setShowPushExplainModal(true);
    }
  };

  const handleConfirmEnablePush = async () => {
    setShowPushExplainModal(false);
    setTogglingPush(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await notificationService.enablePushNotifications();
      setPushState(result.state);
      if (!result.success || result.state !== "enabled") {
        setError(result.error || "Could not enable push notifications on this device.");
        setPushNotifications(false);
      } else {
        setPushNotifications(true);
        await refreshProfile();
        await loadNotificationStatus();
        setSuccess("Push notifications enabled and this device has been registered.");
      }
    } catch (err: any) {
      setPushState("registration_failed");
      setPushNotifications(false);
      setError(err?.message || "Failed to enable push notifications.");
    } finally {
      setTogglingPush(false);
    }
  };

  // Handler: Confirm Password Reset Email (Phase 3)
  const handleConfirmPasswordReset = async () => {
    if (!profile?.email) return;
    setSendingResetEmail(true);
    setError(null);
    setSuccess(null);
    setPasswordResetConfirmation(null);

    try {
      await sendPasswordReset(profile.email);
      setShowPasswordResetModal(false);
      setPasswordResetConfirmation(
        "If an account is registered with your email address, a secure password-reset link has been sent. Please check your inbox and spam folder."
      );
    } catch (err: any) {
      setShowPasswordResetModal(false);
      setError(err?.message || "Could not initiate password reset at this time. Please try again later.");
    } finally {
      setSendingResetEmail(false);
    }
  };

  // Express writer interest for customers who did not select it during registration
  const [expressingInterest, setExpressingInterest] = useState(false);

  const handleExpressWriterInterest = async () => {
    if (!profile) return;
    setExpressingInterest(true);
    setError(null);
    setSuccess(null);
    try {
      await userService.updateUserProfile(profile.uid, {
        writerInterest: true,
      });
      await refreshProfile();
      setSuccess("Writer interest recorded! You can now complete your writer application in the Verification Centre.");
    } catch (err: any) {
      setError(err?.message || "Failed to record writer interest.");
    } finally {
      setExpressingInterest(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader size="lg" />
      </div>
    );
  }

  const isApprovedWriter =
    (profile.role === "writer" || profile.role === "proofreader") &&
    profile.status === "active" &&
    profile.verificationStatus === "approved" &&
    profile.isVerifiedWriter === true &&
    (profile.role === "proofreader" || profile.writerStatus === "active");
  const isAdmin = profile.role === "admin";
  const hasAppliedWriter =
    profile.verificationStatus &&
    ["pending_review", "under_review", "clarification_required", "approved", "rejected"].includes(
      profile.verificationStatus
    );
  const showWriterApplicationCard =
    !isAdmin && !isApprovedWriter && (profile.writerInterest === true || hasAppliedWriter || profile.role === "writer");
  const showExpressWriterInterestCard = !isAdmin && !isApprovedWriter && !showWriterApplicationCard;

  const appStatusBadge = getApplicationStatusLabel(
    hasAppliedWriter ? profile.verificationStatus : "not_applied"
  );
  const pushSupport = notificationService.isBrowserPushSupported();

  const resolvedSummaryFields = [
    { label: "Full Name", value: savedDetails.fullName },
    { label: "Contact Phone", value: savedDetails.phone },
    { label: "University / College", value: getLookupLabel(UNIVERSITIES, savedDetails.university) },
    { label: "Faculty / Department", value: getLookupLabel(FACULTIES, savedDetails.faculty) },
    { label: "Degree Major / Program", value: getMajorLookupLabel(savedDetails.faculty, savedDetails.major) },
    {
      label: isApprovedWriter ? "Graduation / Study Year" : "Year of Study",
      value: getLookupLabel(YEARS_OF_STUDY, savedDetails.yearOfStudy),
    },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-10">
      {/* Top Navigation Row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
        <div className="flex items-center gap-2">
          <Link href="/settings">
            <Button variant="outline" size="sm" className="text-xs font-semibold">
              Display & PWA Settings
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Action Could Not Be Completed">
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" title="Changes Saved">
          {success}
        </Alert>
      )}
      {passwordResetConfirmation && (
        <Alert variant="info" title="Password Reset Email Dispatched">
          {passwordResetConfirmation}
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Account Identity & Synchronized Completeness */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <Card className="border-border/40 bg-card shadow-sm">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-4">
              <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-3xl select-none font-black text-primary">
                {(savedDetails.fullName || profile.email || "D").charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-bold text-foreground tracking-tight">
                  {savedDetails.fullName || "DataBoy Member"}
                </h1>
                <span className="text-xs text-muted-foreground font-medium break-all">{profile.email}</span>
              </div>

              <div className="flex flex-wrap gap-2 justify-center mt-1">
                <Badge variant="primary" className="uppercase font-mono text-[10px]">
                  {isApprovedWriter ? "Verified Writer" : profile.role === "admin" ? "Administrator" : "Customer"}
                </Badge>
                {hasAppliedWriter && (
                  <Badge variant={appStatusBadge.variant} className="uppercase font-mono text-[10px]">
                    {appStatusBadge.label}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Synchronized Profile Completeness Card */}
          <Card className="border-border/40 bg-card shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Profile Completeness
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex justify-between items-center text-sm font-bold">
                <span className="text-foreground">Saved Profile Data</span>
                <span className={savedCompletionPercentage === 100 ? "text-success" : "text-primary"}>
                  {savedCompletionPercentage}%
                </span>
              </div>
              <div className="w-full h-2.5 bg-secondary/80 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    savedCompletionPercentage === 100 ? "bg-success" : "bg-primary"
                  }`}
                  style={{ width: `${savedCompletionPercentage}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {savedCompletionPercentage === 100
                  ? "Your personal and academic profile is complete and synchronized."
                  : "Complete all 6 personal and academic fields so assignments and applications match accurately."}
              </p>
            </CardContent>
          </Card>

          {/* Phase 4: Writer Application Entry Point for Eligible Customers */}
          {showWriterApplicationCard && (
            <Card className="border-primary/30 bg-primary/5 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-extrabold uppercase tracking-wider text-foreground">
                    Writer Application
                  </CardTitle>
                  <Badge variant={appStatusBadge.variant} className="uppercase font-mono text-[10px]">
                    {appStatusBadge.label}
                  </Badge>
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  {!hasAppliedWriter
                    ? "You expressed interest in becoming a DataBoy academic writer."
                    : "Track your writer application and credential vetting status."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-2">
                {!hasAppliedWriter ? (
                  <>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Submit your degree qualifications, academic transcript, and subject competencies for administrative review.
                    </p>
                    <Link href="/verification" className="w-full">
                      <Button variant="primary" size="sm" className="w-full font-bold text-xs">
                        Apply to Become a Writer &rarr;
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {profile.verificationStatus === "pending_review" &&
                        "Your application has been submitted and is awaiting administrative review."}
                      {profile.verificationStatus === "under_review" &&
                        "An administrator is currently reviewing your academic credentials and supporting documents."}
                      {profile.verificationStatus === "clarification_required" &&
                        `Clarification requested: "${profile.rejectionReason || "Please review your uploaded documents."}"`}
                      {profile.verificationStatus === "rejected" &&
                        `Application not approved: "${profile.rejectionReason || "Credentials did not meet requirements."}"`}
                    </p>
                    <Link href="/verification" className="w-full">
                      <Button variant="outline" size="sm" className="w-full font-bold text-xs">
                        {profile.verificationStatus === "clarification_required" ||
                        profile.verificationStatus === "rejected"
                          ? "Update & Resubmit Application"
                          : "View Application Status"}
                      </Button>
                    </Link>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Phase 4: Option to Express Writer Interest for customers without writerInterest */}
          {showExpressWriterInterestCard && (
            <Card className="border-border/40 bg-card shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-extrabold uppercase tracking-wider text-foreground">
                  Become a DataBoy Writer
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Interested in writing academic assignments or proofreading on DataBoy?
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Express your interest to unlock the writer application form. All applications require administrative credential verification.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExpressWriterInterest}
                  isLoading={expressingInterest}
                  className="w-full font-bold text-xs"
                >
                  Express Interest in Becoming a Writer
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Approved Writer Verification Summary */}
          {isApprovedWriter && (
            <Card className="border-success/30 bg-success/5 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-extrabold uppercase tracking-wider text-foreground">
                    Writer Credentials
                  </CardTitle>
                  <Badge variant="success" className="uppercase font-mono text-[10px]">
                    Approved
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-1">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your academic writer credentials are verified and active. You have full access to the Writer Dashboard.
                </p>
                <div className="flex gap-2">
                  <Link href="/dashboard" className="flex-1">
                    <Button variant="primary" size="sm" className="w-full text-xs font-bold">
                      Writer Dashboard
                    </Button>
                  </Link>
                  <Link href="/verification">
                    <Button variant="outline" size="sm" className="text-xs font-semibold">
                      Credentials
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Phase 1 (Profile View/Edit), Phase 2 (Notifications), Phase 3 (Password Reset) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* PHASE 1: PERSONAL & ACADEMIC DETAILS (VIEW MODE & EDIT MODE) */}
          <Card className="shadow-sm border-border/40 bg-card transition-all duration-200">
            <CardHeader className="border-b border-border/40 flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">
                  Personal & Academic Details
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  {isEditingProfile
                    ? "Complete your personal and university program details below."
                    : "Your saved academic and contact information."}
                </CardDescription>
              </div>
              {!isEditingProfile && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartEdit}
                  className="shrink-0 text-xs font-bold"
                >
                  Edit Profile
                </Button>
              )}
            </CardHeader>

            <CardContent className="pt-6">
              {!isEditingProfile ? (
                /* READ-ONLY SUMMARY VIEW MODE */
                <div className="flex flex-col gap-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {resolvedSummaryFields.map((item) => (
                      <div
                        key={item.label}
                        className="p-3.5 rounded-xl border border-border/30 bg-secondary/15 flex flex-col gap-1"
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground font-mono">
                          {item.label}
                        </span>
                        {item.value ? (
                          <span className="text-sm font-semibold text-foreground break-words">
                            {item.value}
                          </span>
                        ) : (
                          <span className="text-xs italic text-muted-foreground/70">
                            Not provided yet
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border/20 text-xs text-muted-foreground">
                    <span>
                      Profile completeness: <strong className="text-foreground">{savedCompletionPercentage}%</strong>
                    </span>
                    <Button variant="outline" size="sm" onClick={handleStartEdit} className="text-xs font-bold">
                      Edit Profile
                    </Button>
                  </div>
                </div>
              ) : (
                /* EDITABLE FORM MODE */
                <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="Full Name"
                      type="text"
                      placeholder="e.g. Chanda Mwale"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />

                    <Input
                      label="Contact Phone"
                      type="tel"
                      placeholder="+260 97X XXX XXX"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="University / College"
                      options={universityOptions}
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                      required
                    />

                    <Select
                      label="Faculty / Department"
                      options={facultyOptions}
                      value={faculty}
                      onChange={(e) => {
                        const nextFac = e.target.value;
                        setFaculty(nextFac);
                        if (nextFac && MAJORS[nextFac] && !MAJORS[nextFac].some((m) => m.value === major)) {
                          setMajor("");
                        }
                      }}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="Degree Major / Program"
                      options={majorOptions}
                      value={major}
                      onChange={(e) => setMajor(e.target.value)}
                      required
                      disabled={!faculty}
                    />

                    <Select
                      label={isApprovedWriter ? "Graduation / Study Year" : "Year of Study"}
                      options={yearOptions}
                      value={yearOfStudy}
                      onChange={(e) => setYearOfStudy(e.target.value)}
                      required
                    />
                  </div>

                  <div className="pt-4 border-t border-border/20 flex items-center justify-end gap-3">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={handleCancelEdit}
                      disabled={savingProfile}
                    >
                      Cancel
                    </Button>
                    <Button variant="primary" type="submit" isLoading={savingProfile}>
                      Save Changes
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          {/* PHASE 2: ACCOUNT NOTIFICATIONS (IN-APP, EMAIL, AND PWA PUSH) */}
          <Card className="shadow-sm border-border/40 bg-card">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">
                Account Notifications
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Configure how you receive order updates, assignment milestones, payment confirmations, and application alerts. Essential security messages cannot be disabled.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleSavePreferences} className="flex flex-col gap-4">
                {/* 1. Primary Preference A: In-App Notifications */}
                <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border/30 bg-secondary/10">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold text-foreground">In-App Notifications</span>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Receive real-time alerts in the navigation Notification Centre for payment confirmations, assignment updates, draft submissions, writer application reviews, contract milestones, and announcements.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={inAppNotifications}
                    aria-label="Toggle In-App Notifications"
                    onClick={() => setInAppNotifications((v) => !v)}
                    className={`w-12 h-6.5 shrink-0 rounded-full transition-all duration-200 relative flex items-center px-1 border border-border/40 cursor-pointer ${
                      inAppNotifications ? "bg-primary" : "bg-secondary-foreground/20"
                    }`}
                  >
                    <span
                      className={`w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${
                        inAppNotifications ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* 2. Primary Preference B: Email Notifications */}
                <div className="flex flex-col gap-2.5 p-4 rounded-xl border border-border/30 bg-secondary/10">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-bold text-foreground">Email Notifications</span>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Send non-essential transaction, order, assignment, and writer application updates to your registered email address (<strong>{profile.email}</strong>).
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={emailNotifications}
                      aria-label="Toggle Email Notifications"
                      onClick={() => setEmailNotifications((v) => !v)}
                      className={`w-12 h-6.5 shrink-0 rounded-full transition-all duration-200 relative flex items-center px-1 border border-border/40 cursor-pointer ${
                        emailNotifications ? "bg-primary" : "bg-secondary-foreground/20"
                      }`}
                    >
                      <span
                        className={`w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${
                          emailNotifications ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {notifConfig && !notifConfig.emailDelivery.configured && (
                    <div className="text-[11px] text-muted-foreground bg-background/80 border border-border/40 rounded-lg px-3 py-2">
                      <strong>Delivery Status:</strong> Your preference is saved. Outbound transactional email dispatch is currently awaiting server email provider configuration (<code>EMAIL_PROVIDER</code> / <code>RESEND_API_KEY</code> or <code>SENDGRID_API_KEY</code>). Firebase Authentication security emails remain active.
                    </div>
                  )}
                </div>

                {/* 3. Mobile, Tablet & Desktop PWA Push Notifications */}
                <div className="flex flex-col gap-2.5 p-4 rounded-xl border border-border/30 bg-secondary/10">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">
                          Mobile, Tablet & Desktop Push Notifications
                        </span>
                        {notifConfig && notifConfig.pushDevices.count > 0 && (
                          <Badge variant="success" className="text-[10px]">
                            {notifConfig.pushDevices.count} device{notifConfig.pushDevices.count > 1 ? "s" : ""} active
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Receive instant PWA push alerts on compatible Android phones, tablets, and desktop browsers even when DataBoy is in the background.
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

                <div className="pt-2 flex justify-end">
                  <Button variant="primary" type="submit" isLoading={savingPrefs}>
                    Save Notification Preferences
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* PHASE 3: SECURE PASSWORD RESET */}
          <Card className="shadow-sm border-border/40 bg-card">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">
                Password & Account Security
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Manage your authentication credentials through verified email password reset.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-foreground">Account Password</span>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-lg">
                  To protect your account, password changes are verified via a one-time reset link sent to your registered email address (<strong>{profile.email}</strong>).
                </p>
              </div>
              <Button
                variant="outline"
                type="button"
                onClick={() => setShowPasswordResetModal(true)}
                className="shrink-0 font-bold text-xs"
              >
                Change Password
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal 1: Discard Unsaved Profile Changes Confirmation */}
      <Modal
        isOpen={showDiscardModal}
        onClose={() => setShowDiscardModal(false)}
        title="Discard Unsaved Changes?"
        size="sm"
        footerActions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowDiscardModal(false)}>
              Keep Editing
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDiscardChanges}>
              Discard Changes
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground leading-relaxed">
          You have unsaved edits in your Personal & Academic Details form. If you cancel now, your unsaved changes will be lost.
        </p>
      </Modal>

      {/* Modal 2: Push Notification Permission Explanation Dialog (Phase 2C) */}
      <Modal
        isOpen={showPushExplainModal}
        onClose={() => setShowPushExplainModal(false)}
        title="Enable Push Notifications"
        size="sm"
        footerActions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowPushExplainModal(false)}>
              Not Now
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirmEnablePush}>
              Continue & Allow
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-xs text-muted-foreground leading-relaxed">
          <p className="text-foreground font-semibold">
            Why DataBoy requests notification permission:
          </p>
          <ul className="list-disc pl-4 flex flex-col gap-1.5">
            <li>Deliver instant alerts when an assignment or research milestone is updated.</li>
            <li>Notify you immediately when escrow payments or payouts are confirmed.</li>
            <li>Alert you when your writer application or deliverable review is completed.</li>
          </ul>
          <p>
            You can disable push notifications and unregister this device at any time from your Profile or Settings page.
          </p>
        </div>
      </Modal>

      {/* Modal 3: Secure Password Reset Confirmation Dialog (Phase 3) */}
      <Modal
        isOpen={showPasswordResetModal}
        onClose={() => !sendingResetEmail && setShowPasswordResetModal(false)}
        title="Send Password Reset Link"
        size="sm"
        footerActions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPasswordResetModal(false)}
              disabled={sendingResetEmail}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmPasswordReset}
              isLoading={sendingResetEmail}
            >
              Send Reset Link
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-xs text-muted-foreground leading-relaxed">
          <p>
            We will send a secure password-reset email to your registered address:
          </p>
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/40 font-mono font-bold text-foreground text-center">
            {profile.email}
          </div>
          <p>
            Click the link in that email to open the DataBoy password-reset page and choose a new password.
          </p>
        </div>
      </Modal>
    </div>
  );
}
