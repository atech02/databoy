"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { userService } from "@/services/userService";
import { adminService } from "@/services/adminService";
import { notificationService } from "@/services/notificationService";
import { useAuth } from "@/hooks/useAuth";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Loader } from "@/components/ui/Loader";
import { AuthorizedFileLink } from "@/components/ui/AuthorizedFileLink";
import { UNIVERSITIES, FACULTIES, MAJORS } from "@/utils/lookups";
import { UserProfile, UserStatus, VerificationStatus } from "@/types/domain";

// Helper to count documents
const countDocuments = (user: UserProfile) => {
  if (!user.academic?.documents) return 0;
  let cnt = 0;
  const docs = user.academic.documents;
  if (docs.degreeCertificateUrl) cnt++;
  if (docs.transcriptUrl) cnt++;
  if (docs.cvUrl) cnt++;
  if (docs.certificationsUrl) cnt++;
  if (docs.publicationsUrl) cnt++;
  if (docs.supportingDocsUrl) cnt++;
  return cnt;
};

// Mock database for standard directory users if not in Firestore
const MOCK_USERS: Record<string, Partial<UserProfile>> = {
  "USR-001": {
    uid: "USR-001",
    displayName: "Dr. Elena Rostov",
    email: "e.rostov@university.edu",
    role: "writer",
    status: "active",
    verificationStatus: "approved",
    writerStatus: "active",
    isVerifiedWriter: true,
    profileCompletion: 100,
    reputation: 4.95,
    completedCount: 42,
    createdAt: "2026-01-10T08:00:00Z",
    lastLoginDate: "2026-06-10T14:30:00Z",
    submissionDate: "2026-01-11T12:00:00Z",
    previousRejectionsCount: 0,
    previousClarificationsCount: 0,
    statusHistory: [
      {
        status: "approved",
        actorId: "admin-system",
        actorName: "System Administrator",
        actorRole: "admin",
        timestamp: "2026-01-12T09:00:00Z",
        note: "Initial mock credentials verification approved."
      }
    ],
    academic: {
      phone: "+1 (555) 890-2341",
      university: "MIT",
      faculty: "science",
      major: "computer_science",
      yearOfStudy: "2024",
      bio: "Professor of Applied Cryptography and Distributed Systems. Specializing in advanced software engineering, high-performance computing, and mathematical modeling.",
      specializations: ["mathematics", "computer_science", "engineering"],
      documents: {
        degreeCertificateUrl: "#",
        transcriptUrl: "#"
      }
    }
  }
};

export default function AdminDetailPage() {
  const { profile: currentAdmin } = useAuth();
  const searchParams = useSearchParams();
  const userId = searchParams.get("id") || "";

  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    async function loadUser() {
      if (!userId) {
        setError("No user ID provided in request.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        // Attempt live fetch
        const liveUser = await userService.getUserProfile(userId);
        if (liveUser) {
          setUserProfile(liveUser);
        } else if (MOCK_USERS[userId]) {
          // Fallback to mock
          setUserProfile(MOCK_USERS[userId] as UserProfile);
        } else {
          setError(`User profile for ID [${userId}] could not be found in the system.`);
        }
      } catch (err: any) {
        console.error("Error loading user profile:", err);
        setError("Database read error. Please ensure Firebase configuration is valid.");
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, [userId]);

  const handleUpdateStatus = async (newStatus: UserStatus) => {
    if (!userProfile) return;
    setActioning(true);
    setError(null);
    setSuccess(null);

    try {
      if (userId.startsWith("USR-")) {
        const updated = { ...userProfile, status: newStatus };
        if (newStatus === "suspended") {
          updated.writerStatus = "inactive" as const;
          updated.isVerifiedWriter = false;
        }
        setUserProfile(updated);
      } else {
        await userService.toggleUserStatus(userProfile.uid, newStatus);
        if (newStatus === "suspended") {
          await userService.suspendUser(userProfile.uid);
        }
        const refreshed = await userService.getUserProfile(userProfile.uid);
        if (refreshed) setUserProfile(refreshed);
      }

      await adminService.logPlatformAudit(
        currentAdmin || { uid: "admin", displayName: "System Admin", role: "admin" } as any,
        newStatus === "suspended" ? "USER_SUSPENDED" : "USER_REACTIVATED",
        userProfile.uid,
        "user",
        `Admin modified user status of [${userProfile.displayName}] to [${newStatus.toUpperCase()}]`
      );

      setSuccess(`User status successfully updated to ${newStatus}!`);
    } catch (err: any) {
      setError(err?.message || "Failed to update status.");
    } finally {
      setActioning(false);
    }
  };

  const handleApprove = async () => {
    if (!userProfile || !currentAdmin) return;
    setActioning(true);
    setError(null);
    setSuccess(null);

    try {
      if (userId.startsWith("USR-")) {
        const timestamp = new Date().toISOString();
        const updated: UserProfile = {
          ...userProfile,
          verificationStatus: "approved",
          writerStatus: "active",
          isVerifiedWriter: true,
          reputation: 0,
          completedCount: 0,
          statusHistory: [
            ...(userProfile.statusHistory || []),
            {
              status: "approved",
              actorId: currentAdmin.uid,
              actorName: currentAdmin.displayName,
              actorRole: currentAdmin.role,
              timestamp,
              note: noteText || "Credentials approved manually by administrator."
            }
          ]
        };
        setUserProfile(updated);
      } else {
        await userService.approveVerification(userProfile.uid, currentAdmin);
        await adminService.logPlatformAudit(
          currentAdmin,
          "VERIFICATION_APPROVED",
          userProfile.uid,
          "user",
          `Admin approved credentials for ${userProfile.role.toUpperCase()}: ${userProfile.displayName}`
        );
        await notificationService.notifyVerificationApproved(userProfile.uid);
        const refreshed = await userService.getUserProfile(userProfile.uid);
        if (refreshed) setUserProfile(refreshed);
      }
      setNoteText("");
      setSuccess("Specialist credentials verified and account activated successfully!");
    } catch (err: any) {
      setError(err?.message || "Failed to approve credentials.");
    } finally {
      setActioning(false);
    }
  };

  const handleReject = async () => {
    if (!userProfile || !currentAdmin) return;
    if (!noteText.trim()) {
      alert("A rejection reason is required in the notes field before rejecting a candidate.");
      return;
    }
    setActioning(true);
    setError(null);
    setSuccess(null);

    try {
      if (userId.startsWith("USR-")) {
        const timestamp = new Date().toISOString();
        const updated: UserProfile = {
          ...userProfile,
          verificationStatus: "rejected",
          writerStatus: "inactive",
          isVerifiedWriter: false,
          rejectionReason: noteText,
          previousRejectionsCount: (userProfile.previousRejectionsCount || 0) + 1,
          statusHistory: [
            ...(userProfile.statusHistory || []),
            {
              status: "rejected",
              actorId: currentAdmin.uid,
              actorName: currentAdmin.displayName,
              actorRole: currentAdmin.role,
              timestamp,
              note: `Credentials rejected. Reason: ${noteText}`
            }
          ]
        };
        setUserProfile(updated);
      } else {
        await userService.rejectVerification(userProfile.uid, noteText, currentAdmin);
        await adminService.logPlatformAudit(
          currentAdmin,
          "VERIFICATION_REJECTED",
          userProfile.uid,
          "user",
          `Admin rejected credentials for ${userProfile.role.toUpperCase()}: ${userProfile.displayName}. Reason: ${noteText}`
        );
        await notificationService.notifyVerificationRejected(userProfile.uid, noteText);
        const refreshed = await userService.getUserProfile(userProfile.uid);
        if (refreshed) setUserProfile(refreshed);
      }
      setNoteText("");
      setSuccess("Credentials verification rejected. Writer has been deactivated.");
    } catch (err: any) {
      setError(err?.message || "Failed to reject credentials.");
    } finally {
      setActioning(false);
    }
  };

  const handleRequestClarification = async () => {
    if (!userProfile || !currentAdmin) return;
    if (!noteText.trim()) {
      alert("Please enter details in the notes field explaining what clarification is required.");
      return;
    }
    setActioning(true);
    setError(null);
    setSuccess(null);

    try {
      if (userId.startsWith("USR-")) {
        const timestamp = new Date().toISOString();
        const updated: UserProfile = {
          ...userProfile,
          verificationStatus: "clarification_required",
          writerStatus: "inactive",
          isVerifiedWriter: false,
          rejectionReason: noteText,
          previousClarificationsCount: (userProfile.previousClarificationsCount || 0) + 1,
          statusHistory: [
            ...(userProfile.statusHistory || []),
            {
              status: "clarification_required",
              actorId: currentAdmin.uid,
              actorName: currentAdmin.displayName,
              actorRole: currentAdmin.role,
              timestamp,
              note: `Clarification requested: ${noteText}`
            }
          ]
        };
        setUserProfile(updated);
      } else {
        await userService.requestClarification(userProfile.uid, noteText, currentAdmin);
        await adminService.logPlatformAudit(
          currentAdmin,
          "VERIFICATION_INFO_REQUESTED",
          userProfile.uid,
          "user",
          `Admin requested clarification from ${userProfile.displayName}: ${noteText}`
        );
        await notificationService.notifyVerificationClarificationRequested(userProfile.uid, noteText);
        const refreshed = await userService.getUserProfile(userProfile.uid);
        if (refreshed) setUserProfile(refreshed);
      }
      setNoteText("");
      setSuccess("Clarification requested successfully! Writer has been notified.");
    } catch (err: any) {
      setError(err?.message || "Failed to request clarification.");
    } finally {
      setActioning(false);
    }
  };

  const getRoleBadge = (role?: UserProfile["role"]) => {
    switch (role) {
      case "customer":
        return <Badge variant="primary">Student</Badge>;
      case "writer":
        return <Badge variant="warning">Writer</Badge>;
      case "proofreader":
        return <Badge variant="info">Proofreader</Badge>;
      case "admin":
        return <Badge variant="success">Admin</Badge>;
      default:
        return <Badge variant="secondary">User</Badge>;
    }
  };

  const getVerificationBadge = (status?: VerificationStatus) => {
    switch (status) {
      case "draft":
      case "incomplete":
        return <Badge variant="secondary" className="uppercase font-mono text-[10px]">Draft</Badge>;
      case "pending_review":
        return <Badge variant="warning" className="uppercase font-mono text-[10px]">Pending Review</Badge>;
      case "clarification_required":
        return <Badge variant="info" className="uppercase font-mono text-[10px]">Clarification Needed</Badge>;
      case "approved":
        return <Badge variant="success" className="uppercase font-mono text-[10px]">Approved</Badge>;
      case "rejected":
        return <Badge variant="danger" className="uppercase font-mono text-[10px]">Rejected</Badge>;
      default:
        return <Badge variant="secondary" className="uppercase font-mono text-[10px]">{status || "draft"}</Badge>;
    }
  };

  const getUniversityLabel = (val?: string) => {
    return UNIVERSITIES.find(u => u.value === val)?.label || val || "N/A";
  };

  const getMajorLabel = (fac?: string, val?: string) => {
    if (!fac || !val) return "N/A";
    return MAJORS[fac]?.find(m => m.value === val)?.label || val || "N/A";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader size="lg" />
      </div>
    );
  }

  if (error || !userProfile) {
    return (
      <div className="flex flex-col gap-6 max-w-2xl mx-auto">
        <BackButton fallbackUrl="/admin" label="Admin Panel" />
        <Alert variant="error" title="User Not Found">
          {error || "An unexpected error occurred while loading this user's profile."}
        </Alert>
      </div>
    );
  }

  const isExpert = userProfile.role === "writer" || userProfile.role === "proofreader";

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      
      {/* Back Button */}
      <div className="flex items-center">
        <BackButton fallbackUrl="/admin?tab=verifications" label="Admin Panel" />
      </div>

      {success && (
        <Alert variant="success" title="Change Saved" className="w-full">
          {success}
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Summary & Quality Vetting Stats */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <Card className="border-border/40 shadow-sm">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-4">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-4xl select-none font-bold text-primary shadow-inner">
                {userProfile.displayName?.charAt(0).toUpperCase() || "U"}
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-bold text-foreground tracking-tight">{userProfile.displayName}</h2>
                <span className="text-xs text-muted-foreground font-medium">{userProfile.email}</span>
              </div>
              
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                {getRoleBadge(userProfile.role)}
                <Badge variant={userProfile.status === "active" ? "success" : "danger"} className="uppercase font-mono text-[10px]">
                  {userProfile.status}
                </Badge>
                {isExpert && getVerificationBadge(userProfile.verificationStatus)}
              </div>

              {userProfile.reputation !== undefined && (
                <div className="mt-2 text-xs border border-border/30 px-3 py-1.5 rounded-full bg-secondary/20 flex items-center gap-1.5 font-bold">
                  <span className="text-amber-500">★</span>
                  <span>Reputation: {userProfile.reputation} / 5.0</span>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground font-medium">{userProfile.completedCount || 0} tasks</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Account Quality Vetting Metrics (Revision 6) */}
          <Card className="border-border/40 shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Vetting Analytics</CardTitle>
              <CardDescription>Metrics for review process quality assurance</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-xs font-semibold">
              <div className="flex justify-between items-center py-2 border-b border-border/10">
                <span className="text-muted-foreground">Account Created</span>
                <span className="text-foreground">{userProfile.createdAt ? new Date(userProfile.createdAt).toLocaleDateString() : "N/A"}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/10">
                <span className="text-muted-foreground">Last Login Date</span>
                <span className="text-foreground">{userProfile.lastLoginDate ? new Date(userProfile.lastLoginDate).toLocaleDateString() : "Never"}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/10">
                <span className="text-muted-foreground">Submitted Documents</span>
                <span className="text-primary font-bold">{countDocuments(userProfile)} files</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/10">
                <span className="text-muted-foreground">Verification Sub Date</span>
                <span className="text-foreground">{userProfile.submissionDate ? new Date(userProfile.submissionDate).toLocaleDateString() : "N/A"}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/10">
                <span className="text-muted-foreground">Previous Rejections</span>
                <span className={userProfile.previousRejectionsCount ? "text-danger font-bold" : "text-foreground"}>
                  {userProfile.previousRejectionsCount || 0}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-muted-foreground">Clarification Requests</span>
                <span className={userProfile.previousClarificationsCount ? "text-amber-500 font-bold" : "text-foreground"}>
                  {userProfile.previousClarificationsCount || 0}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Account Status Control & Mediation */}
          <Card className="border-border/40 shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Account Status Mediation</CardTitle>
              <CardDescription>Manage general account status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Button 
                  variant={userProfile.status === "active" ? "primary" : "outline"} 
                  size="sm" 
                  className={`flex-1 text-xs font-bold ${userProfile.status === "active" ? "!bg-success !border-success !text-white hover:!bg-success/90" : ""}`}
                  onClick={() => handleUpdateStatus("active")}
                  disabled={actioning}
                >
                  Activate
                </Button>
                <Button 
                  variant={userProfile.status === "suspended" ? "danger" : "outline"} 
                  size="sm" 
                  className="flex-1 text-xs font-bold"
                  onClick={() => handleUpdateStatus("suspended")}
                  disabled={actioning}
                >
                  Suspend
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Professional Sheet & Vetting Panel */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="shadow-md border-border/40">
            <CardHeader className="border-b border-border/40 bg-secondary/15">
              <CardTitle>Professional Credentials Review</CardTitle>
              <CardDescription>Writer profile bio, academic credentials, and competencies</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col gap-6">
              
              {/* Academic Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 border-b border-border/10 pb-5">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block font-mono">University / College</span>
                  <span className="text-sm font-semibold text-foreground mt-1 block">
                    🏫 {getUniversityLabel(userProfile.academic?.university)}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block font-mono">Faculty / Program</span>
                  <span className="text-sm font-semibold text-foreground mt-1 block">
                    🎓 {userProfile.academic?.faculty?.toUpperCase()} - {getMajorLabel(userProfile.academic?.faculty, userProfile.academic?.major)}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block font-mono">Graduation / Study Year</span>
                  <span className="text-sm font-semibold text-foreground mt-1 block">
                    🗓️ Class of {userProfile.academic?.yearOfStudy || "N/A"}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block font-mono">Contact Phone</span>
                  <span className="text-sm font-semibold text-foreground mt-1 block">
                    📞 {userProfile.academic?.phone || "N/A"}
                  </span>
                </div>
              </div>

              {/* Specializations / Competencies */}
              {isExpert && (
                <>
                  <div className="border-b border-border/10 pb-5">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block font-mono">Academic Competencies</span>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {userProfile.academic?.specializations?.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs font-semibold py-0.5 px-2.5">
                          {s.replace(/_/g, " ")}
                        </Badge>
                      )) || <span className="text-xs text-muted-foreground italic">None specified.</span>}
                    </div>
                  </div>

                  <div className="border-b border-border/10 pb-5">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block font-mono">Professional Biography</span>
                    <p className="text-xs text-foreground/80 leading-relaxed bg-secondary/15 p-3 rounded-lg border border-border/30 italic mt-2">
                      &quot;{userProfile.academic?.bio || "No biography provided by user."}&quot;
                    </p>
                  </div>

                  {/* Uploaded Documents List */}
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2 font-mono">Uploaded Academic Credentials</span>
                    <div className="flex flex-col gap-2.5">
                      
                      {/* Degree Certificate */}
                      <div className="flex items-center justify-between p-3.5 bg-secondary/35 rounded-xl border border-border/25 text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-foreground">1. Degree Certificate scan (Required)</span>
                          <span className="text-[10px] text-muted-foreground font-medium">Verify validity of major and graduation year</span>
                        </div>
                        {userProfile.academic?.documents?.degreeCertificateUrl ? (
                          <AuthorizedFileLink
                            fileRef={{ url: userProfile.academic.documents.degreeCertificateUrl }}
                            className="bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-lg font-bold hover:bg-primary/20 transition-all select-none cursor-pointer"
                          >
                            Open Scan
                          </AuthorizedFileLink>
                        ) : (
                          <Badge variant="danger" className="text-[10px]">No File Uploaded</Badge>
                        )}
                      </div>

                      {/* Transcript */}
                      <div className="flex items-center justify-between p-3.5 bg-secondary/35 rounded-xl border border-border/25 text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-foreground">2. Official Academic Transcript (Required)</span>
                          <span className="text-[10px] text-muted-foreground font-medium">Verify GPA and specific courses taken</span>
                        </div>
                        {userProfile.academic?.documents?.transcriptUrl ? (
                          <AuthorizedFileLink
                            fileRef={{ url: userProfile.academic.documents.transcriptUrl }}
                            className="bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-lg font-bold hover:bg-primary/20 transition-all select-none cursor-pointer"
                          >
                            Open Scan
                          </AuthorizedFileLink>
                        ) : (
                          <Badge variant="danger" className="text-[10px]">No File Uploaded</Badge>
                        )}
                      </div>

                      {/* Optional Documents CV */}
                      {userProfile.academic?.documents?.cvUrl && (
                        <div className="flex items-center justify-between p-3.5 bg-secondary/35 rounded-xl border border-border/25 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-foreground">3. Curriculum Vitae (Optional)</span>
                            <span className="text-[10px] text-muted-foreground font-medium">Verify professional work experience</span>
                          </div>
                          <AuthorizedFileLink
                            fileRef={{ url: userProfile.academic.documents.cvUrl }}
                            className="bg-secondary text-foreground border border-border px-3 py-1.5 rounded-lg font-bold hover:bg-secondary/80 transition-all select-none cursor-pointer"
                          >
                            Open File
                          </AuthorizedFileLink>
                        </div>
                      )}

                      {/* Optional Documents Certifications */}
                      {userProfile.academic?.documents?.certificationsUrl && (
                        <div className="flex items-center justify-between p-3.5 bg-secondary/35 rounded-xl border border-border/25 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-foreground">4. Professional Certifications (Optional)</span>
                            <span className="text-[10px] text-muted-foreground font-medium">Verify additional professional expertise</span>
                          </div>
                          <AuthorizedFileLink
                            fileRef={{ url: userProfile.academic.documents.certificationsUrl }}
                            className="bg-secondary text-foreground border border-border px-3 py-1.5 rounded-lg font-bold hover:bg-secondary/80 transition-all select-none cursor-pointer"
                          >
                            Open File
                          </AuthorizedFileLink>
                        </div>
                      )}

                      {/* Optional Documents Publications */}
                      {userProfile.academic?.documents?.publicationsUrl && (
                        <div className="flex items-center justify-between p-3.5 bg-secondary/35 rounded-xl border border-border/25 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-foreground">5. Academic Publications (Optional)</span>
                            <span className="text-[10px] text-muted-foreground font-medium">Verify published academic works</span>
                          </div>
                          <AuthorizedFileLink
                            fileRef={{ url: userProfile.academic.documents.publicationsUrl }}
                            className="bg-secondary text-foreground border border-border px-3 py-1.5 rounded-lg font-bold hover:bg-secondary/80 transition-all select-none cursor-pointer"
                          >
                            Open File
                          </AuthorizedFileLink>
                        </div>
                      )}

                      {/* Optional Documents Supporting Docs */}
                      {userProfile.academic?.documents?.supportingDocsUrl && (
                        <div className="flex items-center justify-between p-3.5 bg-secondary/35 rounded-xl border border-border/25 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-foreground">6. Supporting Documents (Optional)</span>
                            <span className="text-[10px] text-muted-foreground font-medium">Verify additional credentials</span>
                          </div>
                          <AuthorizedFileLink
                            fileRef={{ url: userProfile.academic.documents.supportingDocsUrl }}
                            className="bg-secondary text-foreground border border-border px-3 py-1.5 rounded-lg font-bold hover:bg-secondary/80 transition-all select-none cursor-pointer"
                          >
                            Open File
                          </AuthorizedFileLink>
                        </div>
                      )}

                    </div>
                  </div>
                </>
              )}

            </CardContent>
          </Card>

          {/* Vetting Decisions & Actions Workspace */}
          {isExpert && (
            <Card className="border-border shadow-sm">
              <CardHeader className="border-b border-border/40">
                <CardTitle className="text-base">Administrative Vetting Panel</CardTitle>
                <CardDescription>Evaluate documents, request additional details, or grant workbench activation</CardDescription>
              </CardHeader>
              <CardContent className="pt-5 flex flex-col gap-4">
                
                {/* Notes Input */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-2 font-mono">
                    Clarification Details / Rejection Reason / Vetting Notes:
                  </label>
                  <textarea
                    rows={4}
                    className="w-full px-3.5 py-2.5 text-xs bg-background border border-border/60 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 placeholder:text-muted-foreground/40 font-semibold"
                    placeholder="Provide detailed instructions if requesting clarification or specify exact policy breaches if rejecting..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                </div>

                {/* Audit Timeline List */}
                <div className="mt-4 pt-4 border-t border-border/10">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-4 font-mono">
                    Permanent Verification Audit History
                  </span>
                  
                  {userProfile.statusHistory && userProfile.statusHistory.length > 0 ? (
                    <div className="flex flex-col gap-4 mt-2">
                      {userProfile.statusHistory.map((entry, idx) => (
                        <div key={idx} className="flex gap-4 items-start text-xs border-l-2 border-border/60 pl-4 relative pb-4 last:pb-0">
                          <div className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 flex-wrap font-semibold">
                              <span className="capitalize font-bold text-foreground">
                                {entry.status.replace(/_/g, " ")}
                              </span>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-muted-foreground">{entry.actorName} ({entry.actorRole})</span>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-muted-foreground font-mono">{new Date(entry.timestamp).toLocaleString()}</span>
                            </div>
                            {entry.note && (
                              <p className="text-muted-foreground bg-secondary/20 p-2.5 rounded border border-border/30 mt-1 italic font-mono text-[11px] leading-relaxed">
                                &quot;{entry.note}&quot;
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No verification status history recorded.</span>
                  )}
                </div>

              </CardContent>
              <CardFooter className="flex flex-wrap justify-end gap-3 border-t border-border/40 bg-secondary/10 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRequestClarification}
                  disabled={actioning || userProfile.verificationStatus === "approved"}
                  className="text-xs font-bold hover:text-primary hover:border-primary hover:bg-primary/5 transition-all"
                >
                  📩 Request Clarification
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReject}
                  disabled={actioning || userProfile.verificationStatus === "approved"}
                  className="hover:text-danger hover:border-danger hover:bg-danger/5 transition-all text-xs font-bold"
                >
                  Reject Candidate
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApprove}
                  isLoading={actioning}
                  disabled={actioning || userProfile.verificationStatus === "approved"}
                  className="bg-success border-success hover:bg-success/90 hover:border-success/90 transition-all text-xs font-bold"
                >
                  ✓ Approve Specialist Account
                </Button>
              </CardFooter>
            </Card>
          )}

        </div>

      </div>

    </div>
  );
}
