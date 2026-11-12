"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { projectService } from "@/services/projectService";
import { auditService } from "@/services/auditService";
import { adminService } from "@/services/adminService";
import { allocationService } from "@/services/allocationService";
import { notificationService } from "@/services/notificationService";
import { storageService } from "@/services/storageService";
import { AuthorizedFileLink } from "@/components/ui/AuthorizedFileLink";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Textarea } from "@/components/ui/Input";
import { Loader } from "@/components/ui/Loader";
import { BackButton } from "@/components/ui/BackButton";
import { Modal } from "@/components/ui/Modal";
import MobileMoneyCheckoutModal from "@/components/payment/MobileMoneyCheckoutModal";
import { Project, ProjectStatus, ProjectActivity, PayoutStatus, UserProfile } from "@/types/domain";
import { PROJECT_TYPES, ACADEMIC_LEVELS } from "@/utils/lookups";

// Mock Fallbacks for manual local testing if Firestore data hasn't been seeded yet
const MOCK_PROJECTS: Record<string, Partial<Project>> = {
  "PRJ-8001": {
    id: "PRJ-8001",
    title: "Comparative Study of Transformer Architectures",
    projectType: "research_support",
    deadline: "2026-06-15",
    budget: 250.00,
    status: "unassigned",
    payoutStatus: "pending",
    customerId: "customer-1",
    writerId: null,
    proofreaderId: null,
    guidelines: "Draft a 15-page comparative analysis exploring the parameter efficiency and memory footprint differences between standard multi-head self-attention and Grouped-Query Attention (GQA). Enforce LaTeX equation syntax for all formalisms.",
    files: []
  },
  "PRJ-8002": {
    id: "PRJ-8002",
    title: "Organic Synthesis & Diels-Alder Lab Report",
    projectType: "data_analysis",
    deadline: "2026-06-08",
    budget: 120.00,
    status: "in_progress",
    payoutStatus: "escrowed",
    customerId: "customer-1",
    writerId: "writer-1",
    proofreaderId: null,
    guidelines: "Provide full mechanical steps of Diels-Alder reaction between anthracene and maleic anhydride. Include yield calculations, melting point analysis, and infrared spectroscopy peaks identification.",
    files: []
  }
};

function ProjectDetailsContent() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("id") || "";

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOcrAudit, setShowOcrAudit] = useState(false);
  const [showEscrowModal, setShowEscrowModal] = useState(false);

  // Revision & Dispute Modal states (Phase 4)
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionExplanation, setRevisionExplanation] = useState("");
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);

  const [showCustomerDisputeModal, setShowCustomerDisputeModal] = useState(false);
  const [customerDisputeReason, setCustomerDisputeReason] = useState("");
  const [customerDisputeDetails, setCustomerDisputeDetails] = useState("");
  const [customerDisputeEvidence, setCustomerDisputeEvidence] = useState<any[]>([]);
  const [isUploadingDisputeFile, setIsUploadingDisputeFile] = useState(false);
  const [isSubmittingCustomerDispute, setIsSubmittingCustomerDispute] = useState(false);

  // Admin governance state
  const [availableWriters, setAvailableWriters] = useState<UserProfile[]>([]);
  const [selectedWriter, setSelectedWriter] = useState("");
  const [isAssigningWriter, setIsAssigningWriter] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [isOpeningDispute, setIsOpeningDispute] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadProjectDetails() {
      if (!projectId) {
        setError("No project ID specified in URL.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        // 1. Fetch live document
        const liveProj = await projectService.getProject(projectId);
        if (liveProj) {
          setProject(liveProj);
          const logs = await auditService.getProjectActivity(projectId);
          setActivities(logs);
        } else if (MOCK_PROJECTS[projectId]) {
          // Fallback to high-fidelity mocks
          setProject(MOCK_PROJECTS[projectId] as Project);
          setActivities([
            {
              id: "act-mock-1",
              type: "system_alert",
              actorId: "customer-1",
              actorName: "System",
              actorRole: "admin",
              message: "Platform matched sandbox channel: [Academic Support].",
              createdAt: new Date().toISOString()
            }
          ]);
        } else {
          setError(`Project ID [${projectId}] could not be found.`);
        }
      } catch (err: any) {
        console.error("Error loading project:", err);
        setError("Database read error. Please verify your connection.");
      } finally {
        setLoading(false);
      }
    }

    loadProjectDetails();
  }, [projectId]);

  // Load verified writers for admin assignment
  useEffect(() => {
    if (profile?.role === "admin" && project && project.status === "unassigned") {
      adminService.listVerifiedWriters().then(writers => {
        // Score writers by subject relevance if project has specialInstructions or type
        const scored = writers.map(w => ({
          ...w,
          _score: (w.reputation || 5) * 10 + (w.completedCount || 0)
        }));
        scored.sort((a: any, b: any) => b._score - a._score);
        setAvailableWriters(scored);
      }).catch(console.error);
    }
  }, [profile, project]);

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !project || !profile) return;

    setPostingComment(true);
    try {
      await auditService.logComment(project.id, profile, commentText);
      const logs = await auditService.getProjectActivity(project.id);
      setActivities(logs);
      setCommentText("");
    } catch (err: any) {
      alert(`Failed to post message: ${err?.message}`);
    } finally {
      setPostingComment(false);
    }
  };

  const handleAdminAssignWriter = async () => {
    if (!project || !profile || !selectedWriter) return;
    setIsAssigningWriter(true);
    try {
      await projectService.transitionProjectStatus(project.id, "assigned", profile, {
        writerId: selectedWriter
      });
      await adminService.logPlatformAudit(
        profile,
        "WRITER_ASSIGNED",
        project.id,
        "assignment",
        `Admin assigned writer [${selectedWriter}] to project [${project.id}]`
      );
      setAdminSuccess(`Writer successfully assigned to project.`);
      const updated = await projectService.getProject(project.id);
      if (updated) {
        setProject(updated);
        const logs = await auditService.getProjectActivity(project.id);
        setActivities(logs);
      }
    } catch (err: any) {
      alert(err?.message || "Writer assignment failed.");
    } finally {
      setIsAssigningWriter(false);
    }
  };

  const handleAdminForceStatus = async (next: ProjectStatus, label: string) => {
    if (!project || !profile) return;
    if (!confirm(`Force project status to "${label}"? This bypasses normal workflow validation.`)) return;
    setIsTransitioning(true);
    try {
      await projectService.transitionProjectStatus(project.id, next, profile);
      await adminService.logPlatformAudit(
        profile,
        "STATUS_FORCED",
        project.id,
        "assignment",
        `Admin forced project [${project.id}] status to [${next}]`
      );
      setAdminSuccess(`Project status updated to ${label}.`);
      const updated = await projectService.getProject(project.id);
      if (updated) setProject(updated);
      const logs = await auditService.getProjectActivity(project.id);
      setActivities(logs);
    } catch (err: any) {
      alert(err?.message || "Status transition failed.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleAdminOpenDispute = async () => {
    if (!project || !profile || !disputeReason.trim()) return;
    setIsOpeningDispute(true);
    try {
      await adminService.createDispute(
        {
          relatedType: "assignment",
          relatedId: project.id,
          studentId: project.customerId,
          writerId: project.writerId || "",
          reason: disputeReason,
          status: "open"
        },
        profile
      );
      setDisputeReason("");
      setAdminSuccess("Dispute opened and logged in the platform audit trail.");
    } catch (err: any) {
      alert(err?.message || "Failed to open dispute.");
    } finally {
      setIsOpeningDispute(false);
    }
  };

  // Customer revision request
  const handleCustomerRequestRevision = async () => {
    if (!project || !revisionExplanation.trim()) return;
    setIsSubmittingRevision(true);
    try {
      await projectService.requestRevision(project.id, revisionExplanation.trim());
      setShowRevisionModal(false);
      setRevisionExplanation("");
      setAdminSuccess("Revision request submitted successfully to the writer.");
      const updated = await projectService.getProject(project.id);
      if (updated) setProject(updated);
    } catch (e: any) {
      alert("Failed to submit revision: " + (e?.message || e));
    } finally {
      setIsSubmittingRevision(false);
    }
  };

  // Customer dispute evidence upload to R2
  const handleUploadDisputeEvidence = async (file: File) => {
    if (!project) return;
    setIsUploadingDisputeFile(true);
    try {
      const uploaded = await storageService.uploadFile("dispute", project.id, file);
      setCustomerDisputeEvidence((prev) => [
        ...prev,
        {
          fileId: uploaded.fileId,
          storageKey: uploaded.storageKey,
          name: uploaded.fileName,
          url: uploaded.url,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
        },
      ]);
    } catch (e: any) {
      alert("Failed to upload dispute evidence: " + (e?.message || e));
    } finally {
      setIsUploadingDisputeFile(false);
    }
  };

  // Customer dispute submission
  const handleCustomerRaiseDispute = async () => {
    if (!project || !customerDisputeReason.trim()) return;
    setIsSubmittingCustomerDispute(true);
    try {
      await projectService.raiseDispute(
        project.id,
        customerDisputeReason.trim(),
        customerDisputeDetails.trim(),
        customerDisputeEvidence
      );
      setShowCustomerDisputeModal(false);
      setCustomerDisputeReason("");
      setCustomerDisputeDetails("");
      setCustomerDisputeEvidence([]);
      setAdminSuccess("Dispute raised. Platform administrators have been notified.");
      const updated = await projectService.getProject(project.id);
      if (updated) setProject(updated);
    } catch (e: any) {
      alert("Failed to raise dispute: " + (e?.message || e));
    } finally {
      setIsSubmittingCustomerDispute(false);
    }
  };

  // Download latest authorized deliverable / workspace draft from R2
  const handleDownloadWorkspaceDrafts = async () => {
    if (!project) return;
    const raw = project as any;
    const draftDeliverable = raw.draftDeliverable || {};
    const targetRef = raw.finalFileUrl
      ? { url: raw.finalFileUrl, fileId: raw.proofreadFileId, storageKey: raw.proofreadStorageKey }
      : raw.proofreadDocumentUrl
      ? { url: raw.proofreadDocumentUrl, fileId: raw.proofreadFileId, storageKey: raw.proofreadStorageKey }
      : draftDeliverable.fileId || draftDeliverable.storageKey || draftDeliverable.url
      ? { fileId: draftDeliverable.fileId, storageKey: draftDeliverable.storageKey, url: draftDeliverable.url }
      : project.files && project.files.length > 0
      ? project.files[0]
      : null;

    if (!targetRef) {
      alert("No workspace deliverable or source document has been uploaded yet.");
      return;
    }

    try {
      await storageService.openAuthorizedFile(targetRef);
    } catch (e: any) {
      alert("Failed to authorize download: " + (e?.message || e));
    }
  };

  // Admin: trigger allocation engine
  const handleTriggerAllocation = async () => {
    if (!project || !profile) return;
    setIsTransitioning(true);
    try {
      const result = await allocationService.triggerAllocation(project, profile);
      setAdminSuccess(result.message);
      const updated = await projectService.getProject(project.id);
      if (updated) setProject(updated);
    } catch (err: any) {
      alert(err?.message || "Allocation failed.");
    } finally {
      setIsTransitioning(false);
    }
  };

  // Admin: check & escalate timeout
  const handleCheckTimeout = async () => {
    if (!project || !profile) return;
    setIsTransitioning(true);
    try {
      const result = await allocationService.checkAndEscalateTimeout(project, profile);
      setAdminSuccess(result.message);
      const updated = await projectService.getProject(project.id);
      if (updated) setProject(updated);
    } catch (err: any) {
      alert(err?.message || "Timeout check failed.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const getStatusBadge = (status: ProjectStatus) => {
    switch (status) {
      case "draft":
        return <Badge variant="secondary">Draft</Badge>;
      case "unassigned":
        return <Badge variant="primary">Pending Claim</Badge>;
      case "assigned":
      case "in_progress":
        return <Badge variant="warning">In Progress</Badge>;
      case "draft_submitted":
        return <Badge variant="info">Draft Submitted</Badge>;
      case "under_review":
        return <Badge variant="info">Under Review</Badge>;
      case "review_rejected":
        return <Badge variant="warning">Changes Requested</Badge>;
      case "completed":
        return <Badge variant="success">Completed</Badge>;
      case "disputed":
        return <Badge variant="danger">Disputed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getProjectTypeLabel = (val?: string) => {
    return PROJECT_TYPES.find(p => p.value === val)?.label || val || "Other Services";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader size="lg" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-col gap-6 max-w-2xl mx-auto">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
        <Alert variant="error" title="Project Not Found">
          {error || "An unexpected error occurred while loading this project."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      
      {/* Back to Dashboard */}
      <div className="flex items-center">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
      </div>

      {(project.escrowStatus === "held" || project.status === "funded" || project.paymentStatus === "funded") && (
        <Alert variant="success" title="Escrow Secured via Mobile Money">
          🛡️ <strong>Payment Secured & Held in Escrow</strong>: <strong>K{project.budget?.toFixed(2)} ZMW</strong>. Funds remain protected until final delivery is approved.
          {project.paymentReference && <span className="ml-2 font-mono text-xs">Ref: {project.paymentReference}</span>}
          {project.paymentNetwork && <span className="ml-2 uppercase text-xs font-bold">({project.paymentNetwork.replace("_", " ")})</span>}
        </Alert>
      )}

      {/* Zambian Mobile Money Checkout Modal via Lipila */}
      <MobileMoneyCheckoutModal
        isOpen={showEscrowModal}
        onClose={() => setShowEscrowModal(false)}
        assignmentId={project.id}
        assignmentTitle={project.title}
        amount={project.budget}
        onSuccess={async () => {
          setAdminSuccess("Lipila Mobile Money payment confirmed! Escrow funds secured.");
          const updated = await projectService.getProject(project.id);
          if (updated) setProject(updated);
        }}
      />

      {/* Revision request modal for customer */}
      <Modal
        isOpen={showRevisionModal}
        onClose={() => setShowRevisionModal(false)}
        title="Request Revisions"
        footerActions={
          <>
            <Button variant="outline" onClick={() => setShowRevisionModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleCustomerRequestRevision}
              isLoading={isSubmittingRevision}
              disabled={!revisionExplanation.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
            >
              Submit Revision Request
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Describe what modifications or clarifications are required from the assigned writer.
          </p>
          <Textarea
            rows={4}
            placeholder="Specify section-by-section improvements, references to fix, or structural changes..."
            value={revisionExplanation}
            onChange={(e) => setRevisionExplanation(e.target.value)}
          />
        </div>
      </Modal>

      {/* Dispute modal for customer */}
      <Modal
        isOpen={showCustomerDisputeModal}
        onClose={() => setShowCustomerDisputeModal(false)}
        title="Raise Dispute Flag"
        footerActions={
          <>
            <Button variant="outline" onClick={() => setShowCustomerDisputeModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={handleCustomerRaiseDispute}
              isLoading={isSubmittingCustomerDispute}
              disabled={!customerDisputeReason.trim()}
              className="font-bold"
            >
              Raise Dispute
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Alert variant="warning" title="Dispute Mediation">
            Raising a dispute will pause automatic releases and flag this project for administrative arbitration.
          </Alert>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-foreground">Dispute Reason</label>
            <Textarea
              rows={2}
              placeholder="e.g. Incomplete submission, missed deadline, failed instructions..."
              value={customerDisputeReason}
              onChange={(e) => setCustomerDisputeReason(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-foreground">Supporting Details</label>
            <Textarea
              rows={3}
              placeholder="Provide evidence or context for administrator review..."
              value={customerDisputeDetails}
              onChange={(e) => setCustomerDisputeDetails(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-foreground">Attach Evidence Document (Optional)</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp"
              disabled={isUploadingDisputeFile}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadDisputeEvidence(file);
              }}
              className="text-xs text-muted-foreground file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
            />
            {isUploadingDisputeFile && (
              <span className="text-[11px] text-primary">Uploading evidence to private R2 storage...</span>
            )}
            {customerDisputeEvidence.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {customerDisputeEvidence.map((ev, idx) => (
                  <span key={ev.fileId || idx} className="text-[11px] font-mono text-success">
                    Attached: {ev.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Header Panel Card */}
      <Card className="border-primary/10">
        <CardContent className="pt-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="primary" className="font-mono text-xs">{project.id}</Badge>
              {getStatusBadge(project.status)}
              {project.escrowMode === "simulated" && (
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  🧪 Test Escrow
                </span>
              )}
              {project.allocationStatus && project.allocationStatus !== "pending" && (
                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                  project.allocationStatus === "offered" ? "text-amber-600 bg-amber-500/10 border-amber-500/20" :
                  project.allocationStatus === "accepted" ? "text-success bg-success/10 border-success/20" :
                  project.allocationStatus === "pool" ? "text-primary bg-primary/10 border-primary/20" :
                  "text-muted-foreground bg-secondary/30 border-border/20"
                }`}>
                  Allocation: {project.allocationStatus}
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-foreground mt-1">
              {project.title}
            </h1>
            <p className="text-xs text-muted-foreground">
              Created • Type: <strong className="text-foreground">{getProjectTypeLabel(project.projectType)}</strong>
              {project.academicLevel && (
                <> • Level: <strong className="text-foreground">{ACADEMIC_LEVELS.find(l => l.value === project.academicLevel)?.label || project.academicLevel}</strong></>
              )}
            </p>
          </div>
          
          <div className="flex flex-col md:items-end gap-2 shrink-0">
            <span className="text-3xl font-black text-foreground">K{project.budget.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">
              Escrow Balance • <span className={`font-bold uppercase ${
                project.escrowStatus === "funded" ? "text-success" :
                project.escrowStatus === "released" ? "text-primary" :
                project.escrowStatus === "refunded" ? "text-danger" :
                "text-muted-foreground"
              }`}>{project.escrowStatus || project.payoutStatus}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Detail Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Scope & Collaboration (2/3 width) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* Scope guidelines */}
          <Card>
            <CardHeader>
              <CardTitle>Detailed Project Guidelines & Deliverables</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {project.guidelines}
              </p>
            </CardContent>
          </Card>

          {/* Brief Documents (Revision 7) */}
          {project.files && project.files.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Assignment Source Documents</CardTitle>
                <CardDescription>Original uploaded briefs and instruction files</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                {project.files.map((file: any) => (
                  <AuthorizedFileLink
                    key={file.uid}
                    fileRef={file}
                    className="text-primary hover:underline font-bold font-mono text-xs flex items-center gap-1.5 text-left cursor-pointer"
                  >
                    📄 {file.name} ({(file.sizeBytes / 1024 / 1024).toFixed(2)} MB)
                  </AuthorizedFileLink>
                ))}
              </CardContent>
            </Card>
          )}

          {/* OCR Raw Text Audit Panel (Revision 6) */}
          {(profile?.role === "admin" || profile?.role === "writer" || profile?.role === "proofreader") && project.ocrText && (
            <Card>
              <CardHeader className="cursor-pointer" onClick={() => setShowOcrAudit(!showOcrAudit)}>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    🔎 OCR Raw Text Audit Log (Administration & Writers Only)
                  </CardTitle>
                  <span className="text-xs font-bold text-primary">{showOcrAudit ? "Hide" : "Show"}</span>
                </div>
              </CardHeader>
              {showOcrAudit && (
                <CardContent className="pt-2">
                  <pre className="p-3 bg-secondary/35 rounded-lg border border-border/30 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                    {project.ocrText}
                  </pre>
                </CardContent>
              )}
            </Card>
          )}

          {/* Real-time Collaboration Feed */}
          <Card>
            <CardHeader>
              <CardTitle>Project Activity Feed</CardTitle>
              <CardDescription>Audited collaboration timeline logs</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              
              {/* Comment submission form */}
              <form onSubmit={handlePostComment} className="flex flex-col gap-3">
                <Textarea
                  placeholder="Share deliverable updates, scope clarifications, or revision instructions..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                  required
                />
                <div className="flex justify-end">
                  <Button variant="primary" type="submit" isLoading={postingComment} size="sm">
                    Post Message
                  </Button>
                </div>
              </form>

              {/* Feed Stream */}
              <div className="flex flex-col gap-4 divide-y divide-border/30">
                {activities.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No activity logged in this channel yet.</p>
                ) : (
                  activities.map((comm) => (
                    <div key={comm.id} className="flex flex-col gap-1.5 pt-4 first:pt-0">
                      <div className="flex justify-between items-center text-xs">
                        <strong className="text-foreground">
                          {comm.actorName} ({comm.actorRole === "customer" ? "STUDENT" : comm.actorRole.toUpperCase()})
                        </strong>
                        <span className="text-muted-foreground">{new Date(comm.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-foreground/80 leading-relaxed bg-muted/20 p-3 rounded-lg border border-border/20">
                        {comm.message}
                      </p>
                    </div>
                  ))
                )}
              </div>

            </CardContent>
          </Card>

        </div>

        {/* Right Side: Metadata Panel (1/3 width) */}
        <div className="flex flex-col gap-6">
          
          {/* Timeline & Roles */}
          <Card>
            <CardHeader>
              <CardTitle>Project Participants</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 border-b border-border/40 pb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assigned Writer</span>
                <span className="text-sm font-bold text-foreground">
                  ✍️ {project.writerId ? `Expert ID: ${project.writerId}` : "Unassigned"}
                </span>
                {project.currentOfferWriterId && project.allocationStatus === "offered" && (
                  <span className="text-[10px] text-amber-600 font-semibold">
                    ⏳ Offer pending: {project.currentOfferWriterId.slice(0, 12)}...
                    {project.offerExpiresAt && ` (expires ${new Date(project.offerExpiresAt).toLocaleTimeString()})`}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5 border-b border-border/40 pb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assigned Quality Reviewer</span>
                <span className="text-sm font-bold text-foreground">
                  🔬 {project.proofreaderId ? `Expert ID: ${project.proofreaderId}` : "Unassigned"}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 border-b border-border/40 pb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Escrow Payout Status</span>
                <span className={`text-sm font-bold uppercase font-mono ${
                  project.escrowStatus === "funded" ? "text-success" :
                  project.escrowStatus === "released" ? "text-primary" :
                  project.escrowStatus === "refunded" ? "text-danger" :
                  "text-muted-foreground"
                }`}>
                  💰 {project.escrowStatus || project.payoutStatus}
                  {project.escrowMode === "simulated" && <span className="text-[9px] ml-1 text-amber-600">(TEST)</span>}
                </span>
              </div>
              {project.pricingBreakdown && (
                <div className="flex flex-col gap-1 pt-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pricing Breakdown</span>
                  <div className="text-xs flex flex-col gap-1 mt-1 bg-secondary/20 rounded-lg p-2.5 border border-border/20">
                    <div className="flex justify-between"><span className="text-muted-foreground">Pages</span><span className="font-bold">{project.pricingBreakdown.pages}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Level</span><span className="font-bold">{project.pricingBreakdown.academicLevel}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Base/Page</span><span className="font-bold">K{project.pricingBreakdown.baseRatePerPage}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Urgency</span><span className="font-bold">{project.pricingBreakdown.urgencyBand}</span></div>
                    <div className="flex justify-between border-t border-border/20 pt-1 mt-0.5"><span className="font-semibold text-foreground">Total</span><span className="font-black text-success">K{project.pricingBreakdown.total}</span></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* STUDENT ESCROW FUNDING CARD */}
          {profile?.role === "customer" && 
           (project.status === "awaiting_payment" || project.status === "draft" || project.status === "priced") && (
            <Card className="border-emerald-500/30 bg-emerald-500/5 shadow-md">
              <CardHeader className="border-b border-emerald-500/10 bg-emerald-500/10">
                <CardTitle className="text-emerald-700 dark:text-emerald-400">📱 Mobile Money Escrow Payment</CardTitle>
                <CardDescription className="text-emerald-800/80 dark:text-emerald-300/80">
                  Fund this project with Airtel Money, MTN Mobile Money, or Zamtel Kwacha.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-3">
                <p className="text-xs text-foreground font-medium">
                  Authoritative Escrow Amount: <strong>K{project.budget.toFixed(2)} ZMW</strong>. Your payment is held securely in escrow until you verify the final delivery.
                </p>
                <Button 
                  variant="primary" 
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2"
                  onClick={() => setShowEscrowModal(true)}
                  isLoading={isTransitioning}
                >
                  <span>Pay with Mobile Money (Airtel / MTN / Zamtel)</span>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Action Tools */}
          <Card className="border-primary/25 bg-primary/5">
            <CardHeader>
              <CardTitle>Project Controls</CardTitle>
              <CardDescription>Status milestones</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button variant="primary" className="w-full" onClick={handleDownloadWorkspaceDrafts}>
                Download Workspace Drafts
              </Button>
              <Button
                variant="outline"
                className="w-full bg-background"
                onClick={() => setShowRevisionModal(true)}
              >
                Request Revisions
              </Button>
              <Button
                variant="ghost"
                className="w-full text-destructive hover:bg-destructive/10"
                onClick={() => setShowCustomerDisputeModal(true)}
              >
                Raise Dispute Flag
              </Button>
            </CardContent>
          </Card>

          {/* STATUS HISTORY TIMELINE */}
          {project.statusHistory && project.statusHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-xs font-bold uppercase tracking-wider">Status Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-0">
                  {project.statusHistory.map((entry, i) => (
                    <div key={i} className="flex gap-3 relative">
                      {/* Line connector */}
                      {i < project.statusHistory!.length - 1 && (
                        <div className="absolute left-[7px] top-5 bottom-0 w-[2px] bg-border/30" />
                      )}
                      <div className="w-4 h-4 rounded-full bg-primary/20 border-2 border-primary/40 shrink-0 mt-0.5" />
                      <div className="flex flex-col gap-0.5 pb-4">
                        <span className="text-xs font-bold text-foreground capitalize">{entry.status.replace(/_/g, " ")}</span>
                        <span className="text-[10px] text-muted-foreground">{entry.actorName} • {new Date(entry.timestamp).toLocaleString()}</span>
                        {entry.note && <span className="text-[10px] text-muted-foreground italic">{entry.note}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ADMIN GOVERNANCE PANEL */}
          {profile?.role === "admin" && (
            <Card className="border-danger/20 bg-danger/3">
              <CardHeader className="border-b border-danger/15">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-danger">⚙️ Admin Governance Controls</CardTitle>
                <CardDescription>Status overrides, writer assignment, dispute management, and escrow controls.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-5">

                {adminSuccess && (
                  <Alert variant="success" title="Action Completed">{adminSuccess}</Alert>
                )}

                {/* Allocation Controls */}
                {(project?.status === "unassigned" || project?.status === "awaiting_assignment" || project?.allocationStatus === "offered") && (
                  <div className="flex flex-col gap-3 border-b border-danger/10 pb-4">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Writer Allocation Engine</span>
                    {project.allocationAttempts !== undefined && (
                      <p className="text-xs text-muted-foreground">Attempts made: {project.allocationAttempts}</p>
                    )}
                    <div className="flex flex-col gap-2">
                      {(project.status === "unassigned" || project.status === "awaiting_assignment") && project.allocationStatus !== "offered" && (
                        <Button variant="primary" size="sm" className="text-xs w-full"
                          onClick={handleTriggerAllocation}
                          isLoading={isTransitioning}>
                          ▶ Trigger Writer Allocation
                        </Button>
                      )}
                      {project.allocationStatus === "offered" && (
                        <Button variant="outline" size="sm" className="text-xs w-full border-amber-400/40 text-amber-600 hover:bg-amber-500/10"
                          onClick={handleCheckTimeout}
                          isLoading={isTransitioning}>
                          ⏱ Check & Escalate Timeout
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Writer Assignment (only when unassigned or awaiting assignment) */}
                {(project?.status === "unassigned" || project?.status === "awaiting_assignment") && (
                  <div className="flex flex-col gap-3 border-b border-danger/10 pb-4">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Manually Assign Expert Writer</span>
                    <select
                      value={selectedWriter}
                      onChange={e => setSelectedWriter(e.target.value)}
                      className="w-full bg-background text-foreground border border-border/80 p-2.5 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">-- Select verified writer --</option>
                      {availableWriters.map(w => (
                        <option key={w.uid} value={w.uid}>
                          {w.displayName} — Rating: {w.reputation?.toFixed(1) || "5.0"}★ — Tasks: {w.completedCount || 0}
                        </option>
                      ))}
                    </select>
                    <Button variant="primary" size="sm" onClick={handleAdminAssignWriter}
                      isLoading={isAssigningWriter} disabled={!selectedWriter || isAssigningWriter}
                      className="w-fit text-xs font-bold">
                      ✓ Assign Writer
                    </Button>
                    {availableWriters.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">No verified writers available at this time.</p>
                    )}
                  </div>
                )}

                {/* Force Status Transitions */}
                <div className="flex flex-col gap-3 border-b border-danger/10 pb-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Force Status Override</span>
                  <div className="flex flex-col gap-2">
                    {project?.status !== "cancelled" && project?.status !== "completed" && (
                      <Button variant="outline" size="sm" className="text-xs w-full border-danger/40 text-danger hover:bg-danger/10"
                        onClick={() => handleAdminForceStatus("cancelled", "Cancelled")}
                        isLoading={isTransitioning}>
                        ✕ Force Cancel Project
                      </Button>
                    )}
                    {project?.status !== "completed" && project?.status !== "cancelled" && (
                      <Button variant="outline" size="sm" className="text-xs w-full border-success/40 text-success hover:bg-success/10"
                        onClick={() => handleAdminForceStatus("completed", "Completed")}
                        isLoading={isTransitioning}>
                        ✓ Force Mark Completed
                      </Button>
                    )}
                  </div>
                </div>

                {/* Open Dispute */}
                <div className="flex flex-col gap-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Open Dispute</span>
                  <textarea
                    className="w-full px-3.5 py-2.5 text-xs bg-background border border-border/50 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 min-h-[60px] placeholder:text-muted-foreground/50"
                    placeholder="Describe the dispute reason (e.g. plagiarism detected, deadline missed, work quality)..."
                    value={disputeReason}
                    onChange={e => setDisputeReason(e.target.value)}
                  />
                  <Button variant="danger" size="sm" className="text-xs w-fit font-bold"
                    onClick={handleAdminOpenDispute} isLoading={isOpeningDispute} disabled={!disputeReason.trim()}>
                    ⚖️ Open Dispute Ticket
                  </Button>
                </div>

              </CardContent>
            </Card>
          )}

        </div>

      </div>

    </div>
  );
}

export default function ProjectDetails() {
  return (
    <Suspense fallback={
      <Card className="shadow-lg border-border/40 p-8 flex items-center justify-center min-h-[300px] max-w-6xl mx-auto">
        <Loader size="lg" />
      </Card>
    }>
      <ProjectDetailsContent />
    </Suspense>
  );
}
