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
import { AuthorizedFileLink } from "@/components/ui/AuthorizedFileLink";
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

const PLACEHOLDER_VALS = new Set(["confidential", "academic department", "n/a", "none", ""]);

function cleanFieldValue(val?: string | null): string {
  if (!val || typeof val !== "string") return "";
  return PLACEHOLDER_VALS.has(val.trim().toLowerCase()) ? "" : val.trim();
}

const ALLOWED_DOCUMENT_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const ALLOWED_DOCUMENT_EXTS = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);

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
  const [uploadProgress, setUploadProgress] = useState<Record<string, number | null>>({
    degree_certificate: null,
    transcript: null,
    cv: null,
    certifications: null,
    publications: null,
    supporting_docs: null,
  });

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

    if (profile && profile.role === "admin") {
      router.replace("/admin?tab=verifications");
      return;
    }

    if (profile) {
      setFullName(profile.displayName || "");
      if (profile.academic) {
        setPhone(cleanFieldValue(profile.academic.phone));
        setUniversity(cleanFieldValue(profile.academic.university));
        setFaculty(cleanFieldValue(profile.academic.faculty));
        setMajor(cleanFieldValue(profile.academic.major));
        setYearOfStudy(cleanFieldValue(profile.academic.yearOfStudy));
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

    // Validate file type and size before uploading
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const mime = (file.type || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_DOCUMENT_EXTS.has(ext) || (mime && !ALLOWED_DOCUMENT_MIMES.has(mime))) {
      setError(
        `Invalid file type for ${docType.replace("_", " ")}. Allowed formats: PDF (.pdf) or images (.png, .jpg, .jpeg, .webp).`
      );
      return;
    }
    if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
      setError(`File size for ${docType.replace("_", " ")} must be between 1 KB and 20 MB.`);
      return;
    }

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

    if (profile.verificationStatus === "pending_review" || profile.verificationStatus === "under_review") {
      setError("You already have an active writer application under administrative review.");
      return;
    }

    const { score, missing } = calculateCompleteness();
    if (score < 100) {
      setError(`Cannot submit writer application. Please complete all required personal, academic, and document fields. Missing: ${missing.join(", ")}`);
      return;
    }

    setSaving(true);
    try {
      const isResubmission =
        profile.verificationStatus === "clarification_required" || profile.verificationStatus === "rejected";

      try {
        await userService.applyForWriter({
          fullName: fullName.trim(),
          phone: phone.trim(),
          university,
          faculty,
          major,
          yearOfStudy,
          degreeLevel: yearOfStudy,
          subjects: selectedSpecs,
          bio: bio.trim(),
          degreeCertificateUrl: degreeUrl,
          transcriptUrl: transcriptUrl,
          cvUrl: cvUrl || undefined,
          certificationsUrl: certificationsUrl || undefined,
          publicationsUrl: publicationsUrl || undefined,
          supportingDocsUrl: supportingDocsUrl || undefined,
          allowResubmit: isResubmission,
        });
      } catch (apiErr: any) {
        // If backend throws 409 duplicate active application, surface it directly
        if (apiErr?.status === 409 || apiErr?.status === 400) {
          throw apiErr;
        }
        // Offline / local emulator fallback: update only non-protected fields permitted by firestore.rules
        const timestamp = new Date().toISOString();
        await userService.updateUserProfile(profile.uid, {
          displayName: fullName.trim(),
          writerInterest: true,
          verificationStatus: "pending_review",
          profileCompletion: score,
          competencies: selectedSpecs,
          subjectExpertise: selectedSpecs,
          degreeLevel: yearOfStudy,
          submissionDate: timestamp,
          academic: {
            phone: phone.trim(),
            university,
            faculty,
            major,
            yearOfStudy,
            bio: bio.trim(),
            specializations: selectedSpecs,
            documents: {
              degreeCertificateUrl: degreeUrl,
              transcriptUrl: transcriptUrl,
              cvUrl,
              certificationsUrl,
              publicationsUrl,
              supportingDocsUrl,
            },
          },
        });
      }

      await refreshProfile();
      setSuccessMsg(
        "Your writer application and credentials have been submitted for administrative review. Your account remains a Customer account until approved by an administrator."
      );
    } catch (err: any) {
      setError(err?.message || "Failed to submit writer application credentials.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetRejection = async () => {
    setSaving(true);
    try {
      await userService.updateUserProfile(profile.uid, {
        verificationStatus: "draft",
      });
      await refreshProfile();
    } catch (err: any) {
      setError(err?.message || "Failed to reset application form.");
    } finally {
      setSaving(false);
    }
  };

  const status = profile.verificationStatus || "draft";
  const isPending = status === "pending_review";
  const isUnderReview = status === "under_review";
  const isApproved = status === "approved" && profile.writerStatus === "active" && profile.isVerifiedWriter === true;
  const isRejected = status === "rejected";
  const isClarification = status === "clarification_required";
  const isNotApplied = status === "draft" || status === "incomplete";
  const isEditable = isNotApplied || isClarification || isRejected;

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
                  <h3 className="text-lg font-black text-foreground">Pending Review</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Your writer application and academic scans have been submitted and are in the administrator review queue.
                  </p>
                  <Badge variant="warning" className="uppercase font-mono text-[9px] font-bold">Pending Review</Badge>
                </>
              )}

              {isUnderReview && (
                <>
                  <div className="w-16 h-16 rounded-full bg-info/15 flex items-center justify-center text-3xl text-info animate-pulse">🔍</div>
                  <h3 className="text-lg font-black text-foreground">Under Review</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    An administrator is actively auditing your submitted academic credentials and supporting documents.
                  </p>
                  <Badge variant="info" className="uppercase font-mono text-[9px] font-bold">Under Review</Badge>
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
                  <h3 className="text-lg font-black text-foreground">Application Rejected</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    We were unable to approve your credentials. Your customer account remains active. You may review feedback, edit details, and re-upload documents.
                  </p>
                  <Badge variant="danger" className="uppercase font-mono text-[9px] font-bold">Rejected</Badge>
                </>
              )}

              {isNotApplied && (
                <>
                  <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-3xl text-muted-foreground">📝</div>
                  <h3 className="text-lg font-black text-foreground">Not Applied</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Complete all required personal & academic details and upload your official degree certificate & transcript to apply as a DataBoy writer.
                  </p>
                  <Badge variant="secondary" className="uppercase font-mono text-[9px] font-bold">Not Applied</Badge>
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
                    options={[{ value: "", label: "Select University / College" }, ...UNIVERSITIES]}
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    required
                    disabled={!isEditable}
                  />

                  <Select
                    label="Faculty / Department"
                    options={[{ value: "", label: "Select Faculty / Department" }, ...FACULTIES]}
                    value={faculty}
                    onChange={(e) => setFaculty(e.target.value)}
                    required
                    disabled={!isEditable}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Degree Major / Program"
                    options={[{ value: "", label: faculty ? "Select Degree Major" : "Select Faculty First" }, ...activeMajors]}
                    value={major}
                    onChange={(e) => setMajor(e.target.value)}
                    required
                    disabled={!isEditable || !faculty}
                  />

                  <Select
                    label="Study / Graduation Year"
                    options={[{ value: "", label: "Select Year of Study" }, ...YEARS_OF_STUDY]}
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
                      <AuthorizedFileLink fileRef={{ url: degreeUrl }} className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5 text-left cursor-pointer">
                        📄 View Degree Scan
                      </AuthorizedFileLink>
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
                      <AuthorizedFileLink fileRef={{ url: transcriptUrl }} className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5 text-left cursor-pointer">
                        📊 View Transcript Scan
                      </AuthorizedFileLink>
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
                      <AuthorizedFileLink fileRef={{ url: cvUrl }} className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5 text-left cursor-pointer">
                        📄 View Uploaded CV
                      </AuthorizedFileLink>
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
                      <AuthorizedFileLink fileRef={{ url: certificationsUrl }} className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5 text-left cursor-pointer">
                        📄 View Certifications
                      </AuthorizedFileLink>
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
                      <AuthorizedFileLink fileRef={{ url: publicationsUrl }} className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5 text-left cursor-pointer">
                        📄 View Publications Document
                      </AuthorizedFileLink>
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
                      <AuthorizedFileLink fileRef={{ url: supportingDocsUrl }} className="text-xs text-primary font-semibold hover:underline mt-2 flex items-center gap-1.5 text-left cursor-pointer">
                        📄 View Supporting Documents
                      </AuthorizedFileLink>
                    )}
                  </div>

                </div>
              </CardContent>
              <CardFooter className="flex justify-between items-center flex-wrap gap-3 border-t border-border/25 bg-secondary/10 pt-4">
                <span className="text-xs text-muted-foreground">
                  {isPending || isUnderReview
                    ? "Your application is locked while under administrative review."
                    : isApproved
                    ? "Your writer account is approved and active."
                    : "Complete all 10 required items (100%) to enable submission."}
                </span>
                <Button 
                  variant="primary" 
                  type="submit" 
                  isLoading={saving} 
                  disabled={!isEditable || completenessScore < 100}
                  className="font-bold uppercase tracking-wider text-xs shadow-md bg-primary disabled:opacity-50"
                >
                  {isPending || isUnderReview
                    ? "Application Under Review"
                    : isApproved
                    ? "Application Approved"
                    : "Submit Writer Application"}
                </Button>
              </CardFooter>
            </Card>
          </form>
        </div>
      </div>
    </div>
  );
}
