"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { userService } from "@/services/userService";
import { storageService } from "@/services/storageService";
import { auditService } from "@/services/auditService";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Loader } from "@/components/ui/Loader";
import { 
  UNIVERSITIES, 
  FACULTIES, 
  MAJORS, 
  YEARS_OF_STUDY, 
  SUBJECT_EXPERTISE 
} from "@/utils/lookups";

export default function ProfilePage() {
  const { profile, refreshProfile, loading } = useAuth();
  
  // Profile details states
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [university, setUniversity] = useState("");
  const [faculty, setFaculty] = useState("");
  const [major, setMajor] = useState("");
  const [yearOfStudy, setYearOfStudy] = useState("");
  
  // Expert Bio & Specializations
  const [bio, setBio] = useState("");
  const [selectedSpecs, setSelectedSpecs] = useState<string[]>([]);

  // Preferences states
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);

  // Security states
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Writer document upload states
  const [degreeUrl, setDegreeUrl] = useState("");
  const [transcriptUrl, setTranscriptUrl] = useState("");
  const [degreeProgress, setDegreeProgress] = useState<number | null>(null);
  const [transcriptProgress, setTranscriptProgress] = useState<number | null>(null);

  // Status/Alert states
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [savingVerification, setSavingVerification] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.displayName || "");
      if (profile.academic) {
        setPhone(profile.academic.phone || "");
        setUniversity(profile.academic.university || "");
        setFaculty(profile.academic.faculty || "");
        setMajor(profile.academic.major || "");
        setYearOfStudy(profile.academic.yearOfStudy || "");
        setBio(profile.academic.bio || "");
        setSelectedSpecs(profile.academic.specializations || []);
        
        if (profile.academic.documents) {
          setDegreeUrl(profile.academic.documents.degreeCertificateUrl || "");
          setTranscriptUrl(profile.academic.documents.transcriptUrl || "");
        }
      }

      if (profile.preferences) {
        setEmailNotifications(profile.preferences.emailNotifications !== false);
        setSmsNotifications(profile.preferences.smsNotifications === true);
      }
    }
  }, [profile]);

  const activeMajors = faculty ? MAJORS[faculty] || [] : [];

  const getVerificationBadge = (status?: string) => {
    switch (status) {
      case "approved":
        return <Badge variant="success" className="uppercase font-mono text-[10px]">Approved</Badge>;
      case "pending_review":
        return <Badge variant="warning" className="uppercase font-mono text-[10px]">Pending Review</Badge>;
      case "clarification_required":
        return <Badge variant="info" className="uppercase font-mono text-[10px]">Clarification Required</Badge>;
      case "rejected":
        return <Badge variant="danger" className="uppercase font-mono text-[10px]">Rejected</Badge>;
      default:
        return <Badge variant="secondary" className="uppercase font-mono text-[10px]">{status || "draft"}</Badge>;
    }
  };

  const handleSpecToggle = (specValue: string) => {
    if (selectedSpecs.includes(specValue)) {
      setSelectedSpecs(selectedSpecs.filter(s => s !== specValue));
    } else {
      setSelectedSpecs([...selectedSpecs, specValue]);
    }
  };

  const calculateCompletion = (): number => {
    let filled = 0;
    let total = 0;

    filled += fullName ? 1 : 0;
    filled += phone ? 1 : 0;
    filled += university ? 1 : 0;
    filled += faculty ? 1 : 0;
    filled += major ? 1 : 0;
    filled += yearOfStudy ? 1 : 0;
    total += 6;

    if (profile?.role === "writer" || profile?.role === "proofreader") {
      filled += bio ? 1 : 0;
      filled += selectedSpecs.length > 0 ? 1 : 0;
      filled += degreeUrl ? 1 : 0;
      filled += transcriptUrl ? 1 : 0;
      total += 4;
    }

    return Math.round((filled / total) * 100);
  };

  // Handler: Save Personal & Academic Details
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSavingProfile(true);
    setError(null);
    setSuccess(null);

    try {
      const currentCompletion = calculateCompletion();
      const updateData: any = {
        displayName: fullName,
        profileCompletion: currentCompletion,
        academic: {
          ...profile.academic,
          phone,
          university,
          faculty,
          major,
          yearOfStudy
        }
      };

      await userService.updateUserProfile(profile.uid, updateData);
      await refreshProfile();
      setSuccess("Your personal and academic details have been successfully updated!");
    } catch (err: any) {
      setError(err?.message || "Failed to update profile details.");
    } finally {
      setSavingProfile(false);
    }
  };

  // Handler: Save Account Preferences
  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSavingPrefs(true);
    setError(null);
    setSuccess(null);

    try {
      await userService.updateUserProfile(profile.uid, {
        preferences: {
          emailNotifications,
          smsNotifications
        }
      });
      await refreshProfile();
      setSuccess("Account preferences saved successfully.");
    } catch (err: any) {
      setError(err?.message || "Failed to save preferences.");
    } finally {
      setSavingPrefs(false);
    }
  };

  // Handler: Update Security Password
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (!newPassword || newPassword !== confirmPassword) {
      setError("New passwords do not match or are empty.");
      return;
    }

    setSavingSecurity(true);
    setError(null);
    setSuccess(null);

    try {
      const { getAuth, updatePassword } = await import("firebase/auth");
      const auth = getAuth();
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        setSuccess("Your login password has been changed successfully!");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        throw new Error("No active authenticated session found.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update password. You may need to re-authenticate first.");
    } finally {
      setSavingSecurity(false);
    }
  };

  // Handler: Upload Verification files
  const handleUploadDocument = async (
    docType: "degree_certificate" | "transcript",
    file: File
  ) => {
    if (!profile) return;
    setError(null);
    try {
      if (docType === "degree_certificate") {
        setDegreeProgress(0);
        const url = await storageService.uploadVerificationDocument(profile.uid, docType, file, setDegreeProgress);
        setDegreeUrl(url);
      } else if (docType === "transcript") {
        setTranscriptProgress(0);
        const url = await storageService.uploadVerificationDocument(profile.uid, docType, file, setTranscriptProgress);
        setTranscriptUrl(url);
      }
    } catch (err: any) {
      console.error(err);
      setError(`Upload failed for ${docType.replace("_", " ")}: ${err?.message}`);
    }
  };

  // Handler: Save Verification Bio & Specializations / Submit verification
  const handleSaveVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSavingVerification(true);
    setError(null);
    setSuccess(null);

    try {
      const documents = {
        degreeCertificateUrl: degreeUrl,
        transcriptUrl: transcriptUrl
      };

      const nextStatus = (degreeUrl && transcriptUrl) ? "pending_review" : (profile.verificationStatus || "draft");

      await userService.updateUserProfile(profile.uid, {
        verificationStatus: nextStatus,
        academic: {
          ...profile.academic!,
          bio,
          specializations: selectedSpecs,
          documents
        }
      });

      await refreshProfile();

      if (nextStatus === "pending_review") {
        await auditService.logActivity("SYSTEM", {
          type: "system_alert",
          actorId: profile.uid,
          actorName: profile.displayName,
          actorRole: profile.role,
          message: `Writer/Proofreader [${profile.displayName}] submitted credentials via Profile verification module.`
        });
        setSuccess("Academic credentials and specialties submitted for review successfully!");
      } else {
        setSuccess("Academic bio and competencies updated successfully.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update verification details.");
    } finally {
      setSavingVerification(false);
    }
  };

  const handleResetRejection = async () => {
    if (!profile) return;
    setSavingVerification(true);
    try {
      await userService.updateUserProfile(profile.uid, {
        verificationStatus: "draft"
      });
      await refreshProfile();
    } catch (err: any) {
      setError(err?.message || "Failed to reset verification queue.");
    } finally {
      setSavingVerification(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader size="lg" />
      </div>
    );
  }

  const isExpert = profile.role === "writer" || profile.role === "proofreader";
  const completionPercentage = calculateCompletion();

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      
      {/* Back Button */}
      <div className="flex items-center">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
      </div>

      {error && (
        <Alert variant="error" title="Validation Error">
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" title="Success">
          {success}
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left Card: Progress Summary */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <Card className="border-border/40 bg-card">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-4">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-4xl select-none font-bold text-primary">
                {fullName.charAt(0).toUpperCase() || "D"}
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-bold text-foreground tracking-tight">{fullName}</h2>
                <span className="text-xs text-muted-foreground font-medium">{profile.email}</span>
              </div>
              
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                <Badge variant="primary" className="uppercase font-mono text-[10px]">
                  {profile.role === "customer" ? "student" : profile.role}
                </Badge>
                {isExpert && getVerificationBadge(profile.verificationStatus)}
              </div>
            </CardContent>
          </Card>

          {/* Profile Completion Meter (Centralized here, Revision 9) */}
          <Card className="border-border/40 bg-card">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Profile Completeness</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex justify-between items-center text-sm font-bold text-primary">
                <span>Completed</span>
                <span>{completionPercentage}%</span>
              </div>
              <div className="w-full h-2.5 bg-secondary/80 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-500" 
                  style={{ width: `${completionPercentage}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed font-semibold">
                Provide academic credentials and profile information to raise matching precision in the escrow engine.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Section: Structured forms details (Revision 5) */}
        <div className="md:col-span-2 flex flex-col gap-6">
          
          {/* Section 1 & 2: Personal & Academic Details */}
          <Card className="shadow-md border-border/40 bg-card">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">Personal & Academic Details</CardTitle>
              <CardDescription className="text-xs text-muted-foreground font-semibold">Update your university settings and degree program information.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Full Name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />

                  <Input
                    label="Contact Phone"
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="University / College"
                    options={UNIVERSITIES}
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    required
                  />

                  <Select
                    label="Faculty / Department"
                    options={FACULTIES}
                    value={faculty}
                    onChange={(e) => setFaculty(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Degree Major / Program"
                    options={activeMajors}
                    value={major}
                    onChange={(e) => setMajor(e.target.value)}
                    required
                    disabled={!faculty}
                  />

                  <Select
                    label={isExpert ? "Graduation Year" : "Year of Study"}
                    options={YEARS_OF_STUDY}
                    value={yearOfStudy}
                    onChange={(e) => setYearOfStudy(e.target.value)}
                    required
                  />
                </div>

                <div className="pt-3 border-t border-border/20 flex justify-end">
                  <Button variant="primary" type="submit" isLoading={savingProfile}>
                    Save Details
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Section 3: Account Preferences */}
          <Card className="shadow-md border-border/40 bg-card">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">Account Preferences</CardTitle>
              <CardDescription className="text-xs text-muted-foreground font-semibold">Manage system-generated notifications and email triggers.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleSavePreferences} className="flex flex-col gap-4">
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={emailNotifications}
                      onChange={(e) => setEmailNotifications(e.target.checked)}
                      className="w-4 h-4 rounded text-primary focus:ring-primary border-border"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-foreground">Email Notifications</span>
                      <span className="text-[11px] text-muted-foreground">Receive milestone progress, review outcomes, and contract alerts.</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer select-none border-t border-border/10 pt-3">
                    <input 
                      type="checkbox" 
                      checked={smsNotifications}
                      onChange={(e) => setSmsNotifications(e.target.checked)}
                      className="w-4 h-4 rounded text-primary focus:ring-primary border-border"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-foreground">SMS Transaction Notifications</span>
                      <span className="text-[11px] text-muted-foreground">Get instant mobile text triggers on escrow fundings and payouts.</span>
                    </div>
                  </label>
                </div>

                <div className="pt-3 border-t border-border/20 flex justify-end">
                  <Button variant="primary" type="submit" isLoading={savingPrefs}>
                    Save Preferences
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Section 4: Security */}
          <Card className="shadow-md border-border/40 bg-card">
            <CardHeader className="border-b border-border/40">
              <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">Password & Account Security</CardTitle>
              <CardDescription className="text-xs text-muted-foreground font-semibold">Change your account password securely.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="New Password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />

                  <Input
                    label="Confirm New Password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="pt-3 border-t border-border/20 flex justify-end">
                  <Button variant="primary" type="submit" isLoading={savingSecurity}>
                    Update Password
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Section 5: Writer Verification (Writers only) */}
          {isExpert && (
            <Card className="shadow-md border-border/40 bg-card">
              <CardHeader className="border-b border-border/40">
                <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">Academic Verification & Vetting</CardTitle>
                <CardDescription className="text-xs text-muted-foreground font-semibold">Verify your academic degree certificates, transcripts, and select expertise competencies.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block font-mono">Current Verification Status</span>
                  <div className="flex items-center gap-3">
                    {getVerificationBadge(profile.verificationStatus)}
                    <span className="text-xs font-semibold text-muted-foreground font-medium">
                      {profile.verificationStatus === "approved"
                        ? "✓ Verified member. Assignment pool claim privileges unlocked."
                        : profile.verificationStatus === "pending_review"
                        ? "⏳ Credentials review is currently pending administrative vetting."
                        : profile.verificationStatus === "clarification_required"
                        ? "⚠️ Action Required: Clarification is requested by administrators."
                        : profile.verificationStatus === "rejected"
                        ? "❌ Rejected: Credentials do not meet DataBoy quality requirements."
                        : "⏳ Setup required: Please submit credentials to enter assignment pool."}
                    </span>
                  </div>
                </div>

                <div className="border-t border-border/10 pt-4 flex flex-col gap-4 font-semibold text-xs">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    DataBoy operates a high-fidelity trust and quality-control environment. Writers must submit verified academic transcript scans, degree certificates, CV files, and select subject competencies inside the dedicated Verification Centre workspace.
                  </p>
                  <Link href="/verification" className="w-fit">
                    <Button variant="primary" size="sm" className="font-bold uppercase tracking-wider text-xs">
                      Open Verification Centre
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

        </div>

      </div>

    </div>
  );
}
