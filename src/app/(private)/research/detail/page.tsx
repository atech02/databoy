"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { researchService } from "@/services/researchService";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { BackButton } from "@/components/ui/BackButton";
import { Loader } from "@/components/ui/Loader";
import { PROJECT_TYPES } from "@/utils/lookups";
import { ResearchRequestStatus } from "@/types/domain";

// Simplified Status Trail Labels
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  submitted: { label: "Submitted", color: "info" },
  under_review: { label: "Under Review", color: "warning" },
  needs_clarification: { label: "Needs Clarification", color: "danger" },
  quote_ready: { label: "Quote Ready", color: "success" },
  awaiting_payment: { label: "Awaiting Payment", color: "warning" },
  funded: { label: "Funded (Matching Writer)", color: "success" },
  assigned: { label: "Assigned (Expert Match)", color: "success" },
  in_progress: { label: "Writing In Progress", color: "info" },
  submitted_for_review: { label: "Deliverable Draft Submitted", color: "warning" },
  revision_requested: { label: "Revision Required", color: "danger" },
  completed: { label: "Project Completed", color: "success" },
  disputed: { label: "Disputed Mediaton", color: "danger" },
  cancelled: { label: "Cancelled", color: "secondary" }
};

export default function ResearchDetail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("id");
  const { profile } = useAuth();

  // Core Request Data
  const [request, setRequest] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Clarification Thread Reply States
  const [clarificationReply, setClarificationReply] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  // Escrow Payment Checkout Modal States
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "mtn" | "airtel">("mtn");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Collaboration Comments Feed States (For active status assigned/in_progress)
  const [collabComment, setCollabComment] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [timeline, setTimeline] = useState<any[]>([]);

  // Admin and Writer details
  const [availableWriters, setAvailableWriters] = useState<any[]>([]);
  const [selectedWriter, setSelectedWriter] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);

  // Admin Custom Quote Input States
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);

  // Admin Clarification Question States
  const [clarificationQuestion, setClarificationQuestion] = useState("");
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false);

  // Load Request Details
  const loadDetails = async () => {
    if (!requestId) return;
    setLoading(true);
    try {
      const data = await researchService.getResearchRequest(requestId);
      if (data) {
        setRequest(data);
        if (profile?.academic?.phone) {
          setPhoneNumber(profile.academic.phone);
        }
      } else {
        setError("Research request details not found.");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to fetch request information.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (requestId && profile) {
      loadDetails();
    }
  }, [requestId, profile]);

  // Load available writers for admin allocation
  useEffect(() => {
    const fetchWriters = async () => {
      if (profile?.role === "admin" && request?.status === "funded") {
        try {
          const { db } = await import("@/config/firebase");
          const { collection, getDocs, query, where } = await import("firebase/firestore");
          
          // Query all users whose role is writer and verification status is approved
          const q = query(
            collection(db, "users"), 
            where("role", "==", "writer"), 
            where("verificationStatus", "==", "approved")
          );
          const snap = await getDocs(q);
          const writers: any[] = [];
          snap.forEach(doc => {
            const data = doc.data();
            if (data.writerStatus !== "active" || data.isVerifiedWriter !== true) {
              return;
            }
            
            // Calculate a matching score based on priority order:
            // 1. Subject Match
            // 2. Study Level Match
            // 3. Reputation
            // 4. Consistency (completedCount)
            // 5. Workload (estimated active task counts)
            let score = 0;
            const subjectMatch = data.academic?.specializations?.some(
              (spec: string) => spec.toLowerCase() === request.subject.toLowerCase()
            );
            if (subjectMatch) score += 50;

            const levelMatch = data.academic?.yearOfStudy?.toLowerCase() === request.levelOfStudy.toLowerCase();
            if (levelMatch) score += 30;

            score += (data.reputation || 5) * 4; // Rating gives up to 20 pts
            score += Math.min(data.completedCount || 0, 10); // completed tasks gives up to 10 pts

            writers.push({
              uid: doc.id,
              ...data,
              score
            });
          });

          // Sort writers by score descending
          writers.sort((a, b) => b.score - a.score);
          setAvailableWriters(writers);
        } catch (e) {
          console.error("Failed to load writers list:", e);
        }
      }
    };

    fetchWriters();
  }, [profile, request]);

  const handlePostReply = async (e: React.FormEvent) => {
    if (!requestId || !profile || !clarificationReply.trim()) return;
    e.preventDefault();

    setIsSubmittingReply(true);
    try {
      const nextStatus = request?.status === "needs_clarification" ? "under_review" : undefined;
      await researchService.sendClarificationMessage(
        requestId,
        {
          senderId: profile.uid,
          senderRole: profile.role,
          senderName: profile.displayName,
          message: clarificationReply
        },
        profile,
        nextStatus
      );
      setClarificationReply("");
      await loadDetails();
    } catch (err: any) {
      alert(err.message || "Failed to submit clarification.");
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleAdminClarification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestId || !profile || !clarificationQuestion.trim()) return;

    setIsSubmittingQuestion(true);
    try {
      await researchService.sendClarificationMessage(
        requestId,
        {
          senderId: profile.uid,
          senderRole: "admin",
          senderName: profile.displayName,
          message: clarificationQuestion
        },
        profile,
        "needs_clarification"
      );
      setClarificationQuestion("");
      await loadDetails();
    } catch (err: any) {
      alert(err.message || "Failed to submit clarification question.");
    } finally {
      setIsSubmittingQuestion(false);
    }
  };

  const handleAdminQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestId || !profile || !quoteAmount) return;

    setIsSubmittingQuote(true);
    try {
      await researchService.submitQuote(
        requestId,
        parseFloat(quoteAmount),
        quoteNotes,
        profile
      );
      setQuoteAmount("");
      setQuoteNotes("");
      await loadDetails();
    } catch (err: any) {
      alert(err.message || "Failed to issue quote.");
    } finally {
      setIsSubmittingQuote(false);
    }
  };

  const handleDecision = async (accepted: boolean) => {
    if (!requestId || !profile) return;
    if (!confirm(`Are you sure you want to ${accepted ? "accept" : "reject"} this quote?`)) return;

    try {
      await researchService.handleQuoteDecision(requestId, accepted, profile);
      await loadDetails();
    } catch (err: any) {
      alert(err.message || "Decision update failed.");
    }
  };

  const handleExecutePayment = async () => {
    if (!requestId || !profile) return;
    setIsProcessingPayment(true);
    setPaymentError(null);

    if (paymentMethod === "card" && (!cardNumber || !cardExpiry || !cardCvv)) {
      setPaymentError("Please fill in credit card details.");
      setIsProcessingPayment(false);
      return;
    }
    if ((paymentMethod === "mtn" || paymentMethod === "airtel") && !phoneNumber) {
      setPaymentError("Mobile money phone number is required.");
      setIsProcessingPayment(false);
      return;
    }

    try {
      // Simulate network handshakes
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await researchService.completeEscrowPayment(requestId, profile);
      setShowCheckoutModal(false);
      await loadDetails();
    } catch (err: any) {
      setPaymentError(err.message || "Checkout transaction failed.");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleAssignWriter = async () => {
    if (!requestId || !profile || !selectedWriter) return;

    setIsAssigning(true);
    try {
      await researchService.assignWriter(requestId, selectedWriter, profile);
      await loadDetails();
    } catch (err: any) {
      alert(err.message || "Writer assignment failed.");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleTransition = async (next: ResearchRequestStatus, extra: any = {}) => {
    if (!requestId || !profile) return;
    try {
      await researchService.transitionStatus(requestId, next, profile, extra);
      await loadDetails();
    } catch (err: any) {
      alert(err.message || "Status shift failed.");
    }
  };

  const getActorLabel = (commenterRole: string, commenterId: string) => {
    if (commenterRole === "admin") return "System Administrator";
    
    // Revision 9: Exclude writer identity details from student interface
    if (commenterRole === "writer") {
      if (profile?.role === "customer") {
        return "Research Specialist";
      }
      return `Expert Writer (${commenterId.slice(0, 5)})`;
    }
    
    if (commenterId === request?.studentId) return "Student Owner";
    return "User Account";
  };

  if (loading) return <Loader size="lg" className="py-24" />;
  if (error) return <Alert variant="error" title="Workspace Error">{error}</Alert>;
  if (!request) return <Alert variant="warning" title="No request selected">Please select a request ID.</Alert>;

  const currentStatusInfo = STATUS_LABELS[request.status] || { label: request.status, color: "secondary" };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-secondary/15 p-6 rounded-xl border border-border/40">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <BackButton fallbackUrl="/dashboard" label="Dashboard" />
            <span className="font-mono text-xs font-bold text-muted-foreground">ID: {request.id}</span>
          </div>
          <h1 className="text-xl font-black text-foreground mt-2">{request.title}</h1>
          <p className="text-xs text-muted-foreground">
            Subject: {request.subject} | Level: {request.levelOfStudy} | Expected: {request.expectedDeliverable}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <Badge variant={currentStatusInfo.color as any} className="text-xs font-bold px-3 py-1 uppercase tracking-wider">
            {currentStatusInfo.label}
          </Badge>
        </div>
      </div>

      {/* Main Grid: Details left, Threads/Collaborations right */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: Brief metadata details */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <Card className="border-border/40 bg-card">
            <CardHeader className="border-b border-border/20 bg-secondary/10">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Request Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 flex flex-col gap-4 text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider block">Target Deadline</span>
                <span className="text-foreground font-semibold font-mono block mt-1">📅 {request.deadline}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider block">Study Level</span>
                <span className="text-foreground font-semibold block mt-1">🎓 {request.levelOfStudy}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider block">Deliverable Format</span>
                <span className="text-foreground font-semibold block mt-1">📝 {request.expectedDeliverable}</span>
              </div>
              {request.otherDetails && (
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider block">Custom Instructions</span>
                  <p className="text-foreground mt-1 bg-secondary/25 p-2.5 rounded border border-border/10 italic">
                    {request.otherDetails}
                  </p>
                </div>
              )}
              {((request.files && request.files.length > 0) || (request.uploadedFiles && request.uploadedFiles.length > 0)) && (
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider block mb-1">Attached briefs</span>
                  <div className="flex flex-col gap-1.5 mt-1.5">
                    {([...(request.files || []), ...(request.uploadedFiles || [])]
                      .filter((v, i, a) => a.findIndex(t => t.uid === v.uid) === i)
                      .map((file: any) => (
                        <a
                          key={file.uid}
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline font-bold font-mono truncate flex items-center gap-1"
                        >
                          📄 {file.name}
                        </a>
                      ))
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* User Specific Workspace Instructions details */}
          <Card className="border-border/40 bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Escrow Status</CardTitle>
            </CardHeader>
            <CardContent className="text-xs flex flex-col gap-2">
              <div className="flex justify-between items-center py-1.5 border-b border-border/10">
                <span className="text-muted-foreground font-semibold">Budget Amount</span>
                <span className="font-bold text-foreground">
                  {request.quoteAmount ? `K${request.quoteAmount.toFixed(2)}` : "Awaiting Quote"}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-muted-foreground font-semibold">Payment Status</span>
                <span className={`font-black uppercase tracking-wider text-[10px] ${request.quoteStatus === "paid" ? "text-success" : "text-amber-500"}`}>
                  {request.quoteStatus || "Not Quoted"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: Clarification/Actions/Collaborations */}
        <div className="md:col-span-2 flex flex-col gap-6">

          {/* 1. CLARIFICATION LOOP THREAD PANEL */}
          {(request.status === "needs_clarification" || request.clarificationThread?.length > 0) && (
            <Card className="border-border/40 bg-card">
              <CardHeader className="border-b border-border/20 bg-danger/10">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-danger flex items-center gap-1.5">
                  ⚠️ Clarification Loop History
                </CardTitle>
                <CardDescription>Review questions flagged by our team and respond with clarifications.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-4">
                
                {/* Message lists */}
                <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-2 divide-y divide-border/20">
                  {request.clarificationThread?.map((msg: any, idx: number) => {
                    const isSelf = msg.senderId === profile?.uid;
                    return (
                      <div key={idx} className={`pt-3 flex flex-col gap-1 text-xs ${isSelf ? "items-end" : "items-start"}`}>
                        <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                          <span>{msg.senderName} ({msg.senderRole.toUpperCase()})</span>
                          <span>•</span>
                          <span className="font-mono">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className={`p-3 rounded-lg max-w-[85%] leading-relaxed ${
                          isSelf ? "bg-primary/10 text-foreground border border-primary/20" : "bg-secondary/40 text-foreground"
                        }`}>
                          {msg.message}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Respond Input Form (Student view only when status is needs_clarification) */}
                {profile?.role === "customer" && request.status === "needs_clarification" && (
                  <form onSubmit={handlePostReply} className="flex flex-col gap-3 mt-3 border-t border-border/20 pt-4">
                    <Textarea
                      placeholder="Type your clarification details here (e.g. detailed topic parameters, study scope, deliverable outline)..."
                      value={clarificationReply}
                      onChange={e => setClarificationReply(e.target.value)}
                      rows={3}
                      required
                    />
                    <Button variant="primary" type="submit" isLoading={isSubmittingReply} className="w-fit self-end font-bold">
                      Submit Response Details
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          {/* 2. ADMIN PORTAL ACTION CARD */}
          {profile?.role === "admin" && (
            <Card className="border-danger/30 bg-danger/5">
              <CardHeader className="border-b border-danger/10">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-danger">Administration Governance Hub</CardTitle>
                <CardDescription>Audit specifications, write quotes, request clarifications, and assign expert writers.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-5">
                
                {/* Clarification submission trigger */}
                <form onSubmit={handleAdminClarification} className="flex flex-col gap-3">
                  <Textarea
                    label="Flag missing info & Ask Follow-up Questions"
                    placeholder="e.g. Please clarify what statistical tests are expected, or provide the study level..."
                    value={clarificationQuestion}
                    onChange={e => setClarificationQuestion(e.target.value)}
                    rows={2}
                    required
                  />
                  <Button variant="danger" type="submit" isLoading={isSubmittingQuestion} className="w-fit font-bold">
                    Move to Needs Clarification & Send Question
                  </Button>
                </form>

                {/* Custom Quote Generator */}
                <form onSubmit={handleAdminQuote} className="flex flex-col gap-4 border-t border-danger/25 pt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="Custom Quote Amount (ZMW)"
                      type="number"
                      placeholder="e.g. 150"
                      value={quoteAmount}
                      onChange={e => setQuoteAmount(e.target.value)}
                      required
                    />
                    <Input
                      label="Pricing Note"
                      placeholder="e.g. Proposal writing and SPSS data analysis"
                      value={quoteNotes}
                      onChange={e => setQuoteNotes(e.target.value)}
                      required
                    />
                  </div>
                  <Button variant="primary" type="submit" isLoading={isSubmittingQuote} className="w-fit font-bold">
                    Issue Quote Amount (Status &rarr; Quote Ready)
                  </Button>
                </form>

                {/* Writer selection matching queue */}
                {request.status === "funded" && (
                  <div className="flex flex-col gap-3 border-t border-danger/25 pt-4 text-xs font-semibold">
                    <label className="text-xs font-bold text-foreground">Allocate Verified Expert Writer</label>
                    <div className="flex gap-3">
                      <select
                        value={selectedWriter}
                        onChange={e => setSelectedWriter(e.target.value)}
                        className="flex-1 bg-background text-foreground border border-border/80 p-2.5 rounded-lg font-bold"
                      >
                        <option value="">-- Choose matching expert --</option>
                        {availableWriters.map(w => (
                          <option key={w.uid} value={w.uid}>
                            {w.displayName} - Rating: {w.reputation || 5}★ - Match Score: {w.score} pts (Completed: {w.completedCount})
                          </option>
                        ))}
                      </select>
                      <Button variant="primary" onClick={handleAssignWriter} isLoading={isAssigning} disabled={!selectedWriter}>
                        Assign Expert Writer
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 3. STUDENT DECISION HUB (QUOTE ACCEPTANCE) */}
          {profile?.role === "customer" && request.status === "quote_ready" && (
            <Card className="border-primary/40 bg-card">
              <CardHeader className="border-b border-border/20 bg-secondary/15">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-primary">Tailored Quote Issued</CardTitle>
                <CardDescription>Our administration team has reviewed your specifications and generated a custom quote.</CardDescription>
              </CardHeader>
              <CardContent className="pt-5 flex flex-col gap-4">
                <div className="bg-secondary/40 p-4 rounded-xl border border-border/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase font-black block">Pricing details</span>
                    <p className="text-xs font-semibold text-foreground mt-1">{request.quoteNotes || "Custom research write-up"}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground uppercase font-black block">Quote amount</span>
                    <span className="text-success text-lg font-black block mt-0.5">K{request.quoteAmount?.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-2">
                  <Button variant="outline" onClick={() => handleDecision(false)}>
                    Reject Quote
                  </Button>
                  <Button variant="primary" onClick={() => handleDecision(true)}>
                    Accept Quote & Proceed
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 4. PAYMENT ESCROW BUTTON */}
          {profile?.role === "customer" && request.status === "awaiting_payment" && (
            <Card className="border-success/35 bg-success/5 text-xs">
              <CardContent className="p-5 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex flex-col gap-1">
                  <h4 className="text-sm font-bold text-foreground">Secure Escrow Funds Required</h4>
                  <p className="text-muted-foreground leading-relaxed">
                    To start work on your research, please pay the quote budget of **K{request.quoteAmount?.toFixed(2)}** into secure escrow.
                  </p>
                </div>
                <Button variant="primary" className="bg-success border-success text-white hover:bg-success/90 font-bold px-6 shrink-0" onClick={() => setShowCheckoutModal(true)}>
                  💳 Pay into Escrow
                </Button>
              </CardContent>
            </Card>
          )}

          {/* 5. WRITER TASK MANAGEMENT PANELS */}
          {profile?.role === "writer" && profile.uid === request.assignedWriterId && (
            <Card className="border-warning/35 bg-warning/5 text-xs font-semibold text-foreground/80">
              <CardHeader className="border-b border-warning/15">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-warning">Expert workspace Actions</CardTitle>
                <CardDescription>Update your research progression, share assets, and submit draft files.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-4">
                <p className="text-muted-foreground font-medium">
                  Current Project status is: <strong className="text-foreground uppercase">{request.status}</strong>. Please upload draft chapters, references, or data analysis outputs directly into the workspace below.
                </p>

                <div className="flex gap-3">
                  {request.status === "assigned" && (
                    <Button variant="primary" onClick={() => handleTransition("in_progress")}>
                      ✓ Accept Task & Start Writing
                    </Button>
                  )}
                  {request.status === "in_progress" && (
                    <Button variant="primary" onClick={() => handleTransition("submitted_for_review")}>
                      🚀 Submit Complete Draft for Review
                    </Button>
                  )}
                  {request.status === "submitted_for_review" && (
                    <span className="text-muted-foreground italic font-medium">Awaiting administrator and student approval.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 6. DRAFT APPROVAL MODULES (Student/Admin review of submitted draft) */}
          {request.status === "submitted_for_review" && (profile?.role === "customer" || profile?.role === "admin") && (
            <Card className="border-warning/30 bg-card">
              <CardHeader className="border-b border-border/20 bg-secondary/10">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-primary">Review Submitted Research Draft</CardTitle>
                <CardDescription>The expert writer has submitted their work. Please audit details and approve or request revision.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-4">
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => handleTransition("revision_requested")}>
                    ⚠️ Request Revisions
                  </Button>
                  <Button variant="primary" className="bg-success border-success text-white hover:bg-success/90" onClick={() => handleTransition("completed")}>
                    ✓ Approve Deliverable (Release Payout)
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 7. GENERAL TIMELINE & COMMENTS CHAT LOOP COLLABORATION (Only after funding) */}
          {!["submitted", "under_review", "needs_clarification", "quote_ready", "awaiting_payment"].includes(request.status) && (
            <Card className="border-border/40 bg-card">
              <CardHeader className="border-b border-border/20 bg-secondary/10">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Timeline Collaboration Feed</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-4">
                
                {/* Display instructions brief text */}
                <div className="bg-secondary/20 p-4 rounded-xl border border-border/15 mb-3 text-xs leading-relaxed">
                  <span className="text-[10px] text-muted-foreground uppercase font-black block mb-1">Instruction brief</span>
                  <p className="text-foreground whitespace-pre-wrap">{request.pastedBrief}</p>
                </div>

                <Alert variant="info" title="Collaboration Workspace Active">
                  Direct message thread with your assigned Research Specialist. Plagiarism audit scans are automatically enforced on shared files.
                </Alert>

                {/* Reply Form */}
                <form onSubmit={handlePostReply} className="flex flex-col gap-3 border-t border-border/20 pt-4">
                  <Textarea
                    placeholder="Ask questions, give feedbacks, or share guidelines notes with your researcher..."
                    value={clarificationReply}
                    onChange={e => setClarificationReply(e.target.value)}
                    rows={3}
                    required
                  />
                  <Button variant="primary" type="submit" isLoading={isSubmittingReply} className="w-fit self-end font-bold">
                    Send Message
                  </Button>
                </form>

                {/* Message Log */}
                <div className="flex flex-col gap-3 mt-4 pr-1 divide-y divide-border/20 max-h-[400px] overflow-y-auto">
                  {request.clarificationThread?.map((msg: any, idx: number) => {
                    const isSelf = msg.senderId === profile?.uid;
                    const actorName = getActorLabel(msg.senderRole, msg.senderId);
                    return (
                      <div key={idx} className={`pt-3 flex flex-col gap-1 text-xs ${isSelf ? "items-end" : "items-start"}`}>
                        <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                          <span>{actorName}</span>
                          <span>•</span>
                          <span className="font-mono">{new Date(msg.createdAt).toLocaleDateString()} {new Date(msg.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className={`p-3 rounded-lg max-w-[85%] leading-relaxed ${
                          isSelf ? "bg-primary/10 text-foreground border border-primary/20" : "bg-secondary/40 text-foreground"
                        }`}>
                          {msg.message}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>

      {/* SECURE ESCROW CHECKOUT MODAL */}
      <Modal
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        title="Secure Escrow Checkout Portal"
      >
        <div className="flex flex-col gap-5 text-sm">
          {paymentError && <Alert variant="error" title="Transaction Failed">{paymentError}</Alert>}

          <div className="bg-secondary/45 p-4 rounded-xl border border-border/30">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Funding escrow for custom research request:</span>
            <h4 className="text-sm font-bold text-foreground mt-0.5 truncate">{request.title}</h4>
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-border/20 text-foreground font-extrabold text-base">
              <span>Required Payment</span>
              <span className="text-success">K{request.quoteAmount?.toFixed(2)}</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Payment Method</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("mtn")}
                className={`py-2.5 rounded-lg font-bold text-xs border transition-all flex flex-col items-center gap-1 cursor-pointer ${
                  paymentMethod === "mtn" ? "bg-amber-400/10 border-amber-400 text-amber-500 font-extrabold" : "bg-card border-border/60 hover:bg-secondary/40 text-muted-foreground"
                }`}
              >
                <span>🟡</span>
                MTN MoMo
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("airtel")}
                className={`py-2.5 rounded-lg font-bold text-xs border transition-all flex flex-col items-center gap-1 cursor-pointer ${
                  paymentMethod === "airtel" ? "bg-danger/10 border-danger text-danger font-extrabold" : "bg-card border-border/60 hover:bg-secondary/40 text-muted-foreground"
                }`}
              >
                <span>🔴</span>
                Airtel Money
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("card")}
                className={`py-2.5 rounded-lg font-bold text-xs border transition-all flex flex-col items-center gap-1 cursor-pointer ${
                  paymentMethod === "card" ? "bg-primary/10 border-primary text-primary font-extrabold" : "bg-card border-border/60 hover:bg-secondary/40 text-muted-foreground"
                }`}
              >
                <span>💳</span>
                Credit Card
              </button>
            </div>
          </div>

          {/* Method Specific Fields */}
          {paymentMethod === "card" ? (
            <div className="flex flex-col gap-3 bg-secondary/15 p-4 rounded-xl border border-border/20">
              <Input
                label="Cardholder Number"
                placeholder="4000 1234 5678 9010"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Expiration Date"
                  placeholder="MM/YY"
                  value={cardExpiry}
                  onChange={(e) => setCardExpiry(e.target.value)}
                  required
                />
                <Input
                  label="CVV Code"
                  type="password"
                  placeholder="123"
                  value={cardCvv}
                  onChange={(e) => setCardCvv(e.target.value)}
                  required
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 bg-secondary/15 p-4 rounded-xl border border-border/20">
              <Input
                label={`${paymentMethod === "mtn" ? "MTN Mobile Money" : "Airtel Money"} Phone Number`}
                placeholder="+260 971234567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                required
              />
              <span className="text-[10px] text-muted-foreground italic -mt-1 block">
                A prompt request will be transmitted to this phone to authenticate the escrow budget deposit.
              </span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-border/20">
            <Button variant="outline" size="sm" onClick={() => setShowCheckoutModal(false)} disabled={isProcessingPayment}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleExecutePayment}
              isLoading={isProcessingPayment}
              className="bg-success border-success text-white hover:bg-success/90 hover:border-success/90 font-bold"
            >
              Verify & Complete Escrow load
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
