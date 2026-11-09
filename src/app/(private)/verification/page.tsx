"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Loader } from "@/components/ui/Loader";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { userService } from "@/services/userService";
import { storageService } from "@/services/storageService";
import { notificationService } from "@/services/notificationService";
import { adminService } from "@/services/adminService";
import { BackButton } from "@/components/ui/BackButton";
import { useTheme } from "@/hooks/useTheme";
import { 
  UNIVERSITIES, 
  FACULTIES, 
  MAJORS, 
  YEARS_OF_STUDY,
  COMPETENCY_CATEGORIES
} from "@/utils/lookups";

export default function VerificationCentre() {
  const { profile, loading, refreshProfile } = useAuth();
  const { isDark } = useTheme();
  const router = useRouter();

  // Profile fields state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [university, setUniversity] = useState("");
  const [faculty, setFaculty] = useState("");
  const [major, setMajor] = useState("");
  const [yearOfStudy, setYearOfStudy] = useState("");
  const [bio, setBio] = useState("");
  const [selectedSpecs, setSelectedSpecs] = useState<string[]>([]);

  // Document URLs state
  const [degreeUrl, setDegreeUrl] = useState("");
  const [transcriptUrl, setTranscriptUrl] = useState("");
  const [cvUrl, setCvUrl] = useState("");
  const [certificationsUrl, setCertificationsUrl] = useState("");
  const [publicationsUrl, setPublicationsUrl] = useState("");
  const [supportingDocsUrl, setSupportingDocsUrl] = useState("");

  // Upload progress states
  const [uploadProgress, setUploadProgress] = useState<Record<string, number | null>>({});

  // UI status states
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync initial fields from user profile
  useEffect(() => {
    if (!loading && !profile) {
      router.replace("/login");
      return;
    }

    if (profile && profile.role === "customer") {
      router.replace("/dashboard");
      return;
    }

    if (profile) {
      setFullName(profile.displayName || "");
      if (profile.academic) {
        setPhone(profile.academic.phone || "");
        setUniversity(profile.academic.university || "");
        setFaculty(profile.academic.faculty || "");
        setMajor(profile.academic.major || "");
        setYearOfStudy(profile.academic.yearOfStudy || "");
        setBio(profile.academic.bio || "");
        setSelectedSpecs(profile.academic.specializations || profile.competencies || []);
        
        if (profile.academic.documents) {
          setDegreeUrl(profile.academic.documents.degreeCertificateUrl || "");
          setTranscriptUrl(profile.academic.documents.transcriptUrl || "");
          setCvUrl(profile.academic.documents.cvUrl || "");
          setCertificationsUrl(profile.academic.documents.certificationsUrl || "");
          setPublicationsUrl(profile.academic.documents.publicationsUrl || "");
          setSupportingDocsUrl(profile.academic.documents.supportingDocsUrl || "");
        }
      }
    }
  }, [profile, router, loading]);

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <Loader size="lg" />
        <span className="text-sm font-semibold tracking-wider text-muted-foreground mt-4 uppercase animate-pulse">
          Loading Verification Centre...
        </span>
      </div>
    );
  }

  const activeMajors = faculty ? MAJORS[faculty] || [] : [];

  const handleSpecToggle = (specValue: string) => {
    if (selectedSpecs.includes(specValue)) {
      setSelectedSpecs(selectedSpecs.filter(s => s !== specValue));
    } else {
      setSelectedSpecs([...selectedSpecs, specValue]);
    }
  };

  // Helper: check profile completeness percentage
  const calculateCompleteness = () => {
    let score = 0;
    const missing: string[] = [];

    if (fullName.trim()) score += 10; else missing.push("Full Name");
    if (phone.trim()) score += 10; else missing.push("Contact Phone");
    if (university) score += 10; else missing.push("University");
    if (faculty) score += 10; else missing.push("Faculty");
    if (major) score += 10; else missing.push("Degree Major");
    if (yearOfStudy) score += 10; else missing.push("Study/Graduation Year");
    if (bio.trim()) score += 10; else missing.push("Biography");
    if (selectedSpecs.length > 0) score += 10; else missing.push("Expertise Competencies");
    if (degreeUrl) score += 10; else missing.push("Degree Certificate File");
    if (transcriptUrl) score += 10; else missing.push("Academic Transcript File");

    return { score, missing };
  };

  const { score: completenessScore, missing: missingFields } = calculateCompleteness();

  // --- Handlers for Document Uploads ---
  const handleUploadFile = async (
    docType: "degree_certificate" | "transcript" | "cv" | "certifications" | "publications" | "supporting_docs",
    file: File
  ) => {
    setError(null);
    setUploadProgress(prev => ({ ...prev, [docType]: 0 }));
    try {
      const url = await storageService.uploadVerificationDocument(
        profile.uid, 
        docType, 
        file, 
        (prog) => setUploadProgress(prev => ({ ...prev, [docType]: prog }))
      );

      if (docType === "degree_certificate") setDegreeUrl(url);
      else if (docType === "transcript") setTranscriptUrl(url);
      else if (docType === "cv") setCvUrl(url);
      else if (docType === "certifications") setCertificationsUrl(url);
      else if (docType === "publications") setPublicationsUrl(url);
      else if (docType === "supporting_docs") setSupportingDocsUrl(url);

      setSuccessMsg(`File uploaded successfully for ${docType.replace("_", " ")}.`);
    } catch (err: any) {
      console.error(err);
      setError(`Failed to upload ${docType.replace("_", " ")}: ${err?.message || "Storage error"}`);
    } finally {
      setUploadProgress(prev => ({ ...prev, [docType]: null }));
    }
  };

  const handleCompleteVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const { score, missing } = calculateCompleteness();
    if (score < 100) {
      setError(`Cannot submit verification request. Please fill out all required details. Missing: ${missing.join(", ")}`);
      return;
    }

    setSaving(true);
    try {
      const documents = {
        degreeCertificateUrl: degreeUrl,
        transcriptUrl: transcriptUrl,
        cvUrl,
        certificationsUrl,
        publicationsUrl,
        supportingDocsUrl
      };

      const academic = {
        phone,
        university,
        faculty,
        major,
        yearOfStudy,
        bio: bio.trim(),
        specializations: selectedSpecs,
        documents
      };

      const timestamp = new Date().toISOString();
      const isResubmission = profile.verificationStatus === "clarification_required";
      const nextStatus = "pending_review";

      const historyEntry = {
        status: nextStatus,
        actorId: profile.uid,
        actorName: fullName,
        actorRole: profile.role,
        timestamp,
        note: isResubmission 
          ? "Writer resubmitted credentials following clarification request."
          : "Writer submitted credentials for administrative verification."
      };

      const statusHistory = [...(profile.statusHistory || []), historyEntry];

      // Update user profile in database (Revision 1 & 11)
      await userService.updateUserProfile(profile.uid, {
        displayName: fullName,
        verificationStatus: nextStatus,
        writerStatus: "inactive",
        isVerifiedWriter: false,
        profileCompletion: score,
        competencies: selectedSpecs,
        subjectExpertise: selectedSpecs,
        degreeLevel: yearOfStudy,
        submissionDate: timestamp,
        academic,
        statusHistory
      });

      // Write administrative audit trail (Revision 7)
      await adminService.logPlatformAudit(
        { uid: profile.uid, displayName: fullName, role: profile.role } as any,
        isResubmission ? "VERIFICATION_RESUBMITTED" : "VERIFICATION_SUBMITTED",
        profile.uid,
        "user",
        `Writer [${fullName}] ${isResubmission ? "resubmitted" : "submitted"} verification documents (Completeness: ${score}%).`
      );

      // Trigger notifications (Revision 12)
      if (isResubmission) {
        await notificationService.notifyVerificationResubmitted(profile.uid, fullName);
      } else {
        await notificationService.notifyVerificationSubmitted(profile.uid, fullName);
      }

      await refreshProfile();
      setSuccessMsg("Verification credentials submitted successfully! Administrators have been notified.");
    } catch (err: any) {
      setError(err?.message || "Failed to submit verification credentials.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetRejection = async () => {
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const nextStatus = "draft";
      const historyEntry = {
        status: nextStatus,
        actorId: profile.uid,
        actorName: profile.displayName,
        actorRole: profile.role,
        timestamp,
        note: "Writer reset verification status to re-edit profile files."
      };

      await userService.updateUserProfile(profile.uid, {
        verificationStatus: nextStatus,
        statusHistory: [...(profile.statusHistory || []), historyEntry]
      });
      await refreshProfile();
    } catch (err: any) {
      setError(err?.message || "Failed to reset verification queue.");
    } finally {
      setSaving(false);
    }
  };

  const status = profile.verificationStatus || "draft";
  const isPending = status === "pending_review";
  const isApproved = status === "approved" && profile.writerStatus === "active" && profile.isVerifiedWriter === true;
  const isRejected = status === "rejected";
  const isClarification = status === "clarification_required";
  const isEditable = status === "draft" || status === "incomplete" || isClarification || isRejected;

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto px-4 pb-12">
      <div className="flex items-center">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Progress & Status */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <Card className="border border-border/40 bg-card">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Verification Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center text-center gap-4">
              {isApproved && (
                <>
                  <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center text-3xl text-success">✓</div>
                  <h3 className="text-lg font-black text-foreground">Verified Academic Expert</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Your credentials have been audited and approved. Workbench assignment matching and claiming privileges are active.
                  </p>
                  <Badge variant="success" className="uppercase font-mono text-[9px] font-bold">Approved</Badge>
                </>
              )}

              {isPending && (
                <>
                  <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center text-3xl text-warning animate-pulse">⏳</div>
                  <h3 className="text-lg font-black text-foreground">Review In Progress</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Your credentials and qualifications scan are currently in the administrator review queue. Verification usually takes 12-24 hours.
                  </p>
                  <Badge variant="warning" className="uppercase font-mono text-[9px] font-bold">Pending Review</Badge>
                </>
              )}

              {isClarification && (
                <>
                  <div className="w-16 h-16 rounded-full bg-danger/15 flex items-center justify-center text-3xl text-danger animate-bounce">⚠️</div>
                  <h3 className="text-lg font-black text-foreground">Clarification Needed</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Reviewers require additional details or replacement scans. Please view details and resubmit credentials below.
                  </p>
                  <Badge variant="danger" className="uppercase font-mono text-[9px] font-bold bg-danger/10 text-danger border-danger/20">Clarification Required</Badge>
                </>
              )}

              {isRejected && (
                <>
                  <div className="w-16 h-16 rounded-full bg-danger/15 flex items-center justify-center text-3xl text-danger">❌</div>
                  <h3 className="text-lg font-black text-foreground">Review Rejected</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    We were unable to approve your credentials. Please review feedback, edit details and re-upload documents.
                  </p>
                  <Badge variant="danger" className="uppercase font-mono text-[9px] font-bold">Rejected</Badge>
                </>
              )}

              {status === "draft" && (
                <>
                  <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-3xl text-muted-foreground">📝</div>
                  <h3 className="text-lg font-black text-foreground">Incomplete Profile</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Fill out all required details and upload your official degree certificate & transcript to request verification.
                  </p>
                  <Badge variant="secondary" className="uppercase font-mono text-[9px] font-bold">Draft Profile</Badge>
                </>
              )}
            </CardContent>
          </Card>

          {/* Profile Completeness */}
          <Card className="border border-border/40 bg-card">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Completeness Meter</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex justify-between items-center text-sm font-bold text-primary">
                <span>Progress</span>
                <span>{completenessScore}%</span>
              </div>
              <div className="w-full h-2.5 bg-secondary/80 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${completenessScore === 100 ? "bg-success" : "bg-primary"}`} 
                  style={{ width: `${completenessScore}%` }}
                />
              </div>

              {completenessScore < 100 && (
                <div className="mt-2 text-xs flex flex-col gap-1 text-muted-foreground">
                  <span className="font-bold text-foreground mb-0.5">Awaiting completion:</span>
                  {missingFields.map((field, idx) => (
                    <span key={idx} className="flex items-center gap-1.5 font-semibold">
                      <span className="text-danger">•</span> {field}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status Timeline History Logs (Revision 7) */}
          {profile.statusHistory && profile.statusHistory.length > 0 && (
            <Card className="border border-border/40 bg-card">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Verification Timeline</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 max-h-[300px] overflow-y-auto pr-2">
                {profile.statusHistory.slice().reverse().map((entry, idx) => (
                  <div key={idx} className="flex gap-2 text-xs border-b border-border/10 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 flex-wrap font-bold">
                        <span className="capitalize text-foreground font-sans">
                          {entry.status.replace(/_/g, " ")}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(entry.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-semibold">
                        Actor: {entry.actorName} ({entry.actorRole})
                      </span>
                      {entry.note && (
                        <p className="text-[11px] text-muted-foreground/90 mt-1 leading-normal italic font-medium">
                          "{entry.note}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Structured Forms & Document Scans */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Rejection / Clarification Message Alerts */}
          {isClarification && profile.rejectionReason && (
            <Alert variant="warning" title="Action Required: Clarification Needed">
              <div className="text-sm leading-relaxed font-semibold">
                <strong>Feedback from Auditor:</strong>
                <p className="mt-1.5 italic bg-warning/5 border border-warning/10 p-3 rounded-lg">
                  "{profile.rejectionReason}"
                </p>
                <p className="mt-3 text-xs font-normal text-muted-foreground leading-normal">
                  Please update the mismatching profile details or upload replacement scans below, then click "Submit Credentials For Review" to return your application to the pending review queue.
                </p>
              </div>
            </Alert>
          )}

          {isRejected && profile.rejectionReason && (
            <Alert variant="error" title="Verification Application Rejected">
              <div className="text-sm leading-relaxed font-semibold">
                <strong>Auditor Rejection Reason:</strong>
                <p className="mt-1.5 italic bg-danger/5 border border-danger/10 p-3 rounded-lg">
                  "{profile.rejectionReason}"
                </p>
                <p className="mt-3 text-xs font-normal text-muted-foreground leading-normal">
                  You are currently restricted from claiming workbench assignments. You can click "Re-edit & Resubmit Files" to reset your draft state, modify credentials, and apply again.
                </p>
                <Button variant="outline" size="sm" onClick={handleResetRejection} className="mt-4 bg-danger/10 text-danger border-danger/20 hover:bg-danger/20 font-bold">
                  Re-edit & Resubmit Files
                </Button>
              </div>
            </Alert>
          )}

          {error && <Alert variant="error" title="Form Validation">{error}</Alert>}
          {successMsg && <Alert variant="success" title="Verification Sandbox">{successMsg}</Alert>}

          {/* Verification Setup Form */}
          <form onSubmit={handleCompleteVerification} className="flex flex-col gap-6">
            <Card className="border border-border/40 bg-card">
              <CardHeader className="border-b border-border/25">
                <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">1. Personal & Academic Settings</CardTitle>
                <CardDescription className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  Update your contact phone and academic qualifications. All details must match official scans.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Full Name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    disabled={!isEditable}
                  />

                  <Input
                    label="Contact Phone"
                    type="tel"
                    placeholder="+260 970 000000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    disabled={!isEditable}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="University / College"
                    options={UNIVERSITIES}
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    required
                    disabled={!isEditable}
                  />

                  <Select
                    label="Faculty / Department"
                    options={FACULTIES}
                    value={faculty}
                    onChange={(e) => setFaculty(e.target.value)}
                    required
                    disabled={!isEditable}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Degree Major / Program"
                    options={activeMajors}
                    value={major}
                    onChange={(e) => setMajor(e.target.value)}
                    required
                    disabled={!isEditable || !faculty}
                  />

                  <Select
                    label="Study / Graduation Year"
                    options={YEARS_OF_STUDY}
                    value={yearOfStudy}
                    onChange={(e) => setYearOfStudy(e.target.value)}
                    required
                    disabled={!isEditable}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-bold uppercase tracking-wide text-muted-foreground">Academic Biography (bio)</label>
                    <span className="font-mono font-bold text-muted-foreground">{bio.length}/300</span>
                  </div>
                  <textarea
                    className="w-full min-h-[90px] p-3 text-xs rounded-lg border border-border/40 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-normal resize-none disabled:opacity-50"
                    placeholder="Provide details about your academic accomplishments, writing experience, or research interests..."
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={300}
                    required
                    disabled={!isEditable}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Structured Competencies tags (Revision 4) */}
            <Card className="border border-border/40 bg-card">
              <CardHeader className="border-b border-border/25">
                <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">2. Select Subject Competencies</CardTitle>
                <CardDescription className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  Select one or more subject areas you are certified to write about. Used for future matchings.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 flex flex-col gap-6">
                <div className="flex flex-col gap-6 max-h-[350px] overflow-y-auto pr-2">
                  {COMPETENCY_CATEGORIES.map((cat, idx) => (
                    <div key={idx} className="flex flex-col gap-2 border-b border-border/10 pb-4 last:border-0 last:pb-0">
                      <span className="text-xs font-black uppercase tracking-wider text-primary font-mono">{cat.categoryName}</span>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {cat.items.map((item) => {
                          const isSelected = selectedSpecs.includes(item.value);
                          return (
                            <button
                              key={item.value}
                              type="button"
                              onClick={() => isEditable && handleSpecToggle(item.value)}
                              disabled={!isEditable}
                              className={`flex items-center justify-between p-2 border rounded-lg text-left transition-all text-xs font-semibold select-none ${
                                isSelected
                                  ? "border-primary/60 bg-primary/10 text-foreground"
                                  : "border-border/40 bg-card hover:bg-secondary/40 text-muted-foreground"
                              } disabled:opacity-75`}
                            >
                              <span>{item.label}</span>
                              {isSelected ? (
                                <span className="text-primary font-bold text-xs select-none">✓</span>
                              ) : (
                                <span className="text-muted-foreground/30 text-[10px] select-none">+ Add</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Credentials Document uploads (Revision 3) */}
            <Card className="border border-border/40 bg-card">
              <CardHeader className="border-b border-border/25">
                <CardTitle className="text-base font-extrabold uppercase tracking-wider text-foreground">3. Upload Academic Scans</CardTitle>
                <CardDescription className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  Auditors manually check all degree documents and transcripts. CV and extra documents are optional.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  
                  {/* Required: Degree Certificate */}
                  <div className="flex flex-col gap-1.5 border border-border/40 p-3 rounded-lg bg-secondary/10">
                    <div className="flex justify-between items-center text-xs font-bold uppercase text-muted-foreground">
                      <span>Degree Certificate *</span>
                      {degreeUrl ? <Badge variant="success">Uploaded</Badge> : <Badge variant="danger">Required</Badge>}
                    </div>
                    {isEditable && (
                      <input 
                        type="file" 
                        accept="application/pdf,image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("degree_certificate", file);
                        }}
                        disabled={uploadProgress["degree_certificate"] !== null}
                        className="text-xs mt-1 text-muted-foreground file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                      />
                    )}
                    {uploadProgress["degree_certificate"] !== null && (
                      <span className="text-[10px] text-primary animate-pulse mt-1">Uploading scan... {uploadProgress["degree_certificate"]}%</span>
                    )}
                    {degreeUrl && (
                      <a href={degreeUrl} target="_blank" rel="noreferrer" className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5">
                        📄 View Degree Scan
                      </a>
                    )}
                  </div>

                  {/* Required: Academic Transcript */}
                  <div className="flex flex-col gap-1.5 border border-border/40 p-3 rounded-lg bg-secondary/10">
                    <div className="flex justify-between items-center text-xs font-bold uppercase text-muted-foreground">
                      <span>Academic Transcript *</span>
                      {transcriptUrl ? <Badge variant="success">Uploaded</Badge> : <Badge variant="danger">Required</Badge>}
                    </div>
                    {isEditable && (
                      <input 
                        type="file" 
                        accept="application/pdf,image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("transcript", file);
                        }}
                        disabled={uploadProgress["transcript"] !== null}
                        className="text-xs mt-1 text-muted-foreground file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                      />
                    )}
                    {uploadProgress["transcript"] !== null && (
                      <span className="text-[10px] text-primary animate-pulse mt-1">Uploading scan... {uploadProgress["transcript"]}%</span>
                    )}
                    {transcriptUrl && (
                      <a href={transcriptUrl} target="_blank" rel="noreferrer" className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5">
                        📊 View Transcript Scan
                      </a>
                    )}
                  </div>

                  {/* Optional: CV */}
                  <div className="flex flex-col gap-1.5 border border-border/40 p-3 rounded-lg bg-secondary/10">
                    <div className="flex justify-between items-center text-xs font-bold uppercase text-muted-foreground">
                      <span>Curriculum Vitae (CV)</span>
                      {cvUrl ? <Badge variant="success">Uploaded</Badge> : <Badge variant="secondary">Optional</Badge>}
                    </div>
                    {isEditable && (
                      <input 
                        type="file" 
                        accept="application/pdf,image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("cv", file);
                        }}
                        disabled={uploadProgress["cv"] !== null}
                        className="text-xs mt-1 text-muted-foreground file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                      />
                    )}
                    {uploadProgress["cv"] !== null && (
                      <span className="text-[10px] text-primary animate-pulse mt-1">Uploading scan... {uploadProgress["cv"]}%</span>
                    )}
                    {cvUrl && (
                      <a href={cvUrl} target="_blank" rel="noreferrer" className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5">
                        📄 View Uploaded CV
                      </a>
                    )}
                  </div>

                  {/* Optional: Professional Certifications */}
                  <div className="flex flex-col gap-1.5 border border-border/40 p-3 rounded-lg bg-secondary/10">
                    <div className="flex justify-between items-center text-xs font-bold uppercase text-muted-foreground">
                      <span>Certifications</span>
                      {certificationsUrl ? <Badge variant="success">Uploaded</Badge> : <Badge variant="secondary">Optional</Badge>}
                    </div>
                    {isEditable && (
                      <input 
                        type="file" 
                        accept="application/pdf,image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("certifications", file);
                        }}
                        disabled={uploadProgress["certifications"] !== null}
                        className="text-xs mt-1 text-muted-foreground file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                      />
                    )}
                    {uploadProgress["certifications"] !== null && (
                      <span className="text-[10px] text-primary animate-pulse mt-1">Uploading scan... {uploadProgress["certifications"]}%</span>
                    )}
                    {certificationsUrl && (
                      <a href={certificationsUrl} target="_blank" rel="noreferrer" className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5">
                        📄 View Certifications
                      </a>
                    )}
                  </div>

                  {/* Optional: Publications */}
                  <div className="flex flex-col gap-1.5 border border-border/40 p-3 rounded-lg bg-secondary/10">
                    <div className="flex justify-between items-center text-xs font-bold uppercase text-muted-foreground">
                      <span>Publications List</span>
                      {publicationsUrl ? <Badge variant="success">Uploaded</Badge> : <Badge variant="secondary">Optional</Badge>}
                    </div>
                    {isEditable && (
                      <input 
                        type="file" 
                        accept="application/pdf,image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("publications", file);
                        }}
                        disabled={uploadProgress["publications"] !== null}
                        className="text-xs mt-1 text-muted-foreground file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                      />
                    )}
                    {uploadProgress["publications"] !== null && (
                      <span className="text-[10px] text-primary animate-pulse mt-1">Uploading scan... {uploadProgress["publications"]}%</span>
                    )}
                    {publicationsUrl && (
                      <a href={publicationsUrl} target="_blank" rel="noreferrer" className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5">
                        📄 View Publications Document
                      </a>
                    )}
                  </div>

                  {/* Optional: Supporting Academic Documents */}
                  <div className="flex flex-col gap-1.5 border border-border/40 p-3 rounded-lg bg-secondary/10">
                    <div className="flex justify-between items-center text-xs font-bold uppercase text-muted-foreground">
                      <span>Supporting Academic Files</span>
                      {supportingDocsUrl ? <Badge variant="success">Uploaded</Badge> : <Badge variant="secondary">Optional</Badge>}
                    </div>
                    {isEditable && (
                      <input 
                        type="file" 
                        accept="application/pdf,image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("supporting_docs", file);
                        }}
                        disabled={uploadProgress["supporting_docs"] !== null}
                        className="text-xs mt-1 text-muted-foreground file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                      />
                    )}
                    {uploadProgress["supporting_docs"] !== null && (
                      <span className="text-[10px] text-primary animate-pulse mt-1">Uploading scan... {uploadProgress["supporting_docs"]}%</span>
                    )}
                    {supportingDocsUrl && (
                      <a href={supportingDocsUrl} target="_blank" rel="noreferrer" className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5">
                        📄 View Supporting Documents
                      </a>
                    )}
                  </div>

                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 border-t border-border/25 bg-secondary/10 pt-4">
                <Button 
                  variant="primary" 
                  type="submit" 
                  isLoading={saving} 
                  disabled={!isEditable || completenessScore < 100}
                  className="font-bold uppercase tracking-wider text-xs shadow-md bg-primary disabled:opacity-50"
                >
                  Submit Credentials For Review
                </Button>
              </CardFooter>
            </Card>
          </form>
        </div>
      </div>
    </div>
  );
}
