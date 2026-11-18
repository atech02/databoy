"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { projectService } from "@/services/projectService";
import { apiClient } from "@/services/apiClient";
import { ocrService } from "@/services/ocrService";
import { storageService } from "@/services/storageService";
import MobileMoneyCheckoutModal from "@/components/payment/MobileMoneyCheckoutModal";
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
    academicLevel: true,
    subject: true,
    referencingStyle: true,
    deadline: true,
    pageCount: true
  });

  // Extraction Metadata & Review States
  const [detectedLanguage, setDetectedLanguage] = useState<string>("English");
  const [fieldsRequiringReview, setFieldsRequiringReview] = useState<string[]>([]);
  const [fieldConfidences, setFieldConfidences] = useState<Record<string, { confidence: "high" | "medium" | "low"; evidence?: string | null }>>({});
  const [autofillSuccessMessage, setAutofillSuccessMessage] = useState<string | null>(null);

  // Payment Checkout Modal States
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [pendingAssignmentId, setPendingAssignmentId] = useState<string>("");
  const [pendingBudget, setPendingBudget] = useState<number>(0);

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
    
    // PDF Pre-Check & Limit Safeguards (Digital: 50 pages, Scanned: 5 pages)
    if (fileType === "PDF") {
      try {
        setIsOcrProcessing(true);
        setOcrLog("Analyzing PDF page count and text layout...");
        setOcrProgress(5);
        
        // Dynamically load PDF.js from DocumentProcessor
        const { PDFTextExtractor, DIGITAL_PDF_MAX_PAGES } = await import("@/services/documentProcessor");
        const pdfExtractor = new PDFTextExtractor();
        const pdfjs = (window as any).pdfjsLib || (await (pdfExtractor as any).loadPdfJS());
        
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        if (pdf.numPages > DIGITAL_PDF_MAX_PAGES) {
          setError(`This document contains ${pdf.numPages} pages. In-browser extraction is limited to the first ${DIGITAL_PDF_MAX_PAGES} pages to maintain browser performance. For larger files, please upload the assignment brief pages.`);
        }
      } catch (err: any) {
        console.warn("PDF pre-flight inspection warning:", err);
      } finally {
        setIsOcrProcessing(false);
      }
    }

    const newDiagnostics: any = {
      fileType,
      stage: "Uploading to R2...",
      uploadStatus: "Pending",
      ocrStatus: "Pending",
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
      uploadErrors: [],
      ocrErrors: [],
      errors: []
    };
    setDiagnostics(newDiagnostics);

    setBriefFile(file);
    setIsOcrProcessing(true);
    setOcrProgress(10);
    setOcrLog("Uploading your document securely...");
    setOcrConfidence(null);
    setOcrMetrics(null);

    let downloadedUrl = "";
    let filePath = "";
    let uploadedFileId = "";
    try {
      if (!profile?.uid) {
        throw new Error("You must be signed in to upload assignment files.");
      }
      const uploadRes = await storageService.uploadFile("pending", profile.uid, file, (progress) => {
        setOcrLog(`Uploading your document securely (${progress}%)...`);
      });
      downloadedUrl = uploadRes.url;
      filePath = uploadRes.storageKey;
      uploadedFileId = uploadRes.fileId;

      newDiagnostics.uploadStatus = "Success";
      newDiagnostics.stage = "Upload Verified, Extracting Text...";
      setDiagnostics({ ...newDiagnostics });

      const briefProjectFile: ProjectFile = {
        uid: "file-brief-" + Math.floor(1000 + Math.random() * 9000),
        fileId: uploadRes.fileId,
        storageKey: uploadRes.storageKey,
        storagePath: uploadRes.path,
        storageProvider: "r2",
        contentType: uploadRes.contentType,
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
      const errMsg = err?.message || String(err);
      newDiagnostics.uploadStatus = "Failed";
      newDiagnostics.stage = "Upload Failed";
      newDiagnostics.uploadErrors.push("Storage Upload Failure: " + errMsg);
      newDiagnostics.errors.push("Storage Upload Failure: " + errMsg);
      setDiagnostics({ ...newDiagnostics });
      setIsOcrProcessing(false);
      setOcrLog("Upload failed. Please check your connection or retry.");
      return;
    }

    let result: any = null;
    try {
      result = await ocrService.extractText(
        file, 
        (status, progress) => {
          let friendlyStatus = status;
          if (progress <= 25) {
            friendlyStatus = "Uploading and preparing document...";
          } else if (progress <= 55) {
            friendlyStatus = "Processing document layout and text...";
          } else if (progress <= 85) {
            friendlyStatus = "Extracting assignment information...";
          } else {
            friendlyStatus = "Review required: preparing assignment details...";
          }
          setOcrLog(friendlyStatus);
          setOcrProgress(progress);
        },
        projectId,
        profile?.uid || "unknown-customer",
        downloadedUrl,
        filePath,
        uploadedFileId
      );
      
      const charCount = (result.rawText || "").length;
      newDiagnostics.method = result.ocrMetrics?.extractionMethod || "Extraction Complete";
      newDiagnostics.charCount = charCount;
      newDiagnostics.preview = result.rawText.substring(0, 500);
      newDiagnostics.pageCount = result.ocrMetrics?.pageCount || 1;
      newDiagnostics.processedPages = result.ocrMetrics?.processedPages || 1;
      newDiagnostics.hasUnprocessedPages = result.ocrMetrics?.hasUnprocessedPages || false;
      newDiagnostics.unprocessedReason = result.ocrMetrics?.unprocessedReason;
      newDiagnostics.cacheKey = result.ocrMetrics?.cacheKey || result.cacheKey;
      newDiagnostics.engineVersion = result.ocrMetrics?.engineVersion || "v1.0";
      newDiagnostics.warnings = result.ocrMetrics?.warnings || [];

      if (result.ocrMetrics?.hasUnprocessedPages && result.ocrMetrics?.unprocessedReason) {
        newDiagnostics.ocrErrors.push(`Limit Note: ${result.ocrMetrics.unprocessedReason}`);
      }

      if (charCount > 0) {
        newDiagnostics.ocrStatus = "Success";
        newDiagnostics.stage = result.ocrMetrics?.hasUnprocessedPages ? "Partially Extracted (Limits Applied)" : "Text Extracted, Parsing Assignment...";
      } else {
        newDiagnostics.ocrStatus = "Warning";
        newDiagnostics.stage = "0 Characters Extracted";
        newDiagnostics.ocrErrors.push("No readable characters detected in uploaded document. Manual input required.");
      }

      setExtractedOcrText(result.rawText);
      setOcrConfidence(result.confidence);
      setOcrMetrics(result.ocrMetrics);
      setDiagnostics({ ...newDiagnostics });
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const errType = fileType === "PDF" ? "PDF Extraction Failure" : "OCR Extraction Failure";
      newDiagnostics.ocrStatus = "Failed";
      newDiagnostics.stage = "OCR Failed";
      newDiagnostics.ocrErrors.push(`${errType}: ${errMsg}`);
      newDiagnostics.errors.push(`${errType}: ${errMsg}`);
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

        const assignedTitle = parsed.assignment_title || parsed.title;
        const assignedBrief = parsed.assignment_brief || parsed.questions || parsed.guidelines || parsed.instructions;
        const assignedLevel = parsed.academic_level || parsed.academicLevel;
        const assignedSubject = parsed.subject_or_discipline || parsed.subject;
        const assignedRef = parsed.referencing_style || parsed.referencingStyle;
        const assignedDeadline = parsed.submission_deadline || parsed.deadline;
        const assignedPages = parsed.requested_page_count || parsed.pageCount;
        const assignedLang = parsed.language || "English";
        const reviewList = parsed.fields_requiring_review || [];

        const confidences = parsed.field_confidences || {};
        setFieldConfidences(confidences);
        setDetectedLanguage(assignedLang);
        setFieldsRequiringReview(reviewList);

        // Check if student has manually edited during processing (Revision 10 Overwrite Protection)
        const hasEdited = hasUserEditedTitle || hasUserEditedGuidelines;

        if (hasEdited) {
          // Keep current form state but trigger suggestion banner/modal
          setShowReviewBanner(true);
        } else {
          // Auto-populate based on strict evidence policy:
          // High: populate with success badge
          // Medium: populate with warning badge
          // Low: leave blank/neutral and request manual review
          if (assignedBrief && confidences.assignment_brief?.confidence !== "low") {
            setGuidelines(assignedBrief);
            briefApplied = "Yes";
          }
          if (assignedTitle && confidences.assignment_title?.confidence !== "low") {
            setTitle(assignedTitle);
            titleApplied = "Yes";
          }
          if (assignedLevel && confidences.academic_level?.confidence !== "low") {
            setAcademicLevel(assignedLevel);
          }
          if (assignedSubject && confidences.subject_or_discipline?.confidence !== "low") {
            setSubject(assignedSubject);
          }
          if (assignedRef && confidences.referencing_style?.confidence !== "low") {
            setReferencingStyle(assignedRef);
          }
          if (assignedDeadline && confidences.submission_deadline?.confidence !== "low") {
            setDeadline(assignedDeadline);
          }
          if (confidences.requested_page_count?.confidence === "high" && assignedPages && !hasManuallyAdjustedPages) {
            const safePages = Math.max(1, Math.min(15, assignedPages));
            setPageCount(safePages);
            wordCountApplied = "Yes";
          } else if (confidences.word_count?.confidence === "high" && parsed.word_count && !hasManuallyAdjustedPages) {
            const safePages = Math.max(1, Math.min(15, Math.ceil(parsed.word_count / 250)));
            setPageCount(safePages);
            wordCountApplied = "Yes";
          }
          setShowReviewBanner(false);
          setAutofillSuccessMessage("Assignment details extracted. Please review the highlighted fields.");
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
    const target = filesList.find(f => f.uid === uid);
    if (target?.fileId) {
      storageService.deleteFile(target.fileId).catch(() => {});
    }
    setFilesList(prev => prev.filter(f => f.uid !== uid));
    if (uid.startsWith("file-brief-")) {
      setBriefFile(null);
      setExtractedOcrText("");
      setOcrConfidence(null);
      setOcrMetrics(null);
      setAutofillSuccessMessage(null);
    }
  };

  // Full pricing engine calculation
  const daysLeft = getDaysUntilDeadline(deadline);
  const pricingResult = calculateAssignmentPricing(pageCount, academicLevel, daysLeft, "assignment");
  const academicPriceZMW = pricingResult.total;
  const breakdown = calculateCommissionBreakdown(academicPriceZMW);

  // Note: Page budget is driven authoritatively by document extraction (requested_page_count or explicit word_count)
  // or student manual adjustment, NEVER by counting the assignment brief prompt's words.

  const handleApplySuggestions = (mode: "all" | "selected") => {
    if (!ocrSuggestion) return;

    if (mode === "all" || selectedFieldsToApply.title) {
      const t = ocrSuggestion.assignment_title || ocrSuggestion.title;
      if (t) setTitle(t);
    }
    if (mode === "all" || selectedFieldsToApply.guidelines) {
      const suggestionBrief = ocrSuggestion.assignment_brief || ocrSuggestion.questions || ocrSuggestion.guidelines || ocrSuggestion.instructions;
      if (suggestionBrief) setGuidelines(suggestionBrief);
    }
    if (mode === "all" || selectedFieldsToApply.academicLevel) {
      const lvl = ocrSuggestion.academic_level || ocrSuggestion.academicLevel;
      if (lvl) setAcademicLevel(lvl);
    }
    if (mode === "all" || selectedFieldsToApply.subject) {
      const s = ocrSuggestion.subject_or_discipline || ocrSuggestion.subject;
      if (s) setSubject(s);
    }
    if (mode === "all" || selectedFieldsToApply.referencingStyle) {
      const r = ocrSuggestion.referencing_style || ocrSuggestion.referencingStyle;
      if (r) setReferencingStyle(r);
    }
    if (mode === "all" || selectedFieldsToApply.deadline) {
      const d = ocrSuggestion.submission_deadline || ocrSuggestion.deadline;
      if (d) setDeadline(d);
    }
    if (mode === "all" || selectedFieldsToApply.pageCount) {
      const p = ocrSuggestion.requested_page_count || ocrSuggestion.pageCount;
      if (p) {
        setPageCount(Math.max(1, Math.min(15, p)));
      } else if (ocrSuggestion.word_count || ocrSuggestion.wordCount) {
        const wc = ocrSuggestion.word_count || ocrSuggestion.wordCount;
        setPageCount(Math.max(1, Math.min(15, Math.ceil(wc / 250))));
      }
    }

    setShowReviewModal(false);
    setShowReviewBanner(false);
  };

  const handleIgnoreSuggestions = () => {
    setShowReviewModal(false);
    setShowReviewBanner(false);
  };

  const handleSubmitAcademic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setError(null);

    if (!title.trim() || !deadline || !guidelines.trim()) {
      setError("Please complete all fields: Title, Deadline, and Guidelines/Text are required.");
      return;
    }

    try {
      if (!pendingAssignmentId) {
        const res: any = await apiClient.post("/api/assignments", {
          title: title.trim(),
          description: guidelines.trim(),
          academicLevel,
          subject: subject || "general",
          deadline,
          wordCount: guidelines.trim().split(/\s+/).filter(Boolean).length || pageCount * 250,
          pageCount,
          serviceType: "assignment",
          referencingStyle,
          files: filesList,
        });
        setPendingAssignmentId(res.assignmentId);
        setPendingBudget(Number(res.budget || academicPriceZMW));
      }
      setShowCheckoutModal(true);
    } catch (err: any) {
      setError(err?.message || "Failed to create assignment for checkout.");
    }
  };

  const handleModalClose = () => {
    setShowSuccessModal(false);
    router.push("/dashboard");
  };

  const renderFieldBadge = (fieldName: string) => {
    const info = fieldConfidences[fieldName];
    const isUnderReview = fieldsRequiringReview.includes(fieldName) || 
      (fieldName === "assignment_title" && fieldsRequiringReview.includes("title")) ||
      (fieldName === "submission_deadline" && fieldsRequiringReview.includes("deadline")) ||
      (fieldName === "academic_level" && fieldsRequiringReview.includes("academicLevel")) ||
      (fieldName === "referencing_style" && fieldsRequiringReview.includes("referencingStyle")) ||
      (fieldName === "subject_or_discipline" && fieldsRequiringReview.includes("subject")) ||
      (fieldName === "requested_page_count" && fieldsRequiringReview.includes("pageCount"));

    if (info?.confidence === "high" && !isUnderReview) {
      return (
        <span className="text-[10px] text-success font-bold flex items-center gap-1">
          ✓ Extracted
        </span>
      );
    }
    if (info?.confidence === "medium" || isUnderReview) {
      return (
        <span className="text-[10px] text-amber-500 font-bold flex items-center gap-1">
          ⚠️ Please verify
        </span>
      );
    }
    return (
      <span className="text-[10px] text-muted-foreground/80 font-medium flex items-center gap-1">
        ✏️ Manual entry
      </span>
    );
  };

  const currentWorkflowStep: number = showSuccessModal || showCheckoutModal
    ? 7
    : isOcrProcessing
    ? 2
    : briefFile && extractedOcrText && fieldsRequiringReview.length > 0
    ? 3
    : briefFile && extractedOcrText && (academicPriceZMW > 0)
    ? 6
    : briefFile && extractedOcrText
    ? 5
    : title || guidelines
    ? 4
    : 1;

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full overflow-x-hidden">
      
      {/* Back button */}
      <div className="flex items-center">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
      </div>

      {/* 7-Step Assignment Review & Pricing Experience Step Tracker */}
      <div className="w-full bg-card/60 border border-border/30 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-black uppercase tracking-wider text-muted-foreground">
            Assignment Workflow
          </span>
          <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
            Step {currentWorkflowStep} of 7 • {
              currentWorkflowStep === 1 ? "Upload Brief" :
              currentWorkflowStep === 2 ? "Process Document" :
              currentWorkflowStep === 3 ? "Review Extracted Details" :
              currentWorkflowStep === 4 ? "Edit Fields" :
              currentWorkflowStep === 5 ? "Confirm Requirements" :
              currentWorkflowStep === 6 ? "Review Pricing" : "Checkout"
            }
          </span>
        </div>
        
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {[
            { num: 1, label: "Upload" },
            { num: 2, label: "Process" },
            { num: 3, label: "Review" },
            { num: 4, label: "Edit" },
            { num: 5, label: "Confirm" },
            { num: 6, label: "Pricing" },
            { num: 7, label: "Checkout" },
          ].map((s) => (
            <div key={s.num} className="flex flex-col items-center gap-1">
              <div
                className={`w-full h-1.5 rounded-full transition-all duration-300 ${
                  currentWorkflowStep >= s.num ? "bg-primary" : "bg-secondary"
                }`}
              />
              <span
                className={`hidden sm:block text-[9px] font-bold truncate ${
                  currentWorkflowStep === s.num
                    ? "text-primary font-black"
                    : currentWorkflowStep > s.num
                    ? "text-foreground"
                    : "text-muted-foreground/60"
                }`}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
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

              {/* General Extraction Status Banner */}
              {briefFile && !isOcrProcessing && extractedOcrText && !showReviewBanner && (
                <div className="flex flex-col gap-2.5 p-4 rounded-xl border border-border/40 bg-card shadow-sm text-xs">
                  <div className="flex items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{fieldsRequiringReview.length > 0 ? "⚠️" : "✨"}</span>
                      <div>
                        <span className="font-bold text-foreground block">
                          Assignment details extracted. Please review the highlighted fields.
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Detected Language: <strong className="text-foreground">{detectedLanguage}</strong> • Page Budget: <strong className="text-primary">{pageCount} {pageCount === 1 ? "page" : "pages"}</strong> • Estimated Price: <strong className="text-foreground font-mono">K{academicPriceZMW}</strong>
                        </span>
                      </div>
                    </div>
                    {fieldsRequiringReview.length > 0 ? (
                      <Badge variant="warning" className="text-[9px] uppercase font-bold shrink-0">
                        {fieldsRequiringReview.length} {fieldsRequiringReview.length === 1 ? "Field" : "Fields"} To Confirm
                      </Badge>
                    ) : (
                      <Badge variant="success" className="text-[9px] uppercase font-bold shrink-0">
                        Autofilled
                      </Badge>
                    )}
                  </div>

                  {fieldsRequiringReview.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/20 text-[10px]">
                      <span className="text-muted-foreground font-bold uppercase">Please confirm:</span>
                      {fieldsRequiringReview.map((f) => (
                        <span key={f} className="bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded font-mono font-bold">
                          {f.replace(/_/g, " ")}
                        </span>
                      ))}
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
                  label={
                    <span className="flex items-center justify-between w-full">
                      <span>Assignment Title</span>
                      {renderFieldBadge("assignment_title")}
                    </span>
                  }
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
                    label={
                      <span className="flex items-center justify-between w-full">
                        <span>Academic Level</span>
                        {renderFieldBadge("academic_level")}
                      </span>
                    }
                    options={ACADEMIC_LEVELS}
                    value={academicLevel}
                    onChange={(e) => setAcademicLevel(e.target.value)}
                  />

                  <Select
                    label={
                      <span className="flex items-center justify-between w-full">
                        <span>Subject / Discipline</span>
                        {renderFieldBadge("subject_or_discipline")}
                      </span>
                    }
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
                     label={
                       <span className="flex items-center justify-between w-full">
                         <span>Referencing Style</span>
                         {renderFieldBadge("referencing_style")}
                       </span>
                     }
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
                    label={
                      <span className="flex items-center justify-between w-full">
                        <span>Submission Target Deadline</span>
                        {renderFieldBadge("submission_deadline")}
                      </span>
                    }
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    required
                  />
                </div>

                {/* Page count slider & Pricing visual engine */}
                <div className="flex flex-col gap-3.5 bg-card/65 p-4 rounded-xl border border-border/40 shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <span>Select Page Budget</span>
                      {renderFieldBadge("requested_page_count")}
                    </span>
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

                    {/* Customer-facing milestone protection notice (Replaces internal commission splits) */}
                    <div className="p-3 bg-secondary/25 rounded-lg border border-border/20 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="text-base">🛡️</span>
                        <span className="font-medium text-foreground">DataBoy Milestone Escrow</span>
                      </div>
                      <span className="text-[10px] font-bold text-success uppercase tracking-wider bg-success/10 px-2 py-0.5 rounded-full">
                        AI-Free & Protected
                      </span>
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

      {/* Admin-Only RBAC Protected Diagnostics (Invisible to Students) */}
      {profile?.role === "admin" && diagnostics && (
        <details className="mt-4 p-4 bg-secondary/15 border border-warning/30 rounded-xl text-xs font-mono text-muted-foreground">
          <summary className="cursor-pointer font-bold text-warning flex items-center justify-between select-none">
            <span className="flex items-center gap-2">🛠️ Admin Diagnostics & Telemetry (RBAC Protected)</span>
            <span className="text-[10px] uppercase bg-warning/10 text-warning px-2 py-0.5 rounded">Admin Only</span>
          </summary>
          <div className="pt-3 flex flex-col gap-2 border-t border-border/20 mt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
              <div>File Type: <strong className="text-foreground">{diagnostics.fileType}</strong></div>
              <div>R2 Status: <strong className={diagnostics.uploadStatus === "Success" ? "text-success" : "text-danger"}>{diagnostics.uploadStatus}</strong></div>
              <div>OCR Status: <strong className={diagnostics.ocrStatus === "Success" ? "text-success" : "text-amber-500"}>{diagnostics.ocrStatus}</strong></div>
              <div>Pages: <strong className="text-foreground">{diagnostics.processedPages || 1} / {diagnostics.pageCount || 1}</strong></div>
            </div>
            {diagnostics.cacheKey && (
              <div className="text-[9px] text-muted-foreground/80 break-all font-mono">
                Cache Key: {String(diagnostics.cacheKey)}
              </div>
            )}
            {diagnostics.preview && (
              <pre className="p-2 bg-secondary/40 rounded max-h-24 overflow-y-auto text-[9px] whitespace-pre-wrap">
                {diagnostics.preview}
              </pre>
            )}
          </div>
        </details>
      )}

      {/* ======================================================================
          LIPILA MOBILE MONEY CHECKOUT MODAL
          ====================================================================== */}
      <MobileMoneyCheckoutModal
        isOpen={showCheckoutModal && Boolean(pendingAssignmentId)}
        onClose={() => setShowCheckoutModal(false)}
        assignmentId={pendingAssignmentId}
        targetType="assignment"
        assignmentTitle={title || "Academic Assignment"}
        amount={pendingBudget || academicPriceZMW}
        onSuccess={() => {
          setCreatedId(pendingAssignmentId);
          setShowCheckoutModal(false);
          setShowSuccessModal(true);
        }}
      />

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
              {/* Field: Academic Level */}
              {(ocrSuggestion?.academic_level || ocrSuggestion?.academicLevel) && (
                <div className="border border-border/20 rounded-xl p-3 bg-secondary/10 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-foreground font-semibold">Academic Level</span>
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={selectedFieldsToApply.academicLevel} 
                        onChange={(e) => setSelectedFieldsToApply(prev => ({ ...prev, academicLevel: e.target.checked }))}
                        className="accent-primary"
                      />
                      Apply
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-card border border-border/30 text-center">
                      <span className="text-[9px] text-muted-foreground block">Current:</span>
                      <span className="font-medium">{academicLevel || "(Empty)"}</span>
                    </div>
                    <div className="p-2 rounded bg-primary/5 border border-primary/20 text-center">
                      <span className="text-[9px] text-primary block font-bold">Suggested:</span>
                      <span className="font-bold text-foreground">{ocrSuggestion.academic_level || ocrSuggestion.academicLevel}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Field: Subject / Discipline */}
              {(ocrSuggestion?.subject_or_discipline || ocrSuggestion?.subject) && (
                <div className="border border-border/20 rounded-xl p-3 bg-secondary/10 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-foreground font-semibold">Subject / Discipline</span>
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={selectedFieldsToApply.subject} 
                        onChange={(e) => setSelectedFieldsToApply(prev => ({ ...prev, subject: e.target.checked }))}
                        className="accent-primary"
                      />
                      Apply
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-card border border-border/30 text-center">
                      <span className="text-[9px] text-muted-foreground block">Current:</span>
                      <span className="font-medium">{subject || "(Empty)"}</span>
                    </div>
                    <div className="p-2 rounded bg-primary/5 border border-primary/20 text-center">
                      <span className="text-[9px] text-primary block font-bold">Suggested:</span>
                      <span className="font-bold text-foreground">
                        {SUBJECT_EXPERTISE.find(s => s.value === (ocrSuggestion.subject_or_discipline || ocrSuggestion.subject))?.label || (ocrSuggestion.subject_or_discipline || ocrSuggestion.subject)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

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
