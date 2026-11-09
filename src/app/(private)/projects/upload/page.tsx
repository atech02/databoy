"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { projectService } from "@/services/projectService";
import { ocrService } from "@/services/ocrService";
import { storageService } from "@/services/storageService";
import { notificationService } from "@/services/notificationService";
import {
  calculateAssignmentPricing,
  calculateCommissionBreakdown,
  getDaysUntilDeadline,
} from "@/utils/pricing";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { BackButton } from "@/components/ui/BackButton";
import { PROJECT_TYPES, ACADEMIC_LEVELS, SUBJECT_EXPERTISE } from "@/utils/lookups";
import { ProjectFile } from "@/types/domain";

export default function UploadProject() {
  const router = useRouter();
  const { profile } = useAuth();

  // Pre-generate project ID for consistent storage mapping
  const [projectId] = useState(() => "PRJ-" + Math.floor(1000 + Math.random() * 9000));
  
  // Files list
  const [filesList, setFilesList] = useState<ProjectFile[]>([]);
  const [briefFile, setBriefFile] = useState<File | null>(null);
  // Student Input Overwrite Protection Flags
  const [ocrSuggestion, setOcrSuggestion] = useState<any>(null);
  const [hasUserEditedGuidelines, setHasUserEditedGuidelines] = useState(false);
  const [hasUserEditedTitle, setHasUserEditedTitle] = useState(false);

  // Common Form States
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [guidelines, setGuidelines] = useState("");

  // Academic-Specific States
  const [pageCount, setPageCount] = useState<number>(4);
  const [referencingStyle, setReferencingStyle] = useState("APA");
  const [hasManuallyAdjustedPages, setHasManuallyAdjustedPages] = useState(false);
  
  // OCR States
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrLog, setOcrLog] = useState<string>("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [extractedOcrText, setExtractedOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [ocrMetrics, setOcrMetrics] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any | null>(null);

  // Revisions States
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showReviewBanner, setShowReviewBanner] = useState(false);
  const [completeness, setCompleteness] = useState<{ score: number; details: any[] } | null>(null);
  const [selectedFieldsToApply, setSelectedFieldsToApply] = useState<Record<string, boolean>>({
    title: true,
    guidelines: true,
    referencingStyle: true,
    deadline: true,
    pageCount: true
  });

  // Payment Checkout Modal States
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Academic level + subject
  const [academicLevel, setAcademicLevel] = useState("degree");
  const [subject, setSubject] = useState("");

  // Success Scaffold States
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [createdId, setCreatedId] = useState("");

  const [error, setError] = useState<string | null>(null);

  function calculateCompleteness(parsed: any) {
    let score = 0;
    const details = [];

    const hasQuestions = parsed.questions && parsed.questions.trim().length > 10;
    score += hasQuestions ? 40 : 0;
    details.push({ label: "Questions/Tasks", found: hasQuestions });

    const hasInstructions = parsed.guidelines || (parsed.instructions && parsed.instructions.trim().length > 10);
    score += hasInstructions ? 20 : 0;
    details.push({ label: "Instructions/Guidelines", found: hasInstructions });

    const hasWordCount = typeof parsed.wordCount === "number" && parsed.wordCount > 0;
    score += hasWordCount ? 10 : 0;
    details.push({ label: "Word Count", found: hasWordCount });

    const hasRef = parsed.referencingStyle && parsed.referencingStyle.trim().length > 0;
    score += hasRef ? 10 : 0;
    details.push({ label: "Referencing Style", found: hasRef });

    const hasDeadline = parsed.deadline && parsed.deadline.trim().length > 0;
    score += hasDeadline ? 10 : 0;
    details.push({ label: "Submission Deadline", found: hasDeadline });

    const hasTitle = parsed.title && parsed.title.trim().length > 4;
    score += hasTitle ? 10 : 0;
    details.push({ label: "Assignment Title", found: hasTitle });

    return { score, details };
  }

  // Trigger OCR extraction when brief file is uploaded
  const handleBriefFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const fileType = file.name.split(".").pop()?.toUpperCase() || "UNKNOWN";
    
    // Scanned Page Count Protection (Revision 6)
    if (fileType === "PDF") {
      try {
        setIsOcrProcessing(true);
        setOcrLog("Verifying PDF page count...");
        setOcrProgress(5);
        
        // Dynamically load PDF.js from the PDFTextExtractor
        const { PDFTextExtractor } = await import("@/services/documentProcessor");
        const pdfExtractor = new PDFTextExtractor();
        const pdfjs = (window as any).pdfjsLib || (await (pdfExtractor as any).loadPdfJS());
        
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        if (pdf.numPages > 25) {
          setError("This document is too large for automatic extraction. Please upload the assignment brief pages only (maximum 25 pages).");
          setIsOcrProcessing(false);
          setBriefFile(null);
          return;
        }
      } catch (err: any) {
        console.error("PDF page count check failed:", err);
      } finally {
        setIsOcrProcessing(false);
      }
    }

    const newDiagnostics: any = {
      fileType,
      method: "Pending...",
      charCount: 0,
      preview: "",
      parsedTitle: "None",
      parsedBrief: "None",
      parsedWordCount: undefined,
      parsedReferencingStyle: "None",
      parsedDeadline: "None",
      briefApplied: "No",
      titleApplied: "No",
      wordCountApplied: "No",
      errors: []
    };
    setDiagnostics(newDiagnostics);

    setBriefFile(file);
    setIsOcrProcessing(true);
    setOcrProgress(10);
    setOcrLog("Uploading brief document...");
    setOcrConfidence(null);
    setOcrMetrics(null);

    let downloadedUrl = "";
    let filePath = "";
    try {
      const uploadRes = await storageService.uploadFile("assignments", projectId, file, (progress) => {
        // Optionally map upload progress
      });
      downloadedUrl = uploadRes.url;
      filePath = uploadRes.path;
      
      const briefProjectFile: ProjectFile = {
        uid: "file-brief-" + Math.floor(1000 + Math.random() * 9000),
        name: file.name,
        url: downloadedUrl,
        uploadedBy: profile?.uid || "customer",
        uploadedAt: new Date().toISOString(),
        sizeBytes: file.size
      };

      setFilesList(prev => [
        briefProjectFile,
        ...prev.filter(f => !f.uid.startsWith("file-brief-"))
      ]);
    } catch (err: any) {
      newDiagnostics.errors.push("Storage Upload Failure: " + (err?.message || String(err)));
      setDiagnostics({ ...newDiagnostics });
      setIsOcrProcessing(false);
      return;
    }

    let result: any = null;
    try {
      result = await ocrService.extractText(
        file, 
        (status, progress) => {
          setOcrLog(status);
          setOcrProgress(progress);
        },
        projectId,
        profile?.uid || "unknown-customer",
        downloadedUrl,
        filePath
      );
      
      newDiagnostics.method = result.ocrMetrics.extractionMethod;
      newDiagnostics.charCount = result.rawText.length;
      newDiagnostics.preview = result.rawText.substring(0, 500);
      setExtractedOcrText(result.rawText);
      setOcrConfidence(result.confidence);
      setOcrMetrics(result.ocrMetrics);
      setDiagnostics({ ...newDiagnostics });
    } catch (err: any) {
      const errType = fileType === "PDF" ? "PDF Extraction Failure" : "Multimodal API Failure";
      newDiagnostics.errors.push(`${errType}: ${err?.message || String(err)}`);
      newDiagnostics.method = err?.ocrMetrics?.extractionMethod || "Failed";
      setDiagnostics({ ...newDiagnostics });
      setIsOcrProcessing(false);
      
      if (err.message === "processing_timeout") {
        setOcrLog("Extraction timed out. You can continue by entering the assignment details manually below.");
      } else {
        setOcrLog("We couldn't automatically extract assignment details. Please fill out the form manually.");
      }
      setOcrProgress(100);
      return;
    }

    let parsed: any = null;
    try {
      parsed = result.parsed;
      setOcrSuggestion(parsed);
      
      newDiagnostics.parsedTitle = parsed.title || "None";
      newDiagnostics.parsedBrief = parsed.questions || parsed.guidelines || parsed.instructions || "None";
      newDiagnostics.parsedWordCount = parsed.wordCount;
      newDiagnostics.parsedReferencingStyle = parsed.referencingStyle || "None";
      newDiagnostics.parsedDeadline = parsed.deadline || "None";
      setDiagnostics({ ...newDiagnostics });
    } catch (err: any) {
      newDiagnostics.errors.push("Parsing Failure: " + (err?.message || String(err)));
      setDiagnostics({ ...newDiagnostics });
    }

    if (parsed) {
      const completenessData = calculateCompleteness(parsed);
      setCompleteness(completenessData);

      try {
        let briefApplied: "Yes" | "No" = "No";
        let titleApplied: "Yes" | "No" = "No";
        let wordCountApplied: "Yes" | "No" = "No";

        // Check if student has manually edited during processing (Revision 10 Overwrite Protection)
        const hasEdited = hasUserEditedTitle || hasUserEditedGuidelines;

        if (hasEdited) {
          // Keep current form state but trigger suggestion banner/modal
          setShowReviewBanner(true);
        } else {
          // Auto-populate
          if (parsed.questions || parsed.guidelines || parsed.instructions) {
            setGuidelines(parsed.questions || parsed.guidelines || parsed.instructions || "");
            briefApplied = "Yes";
          }
          if (parsed.title) {
            setTitle(parsed.title);
            titleApplied = "Yes";
          }
          if (parsed.referencingStyle) {
            setReferencingStyle(parsed.referencingStyle);
          }
          if (parsed.deadline) {
            setDeadline(parsed.deadline);
          }
          if (parsed.wordCount) {
            wordCountApplied = "Yes";
            const estimatedPages = Math.max(1, Math.min(15, Math.ceil(parsed.wordCount / 275)));
            setPageCount(estimatedPages);
          }
          setShowReviewBanner(false);
        }

        newDiagnostics.briefApplied = briefApplied;
        newDiagnostics.titleApplied = titleApplied;
        newDiagnostics.wordCountApplied = wordCountApplied;
        setDiagnostics({ ...newDiagnostics });
      } catch (err: any) {
        newDiagnostics.errors.push("UI Population Failure: " + (err?.message || String(err)));
        setDiagnostics({ ...newDiagnostics });
      }
    }

    setIsOcrProcessing(false);
  };

  const removeFile = (uid: string) => {
    setFilesList(prev => prev.filter(f => f.uid !== uid));
    if (uid.startsWith("file-brief-")) {
      setBriefFile(null);
      setExtractedOcrText("");
      setOcrConfidence(null);
      setOcrMetrics(null);
    }
  };

  // Full pricing engine calculation
  const daysLeft = getDaysUntilDeadline(deadline);
  const pricingResult = calculateAssignmentPricing(pageCount, academicLevel, daysLeft, "assignment");
  const academicPriceZMW = pricingResult.total;
  const breakdown = calculateCommissionBreakdown(academicPriceZMW);

  // Auto-calculate page count based on guidelines word count unless manually overridden
  useEffect(() => {
    if (hasManuallyAdjustedPages || !guidelines.trim()) return;
    const words = guidelines.trim().split(/\s+/).filter(Boolean).length;
    const estimatedPages = Math.max(1, Math.min(15, Math.ceil(words / 275)));
    setPageCount(estimatedPages);
  }, [guidelines, hasManuallyAdjustedPages]);

  const handleApplySuggestions = (mode: "all" | "selected") => {
    if (!ocrSuggestion) return;

    if (mode === "all" || selectedFieldsToApply.title) {
      if (ocrSuggestion.title) setTitle(ocrSuggestion.title);
    }
    if (mode === "all" || selectedFieldsToApply.guidelines) {
      const suggestionBrief = ocrSuggestion.questions || ocrSuggestion.guidelines || ocrSuggestion.instructions;
      if (suggestionBrief) setGuidelines(suggestionBrief);
    }
    if (mode === "all" || selectedFieldsToApply.referencingStyle) {
      if (ocrSuggestion.referencingStyle) setReferencingStyle(ocrSuggestion.referencingStyle);
    }
    if (mode === "all" || selectedFieldsToApply.deadline) {
      if (ocrSuggestion.deadline) setDeadline(ocrSuggestion.deadline);
    }
    if (mode === "all" || selectedFieldsToApply.pageCount) {
      if (ocrSuggestion.wordCount) {
        const estimatedPages = Math.max(1, Math.min(15, Math.ceil(ocrSuggestion.wordCount / 275)));
        setPageCount(estimatedPages);
      }
    }

    setShowReviewModal(false);
    setShowReviewBanner(false);
  };

  const handleIgnoreSuggestions = () => {
    setShowReviewModal(false);
    setShowReviewBanner(false);
  };

  const handleSubmitAcademic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setError(null);

    if (!title.trim() || !deadline || !guidelines.trim()) {
      setError("Please complete all fields: Title, Deadline, and Guidelines/Text are required.");
      return;
    }

    setShowCheckoutModal(true);
  };

  const handleExecutePaymentAndDeploy = async () => {
    if (!profile) return;
    setIsProcessingPayment(true);
    setPaymentError(null);

    try {
      // Simulate brief processing delay (realistic UX feel)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const newProj = await projectService.createProject({
        id: projectId,
        title,
        projectType: "academic_assignment",
        deadline,
        budget: academicPriceZMW,
        guidelines,
        customerId: profile.uid,
        pageCount,
        wordCount: guidelines.trim().split(/\s+/).filter(Boolean).length,
        referencingStyle,
        ocrText: extractedOcrText || guidelines.slice(0, 300),
        ocrParsedFields: ocrSuggestion || null,
        ocrMetrics: ocrMetrics || null,
        extractionMethod: ocrMetrics?.extractionMethod || (briefFile ? "pdf_direct" : "docx_direct"),
        confidenceLevel: ocrConfidence || "high",
        currency: "ZMW",
        writerCommission: breakdown.writer,
        proofreaderCommission: breakdown.proofreader,
        databoyCommission: breakdown.databoy,
        academicLevel,
        subject,
        status: "awaiting_payment",
        paymentMode: "test",
        escrowMode: "simulated",
        escrowStatus: "pending_funding",
        paymentStatus: "awaiting_payment",
        allocationStatus: "pending",
        pricingBreakdown: pricingResult,
      });

      // Transition awaiting_payment -> funded
      await projectService.transitionProjectStatus(newProj.id, "funded", profile, {
        paymentStatus: "funded",
        escrowStatus: "held",
        payoutStatus: "escrowed",
        fundedAt: new Date().toISOString(),
        files: filesList,
      });

      // Transition funded -> awaiting_assignment
      await projectService.transitionProjectStatus(newProj.id, "awaiting_assignment", profile, {
        allocationStatus: "pending",
      });

      // Fire in-app notifications
      try {
        // Get admin IDs for notification
        const { allocationService } = await import("@/services/allocationService");
        const adminIds = await allocationService.getAdminIds();
        await notificationService.notifyEscrowFunded(
          profile.uid,
          adminIds,
          newProj.id,
          title,
          academicPriceZMW
        );
      } catch (notifErr) {
        console.warn("Notification dispatch failed (non-critical):", notifErr);
      }

      setCreatedId(newProj.id);
      setShowCheckoutModal(false);
      setShowSuccessModal(true);
    } catch (err: any) {
      setPaymentError(err?.message || "Simulated payment failed.");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleModalClose = () => {
    setShowSuccessModal(false);
    router.push("/dashboard");
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      
      {/* Back button */}
      <div className="flex items-center">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
      </div>

      {/* ====================================================================
         AUTOMATED ACADEMIC WORKFLOW
         ==================================================================== */}
      <Card className="shadow-lg border-border/40">
        <CardHeader className="border-b border-border/20 bg-secondary/15">
          <CardTitle className="mt-2">Upload Academic Assignment</CardTitle>
          <CardDescription>Upload your assignment document, verify OCR scans, and calculate exact page budgets.</CardDescription>
        </CardHeader>
          
          <CardContent className="pt-6">
            <form onSubmit={handleSubmitAcademic} className="flex flex-col gap-5">
              {error && <Alert variant="error" title="Form Incomplete">{error}</Alert>}

              {/* 1. Primary Assignment Brief dropzone (Triggers OCR) */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Primary Assignment Brief (Triggers OCR)</label>
                  <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full uppercase tracking-wider">Triggers scan</span>
                </div>
                <div className="border-2 border-dashed border-border/60 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-secondary/20 hover:bg-secondary/40 transition-colors relative cursor-pointer">
                  <input 
                    type="file" 
                    accept=".pdf,.docx,image/*" 
                    onChange={handleBriefFileChange} 
                    className="absolute inset-0 opacity-0 cursor-pointer" 
                  />
                  <div className="text-4xl">📄</div>
                  <div className="text-center">
                    <span className="text-sm font-bold text-foreground block">
                      {briefFile ? briefFile.name : "Drag & Drop or Click to Upload Brief"}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5 block">
                      Accepts PDF, Microsoft Word, or scanned assignment images
                    </span>
                  </div>
                </div>
              </div>



              {/* List of currently uploaded files */}
              {filesList.length > 0 && (
                <div className="flex flex-col gap-2 bg-secondary/10 p-4 rounded-xl border border-border/20">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1">Attached Documents ({filesList.length})</span>
                  <div className="flex flex-col gap-2">
                    {filesList.map((file) => {
                      const isBrief = file.uid.startsWith("file-brief-");
                      return (
                        <div key={file.uid} className="flex justify-between items-center p-2 rounded-lg bg-card border border-border/40 text-xs">
                          <div className="flex items-center gap-2 truncate">
                            <span>📄</span>
                            <div className="flex flex-col truncate">
                              <span className="font-bold text-foreground truncate">{file.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB • {isBrief ? "Primary Brief" : "Supporting"}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(file.uid)}
                            className="text-danger hover:text-danger/80 font-bold px-2 py-1 select-none cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Simulated OCR loading bar */}
              {isOcrProcessing && (
                <Card className="border-primary/20 bg-primary/5 animate-pulse">
                  <CardContent className="p-4 flex flex-col gap-2">
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-primary flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin inline-block" />
                        {ocrProgress <= 20 ? "Uploading document..." :
                         ocrProgress <= 50 ? "Understanding assignment..." :
                         ocrProgress <= 85 ? "Extracting assignment details..." :
                         "Preparing review screen..."}
                      </span>
                      <span>{ocrProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all duration-300" style={{ width: `${ocrProgress}%` }} />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* DataBoy OCR Diagnostics Panel (Temporary) */}
              {diagnostics && (
                <div className="mt-2">
                  <Card className="border-warning/30 bg-warning/5 font-mono text-xs shadow-inner">
                    <CardHeader className="pb-2 border-b border-warning/10">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-warning flex items-center justify-between">
                        <span>🛠️ OCR Diagnostics Console (Temporary)</span>
                        <button 
                          type="button" 
                          onClick={() => setDiagnostics(null)} 
                          className="text-[10px] text-muted-foreground hover:text-foreground font-bold cursor-pointer"
                        >
                          Clear
                        </button>
                      </CardTitle>
                      <CardDescription className="text-[10px] text-muted-foreground">
                        Real-time pipeline diagnostics for verifying client-side text extraction.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4 flex flex-col gap-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-b border-border/20 pb-3">
                        <div>
                          <span className="text-[10px] font-bold text-muted-foreground uppercase block">Step 1: File Type Detected</span>
                          <span className="text-foreground font-bold">{diagnostics.fileType}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-muted-foreground uppercase block">Step 2: Extraction Method Selected</span>
                          <span className="text-foreground font-bold">{diagnostics.method}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-muted-foreground uppercase block">Step 3: Raw Text Length</span>
                          <span className="text-foreground font-bold">Extracted Characters: {diagnostics.charCount}</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-muted-foreground uppercase block">Step 6: UI Population Check</span>
                          <div className="flex flex-col gap-0.5 mt-0.5 text-[10px]">
                            <span>Assignment Brief Applied: <strong className={diagnostics.briefApplied === "Yes" ? "text-success" : "text-amber-500"}>{diagnostics.briefApplied}</strong></span>
                            <span>Assignment Title Applied: <strong className={diagnostics.titleApplied === "Yes" ? "text-success" : "text-amber-500"}>{diagnostics.titleApplied}</strong></span>
                            <span>Word Count Applied: <strong className={diagnostics.wordCountApplied === "Yes" ? "text-success" : "text-amber-500"}>{diagnostics.wordCountApplied}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="border-b border-border/20 pb-3">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Step 4: First 500 Characters Preview</span>
                        <pre className="p-2.5 bg-secondary/35 rounded-lg border border-border/30 max-h-[120px] overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-foreground/80">
                          {diagnostics.preview || "(Waiting for raw text...)"}
                        </pre>
                      </div>

                      <div className="border-b border-border/20 pb-3">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Step 5: Parser Output</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-semibold text-foreground/90">
                          <div>Detected Assignment Title: <span className="font-bold text-foreground">{diagnostics.parsedTitle}</span></div>
                          <div>Detected Word Count: <span className="font-bold text-foreground">{diagnostics.parsedWordCount !== undefined ? diagnostics.parsedWordCount : "None"}</span></div>
                          <div>Detected Referencing Style: <span className="font-bold text-foreground">{diagnostics.parsedReferencingStyle}</span></div>
                          <div>Detected Deadline: <span className="font-bold text-foreground">{diagnostics.parsedDeadline}</span></div>
                          <div className="sm:col-span-2 mt-1">
                            <span className="text-muted-foreground block text-[9px] uppercase font-bold mb-0.5">Detected Assignment Brief (Start):</span>
                            <span className="italic block bg-secondary/10 p-1.5 rounded border border-border/10 truncate max-w-full">
                              {diagnostics.parsedBrief}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Step 7: Error Logging</span>
                        {diagnostics.errors && diagnostics.errors.length > 0 ? (
                          <div className="flex flex-col gap-1.5">
                            {diagnostics.errors.map((err: string, idx: number) => (
                              <div key={idx} className="bg-danger/10 border border-danger/20 p-2 rounded-lg text-danger text-[10px] font-bold">
                                ❌ {err}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-success font-bold block">✓ No errors captured in pipeline execution.</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Overwrite protection suggestion banner */}
              {showReviewBanner && ocrSuggestion && (
                <div className="bg-primary/10 border border-primary/20 p-4 rounded-xl text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">💡</span>
                    <div>
                      <span className="font-bold text-foreground block">Suggested assignment details found</span>
                      <span className="text-muted-foreground text-[10px]">We've scanned your document and found matching fields. Review and apply them.</span>
                    </div>
                  </div>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setSelectedFieldsToApply({
                        title: !!ocrSuggestion.title,
                        guidelines: !!(ocrSuggestion.questions || ocrSuggestion.guidelines || ocrSuggestion.instructions),
                        referencingStyle: !!ocrSuggestion.referencingStyle,
                        deadline: !!ocrSuggestion.deadline,
                        pageCount: !!ocrSuggestion.wordCount
                      });
                      setShowReviewModal(true);
                    }}
                    className="font-bold text-[10px] uppercase py-1.5 px-3 cursor-pointer shrink-0"
                  >
                    Review Suggestions
                  </Button>
                </div>
              )}

              {/* Completeness Meter */}
              {completeness && (
                <div className="bg-secondary/15 border border-border/20 p-4 rounded-xl flex flex-col gap-3">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Assignment Completeness</span>
                    <span className={`text-xs font-extrabold px-2 py-0.5 rounded-md ${
                      completeness.score >= 80 ? "bg-success/10 text-success" : 
                      completeness.score >= 50 ? "bg-amber-500/10 text-amber-600" : "bg-danger/10 text-danger"
                    }`}>
                      {completeness.score}%
                    </span>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="w-full h-2 bg-secondary/40 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${
                        completeness.score >= 80 ? "bg-success" : 
                        completeness.score >= 50 ? "bg-amber-500" : "bg-danger"
                      }`}
                      style={{ width: `${completeness.score}%` }} 
                    />
                  </div>
                  
                  {/* Fields list */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-bold mt-1">
                    {completeness.details.map((detail, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span className={detail.found ? "text-success" : "text-muted-foreground/30 font-light"}>
                          {detail.found ? "✓" : "✗"}
                        </span>
                        <span className={detail.found ? "text-foreground/90 font-bold" : "text-muted-foreground/50 font-normal"}>
                          {detail.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* General Confidence Alert (shown when not in banner mode) */}
              {briefFile && !isOcrProcessing && extractedOcrText && !showReviewBanner && (
                <div className="flex flex-col gap-3">
                  {ocrConfidence === "low" ? (
                    <div className="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl text-xs text-amber-600 flex items-center gap-2">
                      <span>⚠️</span>
                      <span className="font-semibold">We found some assignment details, but please review them carefully.</span>
                    </div>
                  ) : (
                    <div className="bg-success/5 border border-success/20 p-3.5 rounded-xl text-xs text-success flex items-center gap-2">
                      <span>✨</span>
                      <span className="font-semibold">Assignment details successfully extracted. Please review before proceeding.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Assignment Guidelines & Paste Text area */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Assignment Brief & Pasted Instructions
                  </label>
                </div>

                <Textarea
                  value={guidelines}
                  onChange={(e) => {
                    setGuidelines(e.target.value);
                    setHasUserEditedGuidelines(true);
                  }}
                  placeholder="Paste your assignment portal guidelines, instruction brief, or questions here..."
                  rows={6}
                  required
                  className={`font-mono text-xs text-foreground/90 bg-secondary/30 ${extractedOcrText ? "border-success/40" : ""}`}
                />
              </div>

              {/* Assignment details inputs */}
              <div className="flex flex-col gap-5 pt-3 border-t border-border/20">
                <Input
                  label="Assignment Title"
                  placeholder="e.g. Econometrics Balance Sheet Study or Java Socket Server"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setHasUserEditedTitle(true);
                  }}
                  required
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Academic Level"
                    options={ACADEMIC_LEVELS}
                    value={academicLevel}
                    onChange={(e) => setAcademicLevel(e.target.value)}
                  />

                  <Select
                    label="Subject / Discipline"
                    options={[
                      { value: "", label: "Select subject..." },
                      ...SUBJECT_EXPERTISE,
                    ]}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                     label="Referencing Style"
                     options={[
                       { value: "APA", label: "APA 7th Edition" },
                       { value: "Harvard", label: "Harvard Reference" },
                       { value: "MLA", label: "MLA Citation Format" },
                       { value: "Chicago", label: "Chicago Style" },
                       { value: "IEEE", label: "IEEE (Engineering)" },
                       { value: "Vancouver", label: "Vancouver (Medicine)" },
                       { value: "Other", label: "Other / Unconstrained" }
                     ]}
                     value={referencingStyle}
                     onChange={(e) => setReferencingStyle(e.target.value)}
                  />

                  <Input
                    label="Submission Target Deadline"
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    required
                  />
                </div>

                {/* Page count slider & Pricing visual engine */}
                <div className="flex flex-col gap-3.5 bg-card/65 p-4 rounded-xl border border-border/40 shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Page Budget</span>
                    <span className="text-sm font-black text-primary bg-primary/10 px-2.5 py-1 rounded-lg">
                      {pageCount} {pageCount === 1 ? "Page" : "Pages"}
                    </span>
                  </div>
                  
                  <input 
                    type="range" 
                    min="1" 
                    max="15" 
                    value={pageCount} 
                    onChange={(e) => {
                      setPageCount(parseInt(e.target.value));
                      setHasManuallyAdjustedPages(true);
                    }}
                    className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary" 
                  />
                  <div className="flex justify-between text-[10px] font-bold text-muted-foreground">
                    <span>1 Page</span>
                    <span>5 Pages</span>
                    <span>10 Pages</span>
                    <span>15 Pages</span>
                  </div>

                  {/* Enhanced pricing breakdown card */}
                  <div className="border-t border-border/20 pt-4 mt-2 flex flex-col gap-3 text-xs">
                    {/* Pricing breakdown matrix */}
                    <div className="grid grid-cols-2 gap-2 bg-secondary/20 rounded-lg p-3 border border-border/20">
                      <div>
                        <span className="text-[9px] font-bold uppercase text-muted-foreground block">Academic Level</span>
                        <span className="font-bold text-foreground">{ACADEMIC_LEVELS.find(l => l.value === academicLevel)?.label || academicLevel}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase text-muted-foreground block">Base Rate/Page</span>
                        <span className="font-bold text-foreground">K{pricingResult.baseRatePerPage.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase text-muted-foreground block">Urgency</span>
                        <span className={`font-bold ${daysLeft <= 1 ? 'text-danger' : daysLeft <= 3 ? 'text-amber-500' : 'text-foreground'}`}>
                          {pricingResult.urgencyBand}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase text-muted-foreground block">Urgency Multiplier</span>
                        <span className="font-bold text-foreground">×{pricingResult.urgencyMultiplier.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-sm font-extrabold border-b border-border/10 pb-2">
                      <span className="text-foreground">Total Budget</span>
                      <span className="text-success text-base font-black">K{academicPriceZMW.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between font-medium text-muted-foreground">
                      <span>Writer Allocation Share (50%)</span>
                      <span className="font-semibold text-foreground">K{breakdown.writer.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-medium text-muted-foreground">
                      <span>Proofreader Reviewer Allocation (16.67%)</span>
                      <span className="font-semibold text-foreground">K{breakdown.proofreader.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-medium text-muted-foreground">
                      <span>DataBoy Platform Escrow Fee (33.33%)</span>
                      <span className="font-semibold text-foreground">K{breakdown.databoy.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <Button variant="primary" type="submit" className="w-full mt-2 font-bold py-3 text-sm">
                Fund Escrow & Deploy Assignment
              </Button>
            </form>
          </CardContent>
        </Card>

      {/* ======================================================================
          SIMULATED ESCROW CHECKOUT MODAL
          ====================================================================== */}
      <Modal
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        title="Fund Escrow — Test Mode"
      >
        <div className="flex flex-col gap-5 text-sm">
          {/* TEST MODE banner */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-amber-500 text-lg">🧪</span>
            <div>
              <span className="text-[11px] font-black uppercase tracking-widest text-amber-600 block">Simulated Escrow — Test Mode</span>
              <span className="text-[10px] text-amber-600/80 font-medium">No real money moves. This simulates the full payment lifecycle for workflow testing.</span>
            </div>
          </div>

          {paymentError && <Alert variant="error" title="Transaction Failed">{paymentError}</Alert>}

          {/* Assignment summary */}
          <div className="bg-secondary/45 p-4 rounded-xl border border-border/30 flex flex-col gap-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Funding escrow for:</span>
            <h4 className="text-sm font-bold text-foreground truncate">{title || "Academic Assignment"}</h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[9px] text-muted-foreground font-bold uppercase block">Pages</span>
                <span className="font-bold text-foreground">{pageCount}</span>
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground font-bold uppercase block">Level</span>
                <span className="font-bold text-foreground">{ACADEMIC_LEVELS.find(l => l.value === academicLevel)?.label || academicLevel}</span>
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground font-bold uppercase block">Urgency</span>
                <span className={`font-bold ${daysLeft <= 1 ? 'text-danger' : daysLeft <= 3 ? 'text-amber-500' : 'text-foreground'}`}>
                  {pricingResult.urgencyBand}
                </span>
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground font-bold uppercase block">Deadline</span>
                <span className="font-bold text-foreground">{deadline || '—'}</span>
              </div>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-border/20 text-foreground font-extrabold text-base">
              <span>Test Escrow Amount</span>
              <span className="text-success">K{academicPriceZMW.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border/20">
            <Button variant="outline" size="sm" onClick={() => setShowCheckoutModal(false)} disabled={isProcessingPayment}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleExecutePaymentAndDeploy}
              isLoading={isProcessingPayment}
              className="bg-success border-success text-white hover:bg-success/90 hover:border-success/90"
            >
              Confirm Test Escrow Funding
            </Button>
          </div>
        </div>
      </Modal>

      {/* ======================================================================
          SUCCESS CONFIRMATION MODAL
          ====================================================================== */}
      <Modal
        isOpen={showSuccessModal}
        onClose={handleModalClose}
        title="Project Pipeline Active!"
        footerActions={
          <Button variant="primary" onClick={handleModalClose}>
            Access Dashboard
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-4 text-center p-4 text-sm">
          <div className="text-6xl animate-bounce">🚀</div>
          <h4 className="text-lg font-black text-foreground">Project {createdId} is Live</h4>
          <p className="text-muted-foreground leading-relaxed">
            Your academic assignment has been verified. A total of **K{academicPriceZMW.toFixed(2)}** is loaded in secure Escrow. Verified campus writers matching your major have been queued.
          </p>
        </div>
      </Modal>
      {/* ======================================================================
          OCR SUGGESTIONS SIDE-BY-SIDE REVIEW MODAL
          ====================================================================== */}
      <Modal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        title="Review Assignment Scan Suggestions"
      >
        <div className="flex flex-col gap-5 text-sm max-w-2xl">
          <p className="text-xs text-muted-foreground -mt-2">
            DataBoy scanned your document and found the following details. Select which suggestions you want to apply to your form.
          </p>

          <div className="flex flex-col gap-4 max-h-[380px] overflow-y-auto pr-1">
            {/* Field: Title */}
            {ocrSuggestion?.title && (
              <div className="border border-border/20 rounded-xl p-3 bg-secondary/10 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-foreground">Assignment Title</span>
                  <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={selectedFieldsToApply.title} 
                      onChange={(e) => setSelectedFieldsToApply(prev => ({ ...prev, title: e.target.checked }))}
                      className="accent-primary"
                    />
                    Apply suggestion
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-2 rounded bg-card border border-border/30">
                    <span className="text-[9px] text-muted-foreground uppercase font-semibold block">Current value:</span>
                    <span className="font-medium">{title || "(Empty)"}</span>
                  </div>
                  <div className="p-2 rounded bg-primary/5 border border-primary/20">
                    <span className="text-[9px] text-primary uppercase font-bold block">Suggested:</span>
                    <span className="font-bold text-foreground">{ocrSuggestion.title}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Field: Guidelines/Brief */}
            {(ocrSuggestion?.questions || ocrSuggestion?.guidelines || ocrSuggestion?.instructions) && (
              <div className="border border-border/20 rounded-xl p-3 bg-secondary/10 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-foreground">Guidelines & Questions</span>
                  <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={selectedFieldsToApply.guidelines} 
                      onChange={(e) => setSelectedFieldsToApply(prev => ({ ...prev, guidelines: e.target.checked }))}
                      className="accent-primary"
                    />
                    Apply suggestion
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-2 rounded bg-card border border-border/30 max-h-[120px] overflow-y-auto">
                    <span className="text-[9px] text-muted-foreground uppercase font-semibold block">Current value:</span>
                    <pre className="font-mono text-[10px] leading-normal whitespace-pre-wrap">{guidelines || "(Empty)"}</pre>
                  </div>
                  <div className="p-2 rounded bg-primary/5 border border-primary/20 max-h-[120px] overflow-y-auto">
                    <span className="text-[9px] text-primary uppercase font-bold block">Suggested:</span>
                    <pre className="font-mono text-[10px] leading-normal font-semibold text-foreground whitespace-pre-wrap">
                      {ocrSuggestion.questions || ocrSuggestion.guidelines || ocrSuggestion.instructions}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Field: Referencing Style */}
              {ocrSuggestion?.referencingStyle && (
                <div className="border border-border/20 rounded-xl p-3 bg-secondary/10 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-foreground font-semibold">Referencing</span>
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={selectedFieldsToApply.referencingStyle} 
                        onChange={(e) => setSelectedFieldsToApply(prev => ({ ...prev, referencingStyle: e.target.checked }))}
                        className="accent-primary"
                      />
                      Apply
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-card border border-border/30 text-center">
                      <span className="text-[9px] text-muted-foreground block">Current:</span>
                      <span className="font-medium">{referencingStyle || "(Empty)"}</span>
                    </div>
                    <div className="p-2 rounded bg-primary/5 border border-primary/20 text-center">
                      <span className="text-[9px] text-primary block font-bold">Suggested:</span>
                      <span className="font-bold text-foreground">{ocrSuggestion.referencingStyle}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Field: Deadline */}
              {ocrSuggestion?.deadline && (
                <div className="border border-border/20 rounded-xl p-3 bg-secondary/10 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-foreground font-semibold">Deadline</span>
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={selectedFieldsToApply.deadline} 
                        onChange={(e) => setSelectedFieldsToApply(prev => ({ ...prev, deadline: e.target.checked }))}
                        className="accent-primary"
                      />
                      Apply
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-card border border-border/30 text-center">
                      <span className="text-[9px] text-muted-foreground block">Current:</span>
                      <span className="font-medium">{deadline || "(Empty)"}</span>
                    </div>
                    <div className="p-2 rounded bg-primary/5 border border-primary/20 text-center">
                      <span className="text-[9px] text-primary block font-bold">Suggested:</span>
                      <span className="font-bold text-foreground">{ocrSuggestion.deadline}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Field: Word Count (suggests pages) */}
              {ocrSuggestion?.wordCount && (
                <div className="border border-border/20 rounded-xl p-3 bg-secondary/10 flex flex-col gap-2 sm:col-span-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-foreground font-semibold">Word Count & Suggested Pages</span>
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={selectedFieldsToApply.pageCount} 
                        onChange={(e) => setSelectedFieldsToApply(prev => ({ ...prev, pageCount: e.target.checked }))}
                        className="accent-primary"
                      />
                      Apply Suggested Pages
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-card border border-border/30 text-center">
                      <span className="text-[9px] text-muted-foreground block">Current Pages:</span>
                      <span className="font-medium">{pageCount} {pageCount === 1 ? "page" : "pages"}</span>
                    </div>
                    <div className="p-2 rounded bg-primary/5 border border-primary/20 text-center">
                      <span className="text-[9px] text-primary block font-bold">Suggested:</span>
                      <span className="font-bold text-foreground">
                        {ocrSuggestion.wordCount} words (~{Math.max(1, Math.min(15, Math.ceil(ocrSuggestion.wordCount / 275)))} pages)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-border/20">
            <Button variant="outline" size="sm" onClick={handleIgnoreSuggestions}>
              Ignore All
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleApplySuggestions("selected")}>
                Apply Selected
              </Button>
              <Button variant="primary" size="sm" onClick={() => handleApplySuggestions("all")}>
                Apply All Suggestions
              </Button>
            </div>
          </div>
        </div>
      </Modal>

    </div>
  );
}
