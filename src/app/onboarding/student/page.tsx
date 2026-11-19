"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Loader } from "@/components/ui/Loader";
import { userService } from "@/services/userService";
import { auditService } from "@/services/auditService";
import { useTheme } from "@/hooks/useTheme";

export default function StudentOnboarding() {
  const { user, profile, loading, refreshProfile, logout } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();

  // Onboarding States
  const [educationLevel, setEducationLevel] = useState("");
  const [programOfStudy, setProgramOfStudy] = useState("");
  
  // UI states
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace("/");
        return;
      }
      if (profile) {
        if (profile.writerInterest && !profile.isOnboarded) {
          router.replace("/onboarding/writer");
          return;
        }
        // Redirect non-student profiles
        if (profile.role !== "customer") {
          router.replace(profile.role === "writer" ? "/onboarding/writer" : "/dashboard");
          return;
        }
        // If already onboarded, redirect to dashboard
        if (profile.isOnboarded) {
          router.replace("/dashboard");
        }
      }
    }
  }, [profile, router, loading, user]);

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B0F19]">
        <Loader size="lg" />
        <span className="text-sm font-semibold tracking-wider text-muted-foreground mt-4 uppercase animate-pulse">
          Loading Setup...
        </span>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!educationLevel) {
      setError("Please select your current education level.");
      return;
    }
    if (!programOfStudy) {
      setError("Please select your program of study.");
      return;
    }

    setSaving(true);
    try {
      // Setup the normalized student details
      const academicDetails = {
        phone: "",
        university: "Confidential", // Private placeholder for compatibility
        faculty: "Academic Department", // Private placeholder for compatibility
        major: programOfStudy,       // Program of Study
        yearOfStudy: educationLevel  // Education Level
      };

      await userService.updateUserProfile(profile.uid, {
        isOnboarded: true,
        profileCompletion: 100,
        academic: academicDetails
      });

      await refreshProfile();
      await auditService.logActivity("SYSTEM", {
        type: "system_alert",
        actorId: profile.uid,
        actorName: profile.displayName || "Student",
        actorRole: "customer",
        message: `Student [${profile.displayName}] completed profile onboarding.`
      });

      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message || "Failed to finalize profile setup.");
    } finally {
      setSaving(false);
    }
  };

  const educationOptions = [
    { value: "", label: "Select Education Level" },
    { value: "Diploma Student", label: "Diploma Student" },
    { value: "Degree Student", label: "Degree Student" },
    { value: "Master's Student", label: "Master's Student" },
    { value: "PhD Candidate", label: "PhD Candidate" }
  ];

  const programOptions = [
    { value: "", label: "Select Program of Study" },
    { value: "Computer Science", label: "Computer Science" },
    { value: "Law", label: "Law" },
    { value: "Accounting", label: "Accounting" },
    { value: "Economics", label: "Economics" },
    { value: "Education", label: "Education" },
    { value: "Engineering", label: "Engineering" },
    { value: "Medicine", label: "Medicine" },
    { value: "Business Administration", label: "Business Administration" },
    { value: "Other", label: "Other" }
  ];

  return (
    <div className="flex flex-col flex-1 min-h-screen items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      {/* Premium ambient decorative nodes */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl -z-10" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand */}
        <div className="flex flex-col items-center gap-2 mb-8 text-center">
          <div className="flex items-center gap-2.5">
            <img
              src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
              alt="DataBoy Logo"
              className="h-10 w-auto"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-bold font-mono">Academic Assistance Gateway</p>
        </div>

        <Card className="shadow-2xl border border-border/40 bg-card">
          <CardHeader>
            <div className="flex justify-between items-center mb-1">
              <Badge variant="primary" className="text-[10px] font-extrabold uppercase tracking-wider bg-primary/10 text-primary border-primary/20">Fast Setup</Badge>
              <span className="text-[10px] text-muted-foreground font-bold font-mono">EST: &lt; 30 SEC</span>
            </div>
            <CardTitle className="text-xl font-black text-foreground">Tell us a little about yourself</CardTitle>
            <CardDescription className="text-xs text-muted-foreground leading-relaxed mt-1">
              Let&apos;s personalize your academic workspace so our verified writers can align deliverables with your program requirements. Your details are strictly confidential.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {error && (
                <Alert variant="error" title="Setup Warning">
                  {error}
                </Alert>
              )}

              <Select
                label="What is your current education level?"
                options={educationOptions}
                value={educationLevel}
                onChange={(e) => setEducationLevel(e.target.value)}
                required
              />

              <Select
                label="What academic program are you studying?"
                options={programOptions}
                value={programOfStudy}
                onChange={(e) => setProgramOfStudy(e.target.value)}
                required
              />

              {/* Pervasive Trust Indicators */}
              <div className="flex flex-col gap-2.5 border-t border-border/10 pt-4 mt-2">
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center">DataBoy Academic Trust Standards</span>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground font-bold">
                  <div className="flex items-center gap-1.5 bg-secondary/30 p-1.5 rounded border border-border/10">
                    <span className="text-emerald-500 text-xs">✓</span> Verified Writers
                  </div>
                  <div className="flex items-center gap-1.5 bg-secondary/30 p-1.5 rounded border border-border/10">
                    <span className="text-emerald-500 text-xs">✓</span> Plagiarism-Screened
                  </div>
                  <div className="flex items-center gap-1.5 bg-secondary/30 p-1.5 rounded border border-border/10">
                    <span className="text-emerald-500 text-xs">✓</span> Human-Written Only
                  </div>
                  <div className="flex items-center gap-1.5 bg-secondary/30 p-1.5 rounded border border-border/10">
                    <span className="text-emerald-500 text-xs">✓</span> Secure Escrow hold
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-4">
                <Button variant="primary" type="submit" isLoading={saving} className="w-full py-2.5 font-bold shadow-[0_4px_12px_rgba(99,102,241,0.2)]">
                  Complete Profile
                </Button>
                <button
                  type="button"
                  onClick={logout}
                  className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-center py-1 mt-1 bg-transparent border-0"
                >
                  Cancel and Log Out
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
