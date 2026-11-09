"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Loader } from "@/components/ui/Loader";
import { userService } from "@/services/userService";
import { auditService } from "@/services/auditService";
import { useTheme } from "@/hooks/useTheme";

export default function WriterOnboarding() {
  const { user, profile, loading, refreshProfile, logout } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();

  // Wizard Steps: 1 = Profile details, 2 = Finish screen
  const [step, setStep] = useState(1);

  // Form Fields
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [highestQualification, setHighestQualification] = useState("");
  const [selectedExpertise, setSelectedExpertise] = useState<string[]>([]);
  const [bio, setBio] = useState("");
  
  // UI States
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace("/");
        return;
      }
      if (profile) {
        // Redirect non-writer profiles
        if (profile.role !== "writer") {
          router.replace(profile.role === "customer" ? "/onboarding/student" : "/dashboard");
          return;
        }
        if (profile.isOnboarded) {
          router.replace("/dashboard");
          return;
        }
        setFullName(profile.displayName || "");
        setDisplayName(profile.displayName || "");
      }
    }
  }, [profile, router, loading, user]);

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <Loader size="lg" />
        <span className="text-sm font-semibold tracking-wider text-muted-foreground mt-4 uppercase animate-pulse">
          Loading Setup...
        </span>
      </div>
    );
  }

  const handleNextStep = () => {
    setError(null);
    if (fullName.trim().length < 2) {
      setError("Please input your full name.");
      return;
    }
    if (!highestQualification) {
      setError("Please select your highest academic qualification.");
      return;
    }
    if (selectedExpertise.length === 0) {
      setError("Please select at least one subject of expertise.");
      return;
    }
    if (bio.trim().length > 300) {
      setError("Biography must not exceed 300 characters.");
      return;
    }
    setStep(2);
  };

  const handlePrevStep = () => {
    setError(null);
    setStep(1);
  };

  const handleToggleExpertise = (val: string) => {
    setSelectedExpertise((prev) =>
      prev.includes(val) ? prev.filter((item) => item !== val) : [...prev, val]
    );
  };

  const handleCompleteSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const academicDetails = {
        phone: "", // Excluded from onboarding per directive
        university: "Confidential", // Placeholder for V1 compliance
        faculty: "Academic Department", // Placeholder for V1 compliance
        major: selectedExpertise.join(", "), // Academic major maps to fields of expertise
        yearOfStudy: highestQualification, // Qualification
        bio: bio.trim(),
        specializations: selectedExpertise // Set multi-select fields
      };

      const finalDisplayName = displayName.trim() || fullName.trim();

      await userService.updateUserProfile(profile.uid, {
        displayName: finalDisplayName,
        isOnboarded: true,
        profileCompletion: 60, // Awaiting verification files later
        verificationStatus: "draft",
        availability: "available",
        academic: academicDetails
      });

      await refreshProfile();
      await auditService.logActivity("SYSTEM", {
        type: "system_alert",
        actorId: profile.uid,
        actorName: finalDisplayName,
        actorRole: "writer",
        message: `Writer [${finalDisplayName}] completed profile setup and entered draft queue.`
      });

      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message || "Failed to submit writer details.");
    } finally {
      setSaving(false);
    }
  };

  const qualificationOptions = [
    { value: "", label: "Select Qualification" },
    { value: "Diploma", label: "Diploma" },
    { value: "Degree", label: "Degree" },
    { value: "Masters", label: "Masters" },
    { value: "PhD Candidate", label: "PhD Candidate" }
  ];

  const expertiseOptions = [
    "Accounting", "Law", "Computer Science", "Economics", "Engineering",
    "Education", "Medicine", "Statistics", "Research Methods", "Business", "Other"
  ];

  return (
    <div className="flex flex-col flex-1 min-h-screen items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      {/* Premium ambient decorative nodes */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl -z-10" />

      <div className="w-full max-w-lg relative z-10">
        {/* Brand */}
        <div className="flex flex-col items-center gap-2 mb-8 text-center">
          <div className="flex items-center gap-2.5">
            <img
              src={isDark ? "/brand-pack/Dark-Version/logo-dark.svg" : "/brand-pack/Light-Version/logo-light.svg"}
              alt="DataBoy Logo"
              className="h-10 w-auto"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-bold font-mono">Academic Workforce Gateway</p>
        </div>

        <Card className="shadow-2xl border border-border/40 bg-card">
          <CardHeader>
            <div className="flex justify-between items-center mb-1">
              <Badge variant="warning" className="text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/10 text-amber-400 border-amber-500/20">Academic Writer Setup</Badge>
              <span className="text-[10px] text-muted-foreground font-bold font-mono">Step {step} of 2</span>
            </div>
            <CardTitle className="text-xl font-black text-foreground">
              {step === 1 ? "Tell us a little about yourself" : "Ready to Get Started?"}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground leading-relaxed mt-1">
              {step === 1 
                ? "Configure your academic profile and subject competencies. Verification documents (Degree & Transcript) will be uploaded in the dashboard." 
                : "Your profile setup is complete. You can browse active projects now, and verification documents can be uploaded in the dashboard."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {error && (
              <Alert variant="error" className="mb-4" title="Setup Warning">
                {error}
              </Alert>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-4">
                <Input
                  label="What is your full name?"
                  placeholder="Elena Rostov"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />

                <Input
                  label="How would you like to be addressed? (Optional Display Name)"
                  placeholder="Elena R."
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />

                <Select
                  label="What is your highest academic qualification?"
                  options={qualificationOptions}
                  value={highestQualification}
                  onChange={(e) => setHighestQualification(e.target.value)}
                  required
                />

                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    What subjects are you most comfortable writing about?
                  </label>
                  <div className="grid grid-cols-2 gap-2 border border-border/40 p-3 rounded-lg bg-background max-h-[160px] overflow-y-auto pr-2">
                    {expertiseOptions.map((opt) => {
                      const isSelected = selectedExpertise.includes(opt);
                      return (
                        <label key={opt} className="flex items-center gap-2.5 p-1.5 cursor-pointer select-none text-xs rounded hover:bg-secondary/45">
                          <input
                            type="checkbox"
                            className="rounded text-primary focus:ring-primary w-4 h-4 border-input bg-card"
                            checked={isSelected}
                            onChange={() => handleToggleExpertise(opt)}
                          />
                          <span className={isSelected ? "text-foreground font-bold" : "text-muted-foreground font-medium"}>
                            {opt}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 mt-1">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-bold uppercase tracking-wide text-muted-foreground">Tell us a little about yourself and your academic writing experience (Optional)</label>
                    <span className={`font-mono text-[10px] ${bio.length > 300 ? "text-danger" : "text-muted-foreground"}`}>{bio.length}/300</span>
                  </div>
                  <textarea
                    className="w-full min-h-[75px] p-3 text-xs rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-normal resize-none"
                    placeholder="e.g. Graduate in Computer Science with over 3 years of experience writing quantitative and research reports. Specialized in data analytics and formatting compliance."
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={300}
                  />
                </div>

                {/* Pervasive Trust Indicators */}
                <div className="flex flex-col gap-2.5 border-t border-border/10 pt-4 mt-2">
                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center">DataBoy Academic Integrity Standards</span>
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground font-bold">
                    <div className="flex items-center gap-1.5 bg-secondary/30 p-1.5 rounded border border-border/10">
                      <span className="text-emerald-500 text-xs">✓</span> AI-Free Only
                    </div>
                    <div className="flex items-center gap-1.5 bg-secondary/30 p-1.5 rounded border border-border/10">
                      <span className="text-emerald-500 text-xs">✓</span> Plagiarism Screening
                    </div>
                    <div className="flex items-center gap-1.5 bg-secondary/30 p-1.5 rounded border border-border/10">
                      <span className="text-emerald-500 text-xs">✓</span> Vetted Credentials
                    </div>
                    <div className="flex items-center gap-1.5 bg-secondary/30 p-1.5 rounded border border-border/10">
                      <span className="text-emerald-500 text-xs">✓</span> Protected Escrows
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 mt-4">
                  <Button variant="primary" onClick={handleNextStep} className="w-full py-2.5 font-bold shadow-[0_4px_12px_rgba(99,102,241,0.2)]">
                    Next Step
                  </Button>
                  <button
                    type="button"
                    onClick={logout}
                    className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-center py-1 mt-1 bg-transparent border-0"
                  >
                    Cancel and Log Out
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <form onSubmit={handleCompleteSetup} className="flex flex-col gap-5">
                <Alert variant="info" title="Verification Process">
                  Your account will start as <strong>Unverified</strong>. To receive payouts, claim assignments, or participate in audits, you will submit your degree certificate and academic transcript via the dashboard&apos;s **Verification Centre** at any time.
                </Alert>

                <div className="flex gap-3 mt-4">
                  <Button variant="outline" type="button" onClick={handlePrevStep} className="flex-1 font-semibold" disabled={saving}>
                    Back
                  </Button>
                  <Button variant="primary" type="submit" isLoading={saving} className="flex-1 font-bold shadow-[0_4px_12px_rgba(99,102,241,0.2)]">
                    Finish Setup
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
