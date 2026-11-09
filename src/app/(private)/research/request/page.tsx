"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { researchService } from "@/services/researchService";
import { storageService } from "@/services/storageService";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { BackButton } from "@/components/ui/BackButton";
import { Badge } from "@/components/ui/Badge";

// Conversational entry screen choices
const SERVICE_CHOICES = [
  { value: "topic_generation", label: "Help me find a research topic", desc: "For students starting without a topic or needing ideas." },
  { value: "proposal_writing", label: "Help me write a proposal", desc: "Crafting structured outlines or academic proposal briefs." },
  { value: "data_collection", label: "Help me collect research data", desc: "Setting up surveys, questionnaires, or interview frameworks." },
  { value: "data_analysis", label: "Help me analyse research data", desc: "Numbers, statistics, interviews, SPSS, STATA, NVivo analyses." },
  { value: "report_writing", label: "Help me write my research report", desc: "Writing reports, chapters (1-5), or final dissertations." },
  { value: "journal_article", label: "Help me write a journal article", desc: "Drafting, rewriting, or polishing manuscripts for journals." },
  { value: "publishing_support", label: "Help me publish my work", desc: "Review response, manuscript adjustments, and submission guidance." }
];

// Conversational lookups
const PROGRAMMES = [
  { value: "business_administration", label: "Business Administration" },
  { value: "accounting", label: "Accounting" },
  { value: "economics", label: "Economics" },
  { value: "education", label: "Education" },
  { value: "law", label: "Law" },
  { value: "computer_science", label: "Computer Science" }
];

const LEVELS_OF_STUDY = [
  { value: "diploma", label: "Diploma" },
  { value: "degree", label: "Degree" },
  { value: "masters", label: "Masters" },
  { value: "phd", label: "PhD" }
];

const WHERE_ARE_YOU_OPTIONS = [
  { value: "need_topic", label: "I need help finding a topic" },
  { value: "rough_idea", label: "I have a rough idea but need help refining it" },
  { value: "have_topic_feedback", label: "I already have a topic and would like feedback" }
];

const DATA_COLLECTION_METHODS = [
  { value: "questionnaire", label: "Questionnaire" },
  { value: "interview", label: "Interview" },
  { value: "focus_group", label: "Focus Group" },
  { value: "observation", label: "Observation" },
  { value: "not_sure", label: "Not sure yet" }
];

const DATA_TYPES = [
  { value: "quantitative", label: "Numbers and statistics" },
  { value: "qualitative", label: "Interviews and discussions" },
  { value: "mixed", label: "A combination of both" },
  { value: "not_sure", label: "I'm not sure" }
];

const QUANT_SOFTWARE = [
  { value: "spss", label: "SPSS" },
  { value: "stata", label: "STATA" },
  { value: "excel", label: "Excel" },
  { value: "r", label: "R" },
  { value: "none", label: "No specific software preference" }
];

const QUAL_SOFTWARE = [
  { value: "nvivo", label: "NVivo" },
  { value: "atlas_ti", label: "Atlas.ti" },
  { value: "manual_thematic", label: "Manual Thematic Analysis" },
  { value: "none", label: "No specific software preference" }
];

const REPORT_PARTS = [
  { value: "chapter_1", label: "Chapter 1" },
  { value: "chapter_2", label: "Chapter 2" },
  { value: "chapter_3", label: "Chapter 3" },
  { value: "chapter_4", label: "Chapter 4" },
  { value: "chapter_5", label: "Chapter 5" },
  { value: "multiple_chapters", label: "Multiple Chapters" },
  { value: "full_report", label: "Full Report" }
];

const ARTICLE_STAGES = [
  { value: "starting", label: "Just starting" },
  { value: "draft_available", label: "Working on a draft" },
  { value: "improving_draft", label: "Need help improving a draft" },
  { value: "final_manuscript", label: "Final manuscript preparation" }
];

const PUBLISHING_STATUSES = [
  { value: "not_started", label: "Not started" },
  { value: "draft_available", label: "Draft available" },
  { value: "ready_for_submission", label: "Ready for submission" },
  { value: "submitted", label: "Submitted" },
  { value: "revisions_requested", label: "Revisions requested" },
  { value: "rejected", label: "Rejected" },
  { value: "accepted", label: "Accepted" }
];

const PROGRAMME_DIRECTIONS: Record<string, string[]> = {
  business_administration: [
    "Entrepreneurship and Small Business Innovation",
    "Corporate Social Responsibility (CSR) and Brand Equity",
    "Organizational Behavior & Hybrid Workplace Productivity",
    "Operations Management & Sustainable Supply Chain Logistics"
  ],
  accounting: [
    "Internal Audit Controls & Corporate Governance Integrity",
    "Microfinance, Mobile Money & Financial Inclusion in Emerging Markets",
    "Modern Retail Banking Systems & Liquidity Risk Management",
    "Capital Markets, Crowdfunding & Portfolio Management"
  ],
  economics: [
    "Macroeconomic Stability and Economic Growth Policies",
    "Inflation, Monetary Policy and Cost of Living Indicators",
    "Trade Deficit and Currency Exchange Rate Fluctuations",
    "Labor Market Dynamics and Youth Employment Interventions"
  ],
  education: [
    "Inclusive Education Practices for Special Needs Students",
    "Innovative Pedagogical Methodologies in STEM Subjects",
    "Early Childhood Development & Socialization Dynamics",
    "Educational Technology, Gamification & Online Learning Quality"
  ],
  law: [
    "Corporate Law, Mergers & Acquisitions Regulations",
    "Human Rights Violations & Constitutional Law Safeguards",
    "Intellectual Property Rights in the Digital Age",
    "Environmental Law & Sustainable Development Policies"
  ],
  computer_science: [
    "Machine Learning Models for Predictive Analytics",
    "Cybersecurity Protocols & Encrypted Cloud Infrastructure",
    "Agile Software Development Methodologies & Devops Quality",
    "Distributed Ledger Technologies & Smart Contract Security"
  ]
};

export default function ResearchRequestIntake() {
  const router = useRouter();
  const { profile } = useAuth();

  // Selected guided path
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Common Fields
  const [programme, setProgramme] = useState("");
  const [levelOfStudy, setLevelOfStudy] = useState("");
  const [deadline, setDeadline] = useState("");
  const [briefText, setBriefText] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  
  // Topic Gen Flow
  const [whereRightNow, setWhereRightNow] = useState("");
  const [selectedDirection, setSelectedDirection] = useState("");
  const [areaOfInterest, setAreaOfInterest] = useState("");

  // Proposal Flow
  const [proposalTopic, setProposalTopic] = useState("");
  const [supervisorComments, setSupervisorComments] = useState("");

  // Data Collection Flow
  const [collectionTopic, setCollectionTopic] = useState("");
  const [collectionMethod, setCollectionMethod] = useState("");
  const [targetPopulation, setTargetPopulation] = useState("");
  const [collectionLocation, setCollectionLocation] = useState("");

  // Data Analysis Flow
  const [analysisTopic, setAnalysisTopic] = useState("");
  const [dataType, setDataType] = useState("");
  const [analysisSoftware, setAnalysisSoftware] = useState("");
  const [dataDescription, setDataDescription] = useState("");

  // Report Flow
  const [reportTopic, setReportTopic] = useState("");
  const [reportPart, setReportPart] = useState("");

  // Journal Flow
  const [journalTopic, setJournalTopic] = useState("");
  const [articleStage, setArticleStage] = useState("");
  const [targetJournal, setTargetJournal] = useState("");

  // Publishing Flow
  const [publishingTopic, setPublishingTopic] = useState("");
  const [publishingStatus, setPublishingStatus] = useState("");
  const [publishingJournal, setPublishingJournal] = useState("");

  // Form states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successRequest, setSuccessRequest] = useState<any | null>(null);

  // Clean suggestions when programme shifts
  useEffect(() => {
    setSelectedDirection("");
  }, [programme]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachedFiles(Array.from(e.target.files));
    }
  };

  const handleTypeSelect = (typeVal: string) => {
    setSelectedType(typeVal);
    setError(null);
  };

  const handleResetType = () => {
    setSelectedType(null);
    setError(null);
  };

  const getExpectedDeliverable = (): string => {
    switch (selectedType) {
      case "topic_generation":
        return "Generated Research Topics list matching programme";
      case "proposal_writing":
        return "Research Proposal Draft";
      case "data_collection":
        const colMethodLabel = DATA_COLLECTION_METHODS.find(m => m.value === collectionMethod)?.label || collectionMethod;
        return `Data Collection Design (${colMethodLabel})`;
      case "data_analysis":
        const typeLabel = DATA_TYPES.find(d => d.value === dataType)?.label || dataType;
        const softwareLabel = analysisSoftware ? ` using ${analysisSoftware}` : "";
        return `Data Analysis Report (${typeLabel}${softwareLabel})`;
      case "report_writing":
        const partLabel = REPORT_PARTS.find(p => p.value === reportPart)?.label || reportPart;
        return `Report writing draft (${partLabel})`;
      case "journal_article":
        const artLabel = ARTICLE_STAGES.find(a => a.value === articleStage)?.label || articleStage;
        return `Journal article drafting (${artLabel})`;
      case "publishing_support":
        const pubLabel = PUBLISHING_STATUSES.find(p => p.value === publishingStatus)?.label || publishingStatus;
        return `Publishing submission review (${pubLabel})`;
      default:
        return "Academic Research Deliverable";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedType) return;
    setError(null);
    setLoading(false); // Init local check

    // Validate universal requirements
    if (!programme) {
      setError("Please specify what program you are studying.");
      return;
    }
    if (!levelOfStudy) {
      setError("Please specify your current academic level of study.");
      return;
    }

    // Branch specific validation & mapping
    let finalTopic = "";
    let finalDeadline = "";
    let finalBrief = "";

    const futureDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    if (selectedType === "topic_generation") {
      if (!whereRightNow) {
        setError("Please clarify where you are right now in your topic search.");
        return;
      }
      if (!selectedDirection) {
        setError("Please choose a suggested direction to guide your topic generation.");
        return;
      }
      
      const progLabel = PROGRAMMES.find(p => p.value === programme)?.label || programme;
      finalTopic = `[Topic Generation Request] ${progLabel} - Focus: ${selectedDirection}`;
      finalDeadline = futureDeadline; // default compatibility
      
      // Conversational brief assembly
      const areaText = areaOfInterest ? `\n- Stated Interest Focus: ${areaOfInterest}` : "";
      const currentStageLabel = WHERE_ARE_YOU_OPTIONS.find(o => o.value === whereRightNow)?.label || whereRightNow;
      finalBrief = `Topic Generation Guided Lane:
- Program major: ${progLabel}
- Academic Level: ${levelOfStudy}
- Current Status: ${currentStageLabel}
- Topic Direction Chosen: ${selectedDirection}${areaText}
\nStudent Notes:\n${briefText || "None provided."}`;
    }

    else if (selectedType === "proposal_writing") {
      if (!proposalTopic.trim()) {
        setError("Please specify your research topic.");
        return;
      }
      if (!deadline) {
        setError("Please pick a target deadline.");
        return;
      }
      if (!briefText.trim()) {
        setError("Please tell us what you need help with.");
        return;
      }
      finalTopic = proposalTopic;
      finalDeadline = deadline;
      finalBrief = `Proposal Writing Request:
${briefText}
${supervisorComments ? `\nSupervisor Feedback Comments:\n${supervisorComments}` : ""}`;
    }

    else if (selectedType === "data_collection") {
      if (!collectionTopic.trim()) {
        setError("Please specify your research topic.");
        return;
      }
      if (!deadline) {
        setError("Please pick a target deadline.");
        return;
      }
      if (!collectionMethod) {
        setError("Please clarify how you plan to collect your data.");
        return;
      }
      if (!briefText.trim()) {
        setError("Please tell us what you need help with.");
        return;
      }
      finalTopic = collectionTopic;
      finalDeadline = deadline;
      const methodLabel = DATA_COLLECTION_METHODS.find(m => m.value === collectionMethod)?.label || collectionMethod;
      finalBrief = `Data Collection Support:
- Preferred Method: ${methodLabel}
- Target Population: ${targetPopulation || "Unspecified"}
- Scope Location: ${collectionLocation || "Unspecified"}
\nInstructions & Brief:\n${briefText}`;
    }

    else if (selectedType === "data_analysis") {
      if (!analysisTopic.trim()) {
        setError("Please specify your research topic.");
        return;
      }
      if (!dataType) {
        setError("Please clarify what kind of data you are working with.");
        return;
      }
      if (!briefText.trim()) {
        setError("Please tell us what you need help with.");
        return;
      }
      finalTopic = analysisTopic;
      finalDeadline = deadline || futureDeadline;
      const typeLabel = DATA_TYPES.find(d => d.value === dataType)?.label || dataType;
      finalBrief = `Data Analysis Support:
- Data Structure: ${typeLabel}
- Selected Analytics Software: ${analysisSoftware || "Not specified / open recommendations"}
- Data Description Details: ${dataDescription || "Not provided."}
\nInstructions & Guidelines:\n${briefText}`;
    }

    else if (selectedType === "report_writing") {
      if (!reportTopic.trim()) {
        setError("Please specify your research topic.");
        return;
      }
      if (!deadline) {
        setError("Please pick a target deadline.");
        return;
      }
      if (!reportPart) {
        setError("Please pick what part of the report you need help with.");
        return;
      }
      if (!briefText.trim()) {
        setError("Please tell us what you need help with.");
        return;
      }
      finalTopic = reportTopic;
      finalDeadline = deadline;
      const partLabel = REPORT_PARTS.find(p => p.value === reportPart)?.label || reportPart;
      finalBrief = `Report Chapter Drafting Support:
- Target Deliverable Component: ${partLabel}
${supervisorComments ? `\nSupervisor Feedback Comments:\n${supervisorComments}` : ""}
\nDrafting Guidelines:\n${briefText}`;
    }

    else if (selectedType === "journal_article") {
      if (!journalTopic.trim()) {
        setError("Please specify your research topic.");
        return;
      }
      if (!deadline) {
        setError("Please pick a target deadline.");
        return;
      }
      if (!articleStage) {
        setError("Please specify where you are in the writing process.");
        return;
      }
      if (!briefText.trim()) {
        setError("Please tell us what you need help with.");
        return;
      }
      finalTopic = journalTopic;
      finalDeadline = deadline;
      const processLabel = ARTICLE_STAGES.find(s => s.value === articleStage)?.label || articleStage;
      finalBrief = `Journal Article Development:
- Writing Stage Status: ${processLabel}
- Targeted Journal Vetting: ${targetJournal || "Unspecified"}
\nInstructions & Draft Guidance:\n${briefText}`;
    }

    else if (selectedType === "publishing_support") {
      if (!publishingTopic.trim()) {
        setError("Please specify your research topic or manuscript title.");
        return;
      }
      if (!publishingStatus) {
        setError("Please select what stage your manuscript is currently at.");
        return;
      }
      if (!briefText.trim()) {
        setError("Please tell us what you need help with.");
        return;
      }
      finalTopic = publishingTopic;
      finalDeadline = deadline || futureDeadline;
      const statusLabel = PUBLISHING_STATUSES.find(s => s.value === publishingStatus)?.label || publishingStatus;
      finalBrief = `Publishing Vetting Support:
- Manuscript Vetting Stage: ${statusLabel}
- Destination Journal Name: ${publishingJournal || "Unspecified"}
\nTarget Guidelines:\n${briefText}`;
    }

    // Attach custom notes if provided
    if (additionalNotes.trim()) {
      finalBrief += `\n\nAdditional Student Notes:\n${additionalNotes}`;
    }

    setLoading(true);
    try {
      // Direct upload to Firebase Storage exactly as submitted (bypass OCR)
      const filesMetadata = await Promise.all(
        attachedFiles.map(async (file) => {
          const tempReqId = "draft-" + Math.floor(1000 + Math.random() * 9000);
          const uploadResult = await storageService.uploadFile("research", tempReqId, file);
          const downloadUrl = uploadResult.url;
          return {
            uid: `file-${Math.floor(1000 + Math.random() * 9000)}`,
            name: file.name,
            url: downloadUrl,
            uploadedBy: profile.uid,
            uploadedAt: new Date().toISOString(),
            sizeBytes: file.size
          };
        })
      );

      const requestPayload = {
        studentId: profile.uid,
        requestTypes: [selectedType],
        otherDetails: "",
        pastedBrief: finalBrief,
        expectedDeliverable: getExpectedDeliverable(),
        subject: PROGRAMMES.find(p => p.value === programme)?.label || programme,
        levelOfStudy: LEVELS_OF_STUDY.find(l => l.value === levelOfStudy)?.label || levelOfStudy,
        deadline: finalDeadline,
        uploadedFiles: filesMetadata,
        files: filesMetadata,
        title: finalTopic
      };

      const created = await researchService.createResearchRequest(requestPayload);
      setSuccessRequest(created);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to create guided research request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // SUCCESS Hydrated view block
  if (successRequest) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="text-5xl animate-bounce select-none">🔬</div>
        <Card className="shadow-xl border-border/40 w-full bg-card/65 backdrop-blur-md">
          <CardContent className="p-8 flex flex-col gap-6 items-center">
            
            {/* Human Success header */}
            <h1 className="text-2xl font-black text-foreground">
              Thanks. We&apos;ve received your request.
            </h1>
            
            <div className="bg-primary/10 text-primary border border-primary/25 rounded-xl p-5 max-w-lg">
              <p className="text-xs sm:text-sm font-bold leading-relaxed">
                “We&apos;ll review the details and prepare a tailored quote for you. You&apos;ll be notified as soon as it&apos;s ready.”
              </p>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed max-w-md font-semibold">
              You can track the progress of this request from your Research Requests dashboard.
            </p>

            <span className="text-[10px] text-muted-foreground font-mono bg-secondary/80 px-2 py-0.5 rounded">
              Request reference code: {successRequest.id}
            </span>

            <div className="flex flex-col sm:flex-row gap-3 mt-4 w-full justify-center">
              <Button variant="outline" onClick={() => router.push("/dashboard")} className="w-full sm:w-auto text-xs font-bold py-2.5">
                Go to Dashboard
              </Button>
              <Button variant="primary" onClick={() => router.push(`/research/detail?id=${successRequest.id}`)} className="w-full sm:w-auto text-xs font-bold py-2.5 bg-primary hover:bg-primary/95 text-white">
                Open Research Workspace
              </Button>
            </div>

          </CardContent>
        </Card>
      </div>
    );
  }

  // Active suggestions directions
  const suggestions = programme ? PROGRAMME_DIRECTIONS[programme] || [] : [];

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="flex items-center">
        <BackButton fallbackUrl="/dashboard" label="Dashboard" />
      </div>

      <Card className="shadow-lg border-border/40 bg-card">
        
        {/* Dynamic header toggles */}
        {!selectedType ? (
          <CardHeader className="border-b border-border/20 bg-secondary/15">
            <Badge variant="primary" className="w-fit mb-2 text-[10px] font-extrabold uppercase tracking-widest bg-primary/10 text-primary border-primary/20 select-none">
              Guided Research Intake
            </Badge>
            <CardTitle className="text-xl sm:text-2xl mt-1 font-black text-foreground">
              What would you like help with today?
            </CardTitle>
            <CardDescription className="text-xs font-medium text-muted-foreground leading-relaxed mt-1">
              Select one of our specialized academic services. We will guide you step-by-step through the details required.
            </CardDescription>
          </CardHeader>
        ) : (
          <CardHeader className="border-b border-border/20 bg-secondary/15 flex flex-row justify-between items-center gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-primary font-mono select-none">
                Active Guided Service
              </span>
              <h2 className="text-sm font-extrabold text-foreground mt-0.5 uppercase tracking-wide">
                {SERVICE_CHOICES.find(s => s.value === selectedType)?.label}
              </h2>
            </div>
            <button 
              type="button" 
              onClick={handleResetType}
              className="text-xs text-primary font-bold hover:underline select-none bg-primary/10 py-1 px-3.5 rounded-lg border border-primary/15 shrink-0"
            >
              &larr; Change Service
            </button>
          </CardHeader>
        )}

        <CardContent className="pt-6">
          {error && <Alert variant="error" title="Validation Check" className="mb-6">{error}</Alert>}

          {/* SCREEN 1: Single choice intake lane selector */}
          {!selectedType && (
            <div className="flex flex-col gap-3">
              {SERVICE_CHOICES.map(choice => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => handleTypeSelect(choice.value)}
                  className="text-left p-4 rounded-xl border border-border/45 bg-card hover:bg-secondary/20 hover:border-primary/35 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-black text-foreground tracking-tight group-hover:text-primary transition-colors">
                      {choice.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-semibold leading-relaxed">
                      {choice.desc}
                    </span>
                  </div>
                  <span className="text-primary font-black text-sm select-none shrink-0 group-hover:translate-x-1 transition-transform">
                    &rarr;
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* SCREEN 2: Branching conversational inputs */}
          {selectedType && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">

              {/* 1. UNIVERSAL STUDENT PROFILE INPUTS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="What are you studying?"
                  options={PROGRAMMES}
                  value={programme}
                  onChange={e => setProgramme(e.target.value)}
                  required
                />
                
                <Select
                  label="What level are you studying at?"
                  options={LEVELS_OF_STUDY}
                  value={levelOfStudy}
                  onChange={e => setLevelOfStudy(e.target.value)}
                  required
                />
              </div>

              {/* 2. BRANCH FLOWS DETAILS */}
              
              {/* FLOW A: Topic Generation */}
              {selectedType === "topic_generation" && (
                <div className="flex flex-col gap-6 border-t border-border/20 pt-5">
                  
                  <Select
                    label="Where are you right now?"
                    options={WHERE_ARE_YOU_OPTIONS}
                    value={whereRightNow}
                    onChange={e => setWhereRightNow(e.target.value)}
                    required
                  />

                  {programme && suggestions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1 select-none">
                        Topic suggestion directions for {PROGRAMMES.find(p => p.value === programme)?.label}:
                      </label>
                      <div className="grid grid-cols-1 gap-2">
                        {suggestions.map(dir => {
                          const isSelected = selectedDirection === dir;
                          return (
                            <button
                              key={dir}
                              type="button"
                              onClick={() => setSelectedDirection(dir)}
                              className={`text-left p-3.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-between gap-3 ${
                                isSelected
                                  ? "bg-primary/5 border-primary text-foreground"
                                  : "bg-card border-border/50 hover:bg-secondary/40 text-muted-foreground"
                              }`}
                            >
                              <span>{dir}</span>
                              {isSelected ? (
                                <span className="text-primary font-bold text-xs select-none">✓ Selected</span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/35 select-none font-semibold">Choose</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {programme && suggestions.length === 0 && (
                    <Alert variant="info" title="Lock Context">
                      Topic suggestions will render as soon as a program of study is chosen above.
                    </Alert>
                  )}

                  <Input
                    label="Is there anything you're particularly interested in researching? (Optional)"
                    placeholder="e.g. Entrepreneurship, Inclusive Education, CSR..."
                    value={areaOfInterest}
                    onChange={e => setAreaOfInterest(e.target.value)}
                  />

                  <div className="flex flex-col gap-1.5">
                    <Textarea
                      label="Tell us a little more about what you have in mind (Optional)"
                      placeholder="Share a broad idea, a preferred subject direction, or any outlines..."
                      value={briefText}
                      onChange={e => setBriefText(e.target.value)}
                      rows={5}
                    />
                    <p className="text-[10px] text-muted-foreground font-semibold leading-relaxed">
                      💡 The more information you share, the easier it will be for us to suggest a suitable direction. If you&apos;re not sure yet, that&apos;s perfectly fine.
                    </p>
                  </div>
                </div>
              )}

              {/* FLOW B: Proposal Writing */}
              {selectedType === "proposal_writing" && (
                <div className="flex flex-col gap-6 border-t border-border/20 pt-5">
                  <Input
                    label="What is your research topic?"
                    placeholder="Provide your approved or working proposal topic..."
                    value={proposalTopic}
                    onChange={e => setProposalTopic(e.target.value)}
                    required
                  />

                  <Input
                    label="When is your target deadline?"
                    type="date"
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                    required
                  />

                  <Textarea
                    label="Tell us what you need help with"
                    placeholder="What specific parts of the proposal need our assistance? Paste guidelines or word counts..."
                    value={briefText}
                    onChange={e => setBriefText(e.target.value)}
                    rows={6}
                    required
                  />

                  <Textarea
                    label="Has your supervisor given you any feedback you'd like us to consider? (Optional)"
                    placeholder="Paste specific review feedback or correction directives..."
                    value={supervisorComments}
                    onChange={e => setSupervisorComments(e.target.value)}
                    rows={3}
                  />
                </div>
              )}

              {/* FLOW C: Data Collection */}
              {selectedType === "data_collection" && (
                <div className="flex flex-col gap-6 border-t border-border/20 pt-5">
                  <Input
                    label="What is your research topic?"
                    placeholder="Enter your topic title..."
                    value={collectionTopic}
                    onChange={e => setCollectionTopic(e.target.value)}
                    required
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="How do you plan to collect your data?"
                      options={DATA_COLLECTION_METHODS}
                      value={collectionMethod}
                      onChange={e => setCollectionMethod(e.target.value)}
                      required
                    />

                    <Input
                      label="When is your target deadline?"
                      type="date"
                      value={deadline}
                      onChange={e => setDeadline(e.target.value)}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="Who will you be collecting information from? (Optional)"
                      placeholder="e.g. Small business owners, secondary teachers..."
                      value={targetPopulation}
                      onChange={e => setTargetPopulation(e.target.value)}
                    />

                    <Input
                      label="Where will the study take place? (Optional)"
                      placeholder="e.g. Lusaka, online, specific hospital..."
                      value={collectionLocation}
                      onChange={e => setCollectionLocation(e.target.value)}
                    />
                  </div>

                  <Textarea
                    label="Tell us what you need help with"
                    placeholder="Explain sample sizes, questionnaires, scale preferences, or general methods instructions..."
                    value={briefText}
                    onChange={e => setBriefText(e.target.value)}
                    rows={6}
                    required
                  />
                </div>
              )}

              {/* FLOW D: Data Analysis */}
              {selectedType === "data_analysis" && (
                <div className="flex flex-col gap-6 border-t border-border/20 pt-5">
                  <Input
                    label="What is your research topic?"
                    placeholder="Enter your topic..."
                    value={analysisTopic}
                    onChange={e => setAnalysisTopic(e.target.value)}
                    required
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="What kind of data are you working with?"
                      options={DATA_TYPES}
                      value={dataType}
                      onChange={e => setDataType(e.target.value)}
                      required
                    />

                    <Input
                      label="When is your target deadline? (Optional)"
                      type="date"
                      value={deadline}
                      onChange={e => setDeadline(e.target.value)}
                    />
                  </div>

                  {/* Conditionally software dropdown */}
                  {dataType === "quantitative" && (
                    <div className="flex flex-col gap-1.5">
                      <Select
                        label="Do you already know which software you'd like us to use? (Optional)"
                        options={QUANT_SOFTWARE}
                        value={analysisSoftware}
                        onChange={e => setAnalysisSoftware(e.target.value)}
                      />
                      <p className="text-[10px] text-muted-foreground font-semibold">
                        💡 If you&apos;re not sure, we can recommend an appropriate approach after reviewing your request.
                      </p>
                    </div>
                  )}

                  {dataType === "qualitative" && (
                    <div className="flex flex-col gap-1.5">
                      <Select
                        label="Do you already know which software you'd like us to use? (Optional)"
                        options={QUAL_SOFTWARE}
                        value={analysisSoftware}
                        onChange={e => setAnalysisSoftware(e.target.value)}
                      />
                      <p className="text-[10px] text-muted-foreground font-semibold">
                        💡 If you&apos;re not sure, we can recommend an appropriate approach after reviewing your request.
                      </p>
                    </div>
                  )}

                  {dataType === "mixed" && (
                    <div className="flex flex-col gap-1.5">
                      <Input
                        label="Do you already know which software you'd like us to use? (Optional)"
                        placeholder="e.g. SPSS and NVivo, STATA..."
                        value={analysisSoftware}
                        onChange={e => setAnalysisSoftware(e.target.value)}
                      />
                      <p className="text-[10px] text-muted-foreground font-semibold">
                        💡 If you&apos;re not sure, we can recommend an appropriate approach after reviewing your request.
                      </p>
                    </div>
                  )}

                  <Textarea
                    label="Tell us a little about the data you have (Optional)"
                    placeholder="Describe your sample sizes, spreadsheets structure, audio records..."
                    value={dataDescription}
                    onChange={e => setDataDescription(e.target.value)}
                    rows={3}
                  />

                  <Textarea
                    label="Tell us what you need help with"
                    placeholder="What specific statistical tests or thematic extractions do you need? Paste instructions..."
                    value={briefText}
                    onChange={e => setBriefText(e.target.value)}
                    rows={6}
                    required
                  />
                </div>
              )}

              {/* FLOW E: Report Writing */}
              {selectedType === "report_writing" && (
                <div className="flex flex-col gap-6 border-t border-border/20 pt-5">
                  <Input
                    label="What is your research topic?"
                    placeholder="Enter topic..."
                    value={reportTopic}
                    onChange={e => setReportTopic(e.target.value)}
                    required
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="What part of the report do you need help with?"
                      options={REPORT_PARTS}
                      value={reportPart}
                      onChange={e => setReportPart(e.target.value)}
                      required
                    />

                    <Input
                      label="When is your target deadline?"
                      type="date"
                      value={deadline}
                      onChange={e => setDeadline(e.target.value)}
                      required
                    />
                  </div>

                  <Textarea
                    label="Tell us what you need help with"
                    placeholder="Provide specific word count objectives, outline references, or drafting directions..."
                    value={briefText}
                    onChange={e => setBriefText(e.target.value)}
                    rows={6}
                    required
                  />

                  <Textarea
                    label="Has your supervisor given you any feedback you'd like us to consider? (Optional)"
                    placeholder="Paste specific review feedback or correction directives..."
                    value={supervisorComments}
                    onChange={e => setSupervisorComments(e.target.value)}
                    rows={3}
                  />
                </div>
              )}

              {/* FLOW F: Journal Article Writing */}
              {selectedType === "journal_article" && (
                <div className="flex flex-col gap-6 border-t border-border/20 pt-5">
                  <Input
                    label="What is your research topic?"
                    placeholder="Enter manuscript topic..."
                    value={journalTopic}
                    onChange={e => setJournalTopic(e.target.value)}
                    required
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="Where are you in the writing process?"
                      options={ARTICLE_STAGES}
                      value={articleStage}
                      onChange={e => setArticleStage(e.target.value)}
                      required
                    />

                    <Input
                      label="When is your target deadline?"
                      type="date"
                      value={deadline}
                      onChange={e => setDeadline(e.target.value)}
                      required
                    />
                  </div>

                  <Input
                    label="Do you already have a journal in mind? (Optional)"
                    placeholder="e.g. IEEE Access, Harvard Business Review..."
                    value={targetJournal}
                    onChange={e => setTargetJournal(e.target.value)}
                  />

                  <Textarea
                    label="Tell us what you need help with"
                    placeholder="Outline draft improvements, target journals guidelines, or manuscript reductions..."
                    value={briefText}
                    onChange={e => setBriefText(e.target.value)}
                    rows={6}
                    required
                  />
                </div>
              )}

              {/* FLOW G: Publishing Support */}
              {selectedType === "publishing_support" && (
                <div className="flex flex-col gap-6 border-t border-border/20 pt-5">
                  <Input
                    label="What is your research topic or manuscript title?"
                    placeholder="Provide working title..."
                    value={publishingTopic}
                    onChange={e => setPublishingTopic(e.target.value)}
                    required
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="What stage is your manuscript currently at?"
                      options={PUBLISHING_STATUSES}
                      value={publishingStatus}
                      onChange={e => setPublishingStatus(e.target.value)}
                      required
                    />

                    <Input
                      label="Which journal are you targeting? (Optional)"
                      placeholder="e.g. Nature, Springer Journal..."
                      value={publishingJournal}
                      onChange={e => setPublishingJournal(e.target.value)}
                    />
                  </div>

                  <Textarea
                    label="Tell us what you need help with"
                    placeholder="Describe journal rejection remarks, revision review requirements, or submission parameters..."
                    value={briefText}
                    onChange={e => setBriefText(e.target.value)}
                    rows={6}
                    required
                  />
                </div>
              )}

              {/* 3. UNIVERSAL OPTIONAL FILES UPLOAD */}
              <div className="flex flex-col gap-2 border-t border-border/20 pt-5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground select-none">
                    Upload supporting documents (Optional)
                  </label>
                  <span className="text-[10px] font-bold text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full uppercase tracking-wider select-none">Optional</span>
                </div>
                <p className="text-[10px] text-muted-foreground font-semibold -mt-1 select-none">
                  💡 Uploading files or drafts helps us provide a more accurate quote.
                </p>
                <div className="border-2 border-dashed border-border/60 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-secondary/20 hover:bg-secondary/40 transition-colors relative cursor-pointer mt-1">
                  <input
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="text-3xl select-none">📁</div>
                  <div className="text-center">
                    <span className="text-xs font-bold text-foreground block">
                      {attachedFiles.length > 0 
                        ? `${attachedFiles.length} file(s) selected` 
                        : "Drag & Drop or Click to Attach Files"}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-0.5 block select-none">
                      {attachedFiles.length > 0 
                        ? attachedFiles.map(f => f.name).join(", ") 
                        : "Outlines, feedback comments, datasets, previous chapters, or drafts"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. UNIVERSAL EXTRA STUDENT NOTES */}
              <div className="flex flex-col gap-2 border-t border-border/20 pt-5">
                <Textarea
                  label="Tell us more (Optional)"
                  placeholder="Paste any additional notes or details you'd like us to know..."
                  value={additionalNotes}
                  onChange={e => setAdditionalNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <Button variant="primary" type="submit" isLoading={loading} className="w-full mt-2 font-bold py-3 text-sm bg-primary text-white hover:bg-primary/95 transition-all">
                Submit Request for Review
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
