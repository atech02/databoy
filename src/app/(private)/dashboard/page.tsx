"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { Input, Select } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { Loader } from "@/components/ui/Loader";
import { Modal } from "@/components/ui/Modal";
import { 
  TableContainer, 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell 
} from "@/components/ui/Table";
import { 
  UNIVERSITIES, 
  FACULTIES, 
  MAJORS, 
  YEARS_OF_STUDY,

  PROJECT_TYPES
} from "@/utils/lookups";
import { projectService } from "@/services/projectService";
import { userService } from "@/services/userService";
import { proofreadingService, ProofreadingTaskItem } from "@/services/proofreadingService";
import { storageService } from "@/services/storageService";
import { seeder } from "@/utils/seeder";
import { Project, ProjectStatus, UserAvailability, UserProfile } from "@/types/domain";

// Helper to render project statuses consistently across all dashboards
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
      return <Badge variant="warning">Returned (Changes)</Badge>;
    case "completed":
      return <Badge variant="success">Completed</Badge>;
    case "disputed":
      return <Badge variant="danger">Disputed</Badge>;
    case "cancelled":
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
};

// Global pricing formatter supporting both USD ($) and Zambian Kwacha (K)
const formatBudget = (proj: Partial<Project>) => {
  if (proj.currency === "ZMW") {
    return `K${proj.budget?.toFixed(2)}`;
  }
  return `$${proj.budget?.toFixed(2)}`;
};

export default function Dashboard() {
  const { profile, refreshProfile, error, retryFetchProfile } = useAuth();
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [seedingState, setSeedingState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  // React Hydration Guard to eliminate server-client rendering mismatches on dynamic layouts
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  console.log(`[Dashboard] Render start. mounted: ${mounted}, profile UID: ${profile?.uid || "null"}, profile role: ${profile?.role || "null"}, error: ${error || "null"}`);

  if (!mounted) {
    console.log("[Dashboard] Render blocked: Hydration in progress (mounted = false)");
    return <Loader size="lg" className="min-h-[50vh]" />;
  }

  if (!profile) {
    console.log("[Dashboard] Render blocked: profile is null. Rendering Loader.");
    return <Loader size="lg" className="min-h-[50vh]" />;
  }

  console.log(`[DASHBOARD_RENDERED] Mount complete. Rendering dashboard layout for role: "${profile.role}"`);

  const handleSeedData = async () => {
    setSeedingState("loading");
    setSeedMessage(null);
    try {
      await seeder.seedDatabase(profile.uid, profile.displayName);
      setSeedingState("success");
      setSeedMessage(`Successfully seeded mock projects sandbox data! Seeded mock writers, proofreaders, and active projects in multiple states.`);
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      setSeedingState("error");
      setSeedMessage(err?.message || "Failed to seed sandbox database.");
    }
  };

  const handleClearData = async () => {
    setSeedingState("loading");
    setSeedMessage(null);
    try {
      await seeder.clearDatabase(profile.uid);
      setSeedingState("success");
      setSeedMessage(`Successfully cleared mock projects sandbox data.`);
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      setSeedingState("error");
      setSeedMessage(err?.message || "Failed to clear sandbox database.");
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ⚠️ Glowing HSL Network & Database Connection Alert Warning */}
      {error && (
        <Card className="border-amber-500/25 bg-amber-500/5 dark:bg-amber-500/5 animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.15)]">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl text-amber-500">⚠️</span>
                <div className="flex flex-col gap-1">
                  <span className="font-extrabold text-sm tracking-tight text-foreground flex items-center gap-2">
                    Network/Database Connection Limitation
                    <Badge variant="warning" className="text-[10px] py-0 px-1.5 uppercase font-mono font-bold">Offline / Lag Recovery Mode</Badge>
                  </span>
                  <span className="text-xs text-muted-foreground max-w-2xl">
                    {error} We have mounted the client using local recovery credentials so you can access the shell UI. Live data synchronizations are suspended.
                  </span>
                </div>
              </div>
              <Button 
                variant="primary" 
                size="sm"
                onClick={retryFetchProfile}
                className="w-full md:w-auto shrink-0 bg-gradient-to-r from-amber-600 to-orange-600 border-none hover:from-amber-700 hover:to-orange-700 font-bold tracking-tight text-xs py-2 px-4 shadow-[0_4px_12px_rgba(245,158,11,0.2)] hover:shadow-[0_4px_20px_rgba(245,158,11,0.45)] transition-all duration-300"
              >
                🔄 Retry Live Connection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {/* 🧪 Developer Sandbox Playground - ADMIN ONLY */}
      {profile.role === "admin" && (
        <Card className="border-violet-500/25 bg-violet-500/5 dark:bg-violet-500/5">
          <CardContent className="pt-6">
            <div className="flex justify-between items-center cursor-pointer" onClick={() => setDevToolsOpen(!devToolsOpen)}>
              <div className="flex items-center gap-3">
                <span className="text-xl">🧪</span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-extrabold text-sm tracking-tight text-foreground flex items-center gap-2">
                    Knowledge-Services Sandbox Developer Tools
                    <Badge variant="info" className="text-[10px] py-0 px-1.5 uppercase font-mono">Dev Mode</Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Quickly seed or reset mock projects across all pipeline statuses in 1-click.
                  </span>
                </div>
              </div>
              <Button variant="outline" size="sm" className="font-mono text-xs">
                {devToolsOpen ? "Hide Tools" : "Show Tools"}
              </Button>
            </div>

            {devToolsOpen && (
              <div className="mt-5 pt-5 border-t border-violet-500/10 flex flex-col gap-4">
                {seedMessage && (
                  <Alert 
                    variant={seedingState === "success" ? "success" : "error"} 
                    title={seedingState === "success" ? "Sandbox Success" : "Sandbox Error"}
                  >
                    {seedMessage}
                  </Alert>
                )}
                
                <div className="flex flex-col sm:flex-row gap-3 items-center">
                  <Button 
                    variant="primary" 
                    size="sm"
                    onClick={handleSeedData} 
                    isLoading={seedingState === "loading"}
                    className="w-full sm:w-auto bg-gradient-to-r from-violet-600 to-indigo-600 border-none hover:from-violet-700 hover:to-indigo-700"
                  >
                    Populate Mock Project Pipelines (Seed)
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleClearData} 
                    disabled={seedingState === "loading"}
                    className="w-full sm:w-auto hover:bg-danger/10 hover:text-danger hover:border-danger/30 transition-all"
                  >
                    Clean Sandbox Data (Reset)
                  </Button>

                  <span className="text-xs text-muted-foreground sm:ml-auto">
                    Seeds: mock writers, proofreaders, and 5 projects (Claimable, Drafting, Under Review, Completed, Returned).
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* RENDER ROLE BASED SUB-DASHBOARD */}
      {profile.role === "customer" && <CustomerDashboard profile={profile} refreshProfile={refreshProfile} />}
      {["writer", "proofreader"].includes(profile.role) && <WriterDashboard profile={profile} refreshProfile={refreshProfile} />}
      {profile.role === "admin" && (
        <Card className="text-center p-12">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="text-5xl">⚙️</div>
            <h1 className="text-2xl font-black text-foreground">Admin Control panel Detected</h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              Please use the central Administration Control Panel in the top menu to govern verifications, dispute escrow resolutions, and platform parameters.
            </p>
            <Link href="/admin">
              <Button variant="primary">Access Admin Panel</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// 1. CUSTOMER DASHBOARD SUBCOMPONENT
// ============================================================================
interface SubDashboardProps {
  profile: UserProfile;
  refreshProfile: () => Promise<void>;
}

function CustomerDashboard({ profile, refreshProfile }: SubDashboardProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProj, setLoadingProj] = useState(true);
  const [researchRequests, setResearchRequests] = useState<any[]>([]);
  const [loadingResearch, setLoadingResearch] = useState(true);

  const loadProjects = async () => {
    setLoadingProj(true);
    try {
      const data = await projectService.listProjects({ customerId: profile.uid });
      setProjects(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingProj(false);
    }
  };

  const loadResearch = async () => {
    setLoadingResearch(true);
    try {
      const { researchService } = await import("@/services/researchService");
      const data = await researchService.listResearchRequests({ studentId: profile.uid });
      setResearchRequests(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingResearch(false);
    }
  };

  useEffect(() => {
    loadProjects();
    loadResearch();
  }, [profile]);

  const getProjectTypeLabel = (val?: string) => {
    return PROJECT_TYPES.find(p => p.value === val)?.label || val || "Other";
  };

  // Operational Separation (Revision 2 & 3)
  const activeAssignments = projects.filter(p => !["completed", "cancelled", "draft"].includes(p.status));
  const activeResearch = researchRequests.filter(r => !["completed", "cancelled", "quote_ready", "awaiting_payment"].includes(r.status));
  const quotesAwaiting = researchRequests.filter(r => r.status === "quote_ready");
  const paymentsAwaiting = researchRequests.filter(r => r.status === "awaiting_payment");
  const completedAssignments = projects.filter(p => p.status === "completed");

  const recentActivities = projects.map(proj => ({
    id: `act-${proj.id}`,
    projectId: proj.id,
    title: proj.title,
    message: proj.status === "unassigned" 
      ? "Project created. Awaiting match."
      : proj.status === "assigned"
      ? "Writer has claimed assignment."
      : proj.status === "in_progress"
      ? "Writer has started drafting."
      : proj.status === "draft_submitted"
      ? "Deliverable draft submitted."
      : proj.status === "under_review"
      ? "Proofreader is auditing draft."
      : proj.status === "review_rejected"
      ? "Revision requested."
      : proj.status === "completed"
      ? "Assignment completed. Released."
      : proj.status === "disputed"
      ? "Dispute mediation active."
      : `Status: ${proj.status}`,
    timestamp: proj.updatedAt || proj.createdAt,
  })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 3);

  // Time-based greetings (Revision 4)
  const getGreetingText = (name: string) => {
    const hrs = new Date().getHours();
    let greeting = "Good evening";
    if (hrs < 12) greeting = "Good morning";
    else if (hrs < 18) greeting = "Good afternoon";
    return `${greeting}, ${name || "User"}`;
  };

  const getStudentGreetingSubtitle = () => {
    const activeCount = activeAssignments.length;
    const quotesCount = quotesAwaiting.length;
    const paymentsCount = paymentsAwaiting.length;
    const clarificationCount = researchRequests.filter(r => r.status === "needs_clarification").length;

    if (clarificationCount > 0) {
      return `${clarificationCount} clarification request${clarificationCount > 1 ? "s" : ""} require${clarificationCount === 1 ? "s" : ""} your response.`;
    }
    if (quotesCount > 0) {
      return `${quotesCount} research quote${quotesCount > 1 ? "s" : ""} awaiting your review.`;
    }
    if (paymentsCount > 0) {
      return `${paymentsCount} payment${paymentsCount > 1 ? "s" : ""} required to begin research.`;
    }
    if (activeCount > 0) {
      return `You have ${activeCount} active assignment${activeCount > 1 ? "s" : ""}.`;
    }
    return "No actions require your attention.";
  };

  // High-Priority Attention Card (Revision 7)
  const getStudentAttentionCard = () => {
    const clarificationRequest = researchRequests.find(r => r.status === "needs_clarification");
    if (clarificationRequest) {
      return (
        <Card className="border-danger/35 bg-danger/5 shadow-sm text-xs font-semibold">
          <CardContent className="pt-5 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-extrabold text-sm text-foreground flex items-center gap-2 text-danger">⚠️ Action Required: Clarification Requested</span>
              <p className="text-muted-foreground leading-relaxed font-semibold">
                Clarification details are required for your research project <strong>"{clarificationRequest.title}"</strong>.
              </p>
            </div>
            <Link href={`/research/detail?id=${clarificationRequest.id}`} className="shrink-0 w-full sm:w-auto">
              <Button variant="primary" size="sm" className="w-full bg-danger border-danger font-bold uppercase tracking-wider text-[10px]">Respond Details</Button>
            </Link>
          </CardContent>
        </Card>
      );
    }

    const quoteAwaiting = quotesAwaiting[0];
    if (quoteAwaiting) {
      return (
        <Card className="border-primary/35 bg-primary/5 shadow-sm text-xs font-semibold">
          <CardContent className="pt-5 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-extrabold text-sm text-foreground flex items-center gap-2 text-primary">💼 Tailored Quote Issued</span>
              <p className="text-muted-foreground leading-relaxed font-semibold">
                A custom quote of <strong>K{quoteAwaiting.quoteAmount?.toFixed(2)}</strong> has been generated for <strong>"{quoteAwaiting.title}"</strong>.
              </p>
            </div>
            <Link href={`/research/detail?id=${quoteAwaiting.id}`} className="shrink-0 w-full sm:w-auto">
              <Button variant="primary" size="sm" className="w-full font-bold uppercase tracking-wider text-[10px]">Review Quote</Button>
            </Link>
          </CardContent>
        </Card>
      );
    }

    const paymentAwaiting = paymentsAwaiting[0];
    if (paymentAwaiting) {
      return (
        <Card className="border-success/35 bg-success/5 shadow-sm text-xs font-semibold">
          <CardContent className="pt-5 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-extrabold text-sm text-foreground flex items-center gap-2 text-success">💳 Escrow Deposit Required</span>
              <p className="text-muted-foreground leading-relaxed font-semibold">
                Please fund the accepted quote of <strong>K{paymentAwaiting.quoteAmount?.toFixed(2)}</strong> into secure escrow for <strong>"{paymentAwaiting.title}"</strong> to begin work.
              </p>
            </div>
            <Link href={`/research/detail?id=${paymentAwaiting.id}`} className="shrink-0 w-full sm:w-auto">
              <Button variant="primary" size="sm" className="w-full bg-success border-success text-white hover:bg-success/90 font-bold uppercase tracking-wider text-[10px]">Pay into Escrow</Button>
            </Link>
          </CardContent>
        </Card>
      );
    }

    return null;
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* 1. Time-Based Greeting with Contextual Subtitle (Revision 4) */}
      <div className="flex flex-col gap-1.5 p-6 rounded-xl border border-border/40 bg-secondary/15">
        <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
          {getGreetingText(profile.displayName)}
        </h1>
        <p className="text-xs font-semibold text-muted-foreground">
          {getStudentGreetingSubtitle()}
        </p>
      </div>

      {/* 2. Primary Actions First (Revision 1) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-border/40 bg-card hover:border-primary/45 transition-all">
          <CardContent className="pt-6 flex flex-col gap-2">
            <h3 className="text-sm font-extrabold text-foreground uppercase tracking-wider">Assist with Assignment</h3>
            <p className="text-xs text-muted-foreground leading-relaxed font-semibold">
              Instant ZMW/USD pricing. Paste guidelines and verify layout.
            </p>
            <Link href="/projects/upload" className="mt-2 w-fit">
              <Button variant="primary" size="sm" className="font-bold text-[10px] uppercase tracking-wider">Create Assignment &rarr;</Button>
            </Link>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card hover:border-success/45 transition-all">
          <CardContent className="pt-6 flex flex-col gap-2">
            <h3 className="text-sm font-extrabold text-foreground uppercase tracking-wider">Assist with Research</h3>
            <p className="text-xs text-muted-foreground leading-relaxed font-semibold">
              Manual admin quote review. Custom dissertation deliverables.
            </p>
            <Link href="/research/request" className="mt-2 w-fit">
              <Button variant="primary" size="sm" className="bg-success border-success text-white hover:bg-success/90 font-bold text-[10px] uppercase tracking-wider">Request Research &rarr;</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* 3. Attention Card (Revision 7) */}
      {getStudentAttentionCard()}

      {/* 4. Active Assignments (Revision 2 & 3) */}
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-black tracking-tight text-foreground flex items-center gap-2">
          📂 Active Assignments
          <Badge variant="secondary" className="text-[10px] font-bold py-0.5 px-2 bg-secondary/80 text-foreground">{activeAssignments.length}</Badge>
        </h2>

        {loadingProj ? <Loader size="md" className="py-8" /> : activeAssignments.length === 0 ? (
          <Card className="border-border/30 bg-card/45 p-8 text-center flex flex-col items-center justify-center gap-3">
            <h3 className="text-xs font-bold text-foreground">No active assignments</h3>
            <p className="text-[11px] text-muted-foreground max-w-sm font-semibold">
              All assignments feature Turnitin screens and AI-Free writing guarantees.
            </p>
          </Card>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeAssignments.map(proj => (
                  <TableRow key={proj.id}>
                    <TableCell className="font-bold text-xs font-mono">{proj.id}</TableCell>
                    <TableCell className="font-semibold text-foreground">{proj.title}</TableCell>
                    <TableCell>{getProjectTypeLabel(proj.projectType)}</TableCell>
                    <TableCell className="font-bold text-primary">{formatBudget(proj)}</TableCell>
                    <TableCell>{getStatusBadge(proj.status)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/projects/detail?id=${proj.id}`}><Button variant="outline" size="sm">Workspace</Button></Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>

      {/* 5. Active Research Requests (Revision 2 & 3) */}
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-black tracking-tight text-foreground flex items-center gap-2">
          🔬 Active Research Requests
          <Badge variant="secondary" className="text-[10px] font-bold py-0.5 px-2 bg-secondary/80 text-foreground">{activeResearch.length}</Badge>
        </h2>

        {loadingResearch ? <Loader size="md" className="py-8" /> : activeResearch.length === 0 ? (
          <Card className="border-border/30 bg-card/45 p-8 text-center flex flex-col items-center justify-center gap-3">
            <h3 className="text-xs font-bold text-foreground">No active research requests</h3>
            <p className="text-[11px] text-muted-foreground max-w-sm font-semibold">
              Your research requests under analysis or in progress will appear here.
            </p>
          </Card>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request ID</TableHead>
                  <TableHead>Research Topic / Title</TableHead>
                  <TableHead>Deliverable Format</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeResearch.map(req => (
                  <TableRow key={req.id}>
                    <TableCell className="font-bold text-xs font-mono">{req.id}</TableCell>
                    <TableCell className="font-semibold text-foreground max-w-xs truncate">{req.title}</TableCell>
                    <TableCell>{req.expectedDeliverable}</TableCell>
                    <TableCell className="font-mono text-xs">📅 {req.deadline}</TableCell>
                    <TableCell>
                      <Badge variant="info" className="uppercase text-[9px] font-extrabold px-2 py-0.5">
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/research/detail?id=${req.id}`} passHref>
                        <Button variant="outline" size="sm">Workspace</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>

      {/* 6. Quotes Awaiting Action (Revision 2 & 3) */}
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-black tracking-tight text-foreground flex items-center gap-2">
          💼 Research Quotes Awaiting Action
          <Badge variant="secondary" className="text-[10px] font-bold py-0.5 px-2 bg-secondary/80 text-foreground">{quotesAwaiting.length}</Badge>
        </h2>

        {loadingResearch ? <Loader size="md" className="py-8" /> : quotesAwaiting.length === 0 ? (
          <Card className="border-border/30 bg-card/45 p-8 text-center flex flex-col items-center justify-center gap-3">
            <h3 className="text-xs font-bold text-foreground">No quotes awaiting your review</h3>
            <p className="text-[11px] text-muted-foreground max-w-sm font-semibold">
              When our team generates a custom quote, it will appear here for your approval.
            </p>
          </Card>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request ID</TableHead>
                  <TableHead>Research Topic / Title</TableHead>
                  <TableHead>Proposed Quote</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotesAwaiting.map(req => (
                  <TableRow key={req.id}>
                    <TableCell className="font-bold text-xs font-mono">{req.id}</TableCell>
                    <TableCell className="font-semibold text-foreground max-w-xs truncate">{req.title}</TableCell>
                    <TableCell className="font-bold text-primary">K{req.quoteAmount?.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-xs">📅 {req.deadline}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/research/detail?id=${req.id}`} passHref>
                        <Button variant="primary" size="sm">Review & Accept</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>

      {/* 7. Payments Awaiting Action (Revision 2 & 3) */}
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-black tracking-tight text-foreground flex items-center gap-2">
          💳 Payments Awaiting Action
          <Badge variant="secondary" className="text-[10px] font-bold py-0.5 px-2 bg-secondary/80 text-foreground">{paymentsAwaiting.length}</Badge>
        </h2>

        {loadingResearch ? <Loader size="md" className="py-8" /> : paymentsAwaiting.length === 0 ? (
          <Card className="border-border/30 bg-card/45 p-8 text-center flex flex-col items-center justify-center gap-3">
            <h3 className="text-xs font-bold text-foreground">No payments awaiting deposit</h3>
            <p className="text-[11px] text-muted-foreground max-w-sm font-semibold">
              Research briefs with accepted quotes waiting for escrow deposit will appear here.
            </p>
          </Card>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request ID</TableHead>
                  <TableHead>Research Topic / Title</TableHead>
                  <TableHead>Accepted Quote</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentsAwaiting.map(req => (
                  <TableRow key={req.id}>
                    <TableCell className="font-bold text-xs font-mono">{req.id}</TableCell>
                    <TableCell className="font-semibold text-foreground max-w-xs truncate">{req.title}</TableCell>
                    <TableCell className="font-bold text-success">K{req.quoteAmount?.toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-xs">📅 {req.deadline}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/research/detail?id=${req.id}`} passHref>
                        <Button variant="primary" size="sm" className="bg-success border-success text-white hover:bg-success/90">Pay Escrow</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>

      {/* 8. Recent Activity Feed (At the very bottom, Revision 2) */}
      {recentActivities.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border/20 pt-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">⏳ Recent Activity Feed</h3>
          <Card className="border border-border/40 bg-card">
            <CardContent className="p-0 divide-y divide-border/20">
              {recentActivities.map((act) => (
                <div key={act.id} className="p-3.5 flex items-start justify-between gap-4 text-xs font-semibold">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                      <span>{act.projectId}</span>
                      <span>•</span>
                      <span className="truncate text-foreground font-sans font-bold">{act.title}</span>
                    </div>
                    <p className="text-muted-foreground font-medium text-[11px]">{act.message}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/80 font-mono shrink-0">{new Date(act.timestamp).toLocaleDateString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

  // ============================================================================
  // 2. WRITER DASHBOARD SUBCOMPONENT
  // ============================================================================
  function WriterDashboard({ profile, refreshProfile }: SubDashboardProps) {
  // Real-time Lists
  const [unassignedJobs, setUnassignedJobs] = useState<Project[]>([]);
  const [myJobs, setMyJobs] = useState<Project[]>([]);
  const [myResearchJobs, setMyResearchJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [showDraftUploadModal, setShowDraftUploadModal] = useState(false);
  const [draftTargetAssignmentId, setDraftTargetAssignmentId] = useState<string | null>(null);
  const [draftSelectedFile, setDraftSelectedFile] = useState<File | null>(null);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftUploadProgress, setDraftUploadProgress] = useState<number | null>(null);
  
  // Joint Role Claiming States
  const [unassignedProofreadTasks, setUnassignedProofreadTasks] = useState<Project[]>([]);
  const [myClaimedProofreadTasks, setMyClaimedProofreadTasks] = useState<Project[]>([]);

  // Authoritative Wallet & Payout States (Phase 4)
  const [wallet, setWallet] = useState<any>(null);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("airtel_money");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [isSubmittingPayout, setIsSubmittingPayout] = useState(false);

  const verification = profile.verificationStatus || "draft";
  const isEligible = 
    profile.verificationStatus === "approved" && 
    profile.writerStatus === "active" && 
    profile.isVerifiedWriter === true;

  const loadWriterData = async () => {
    setLoading(true);
    try {
      // 1. Load unassigned and awaiting_assignment projects
      const [unassigned, awaitingAssignment] = await Promise.all([
        projectService.listProjects({ status: "unassigned" }),
        projectService.listProjects({ status: "awaiting_assignment" })
      ]);
      const combined = [...unassigned, ...awaitingAssignment].filter(asg => {
        if (asg.allocationStatus === "offered") {
          return asg.currentOfferWriterId === profile.uid;
        }
        return true;
      });
      setUnassignedJobs(combined);
      
      // 2. Load my claimed projects
      const mine = await projectService.listProjects({ writerId: profile.uid });
      setMyJobs(mine);

      // 3. Load joint proofreading pool
      const allSubmittedDrafts = await projectService.listProjects({ status: "draft_submitted" });
      const claimableReviews = allSubmittedDrafts.filter(a => a.writerId !== profile.uid);
      setUnassignedProofreadTasks(claimableReviews);

      // Load claimed review tasks
      const myProofreadTasks = await projectService.listProjects({ proofreaderId: profile.uid });
      const activeClaimedReviews = myProofreadTasks.filter(
        a => a.status === "under_review" || a.status === "review_rejected"
      );
      setMyClaimedProofreadTasks(activeClaimedReviews);

      // Load assigned research requests
      const { researchService } = await import("@/services/researchService");
      const researchJobs = await researchService.listResearchRequests({ assignedWriterId: profile.uid });
      setMyResearchJobs(researchJobs);

      // 4. Fetch authoritative wallet and ledger earnings
      try {
        const earningsRes = await userService.getWriterEarnings();
        if (earningsRes && earningsRes.wallet) {
          setWallet(earningsRes.wallet);
        }
      } catch (earnErr) {
        console.warn("Could not fetch backend writer earnings:", earnErr);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWriterData();
  }, [profile]);

  const handleClaimJob = async (id: string) => {
    if (!isEligible) {
      alert("Unauthorized: Claim privileges are locked. Please complete academic verification inside the Verification Centre.");
      return;
    }
    setActioning(id);
    try {
      try {
        await projectService.claimViaApi(id);
      } catch (backendErr) {
        console.warn("Backend claim API info:", backendErr);
      }
      await projectService.transitionProjectStatus(id, "assigned", profile, {
        writerId: profile.uid
      });
      await loadWriterData();
    } catch (err: any) {
      alert(`Claim failed: ${err?.message}`);
    } finally {
      setActioning(null);
    }
  };

  const handleStartDrafting = async (id: string) => {
    setActioning(id);
    try {
      await projectService.transitionProjectStatus(id, "in_progress", profile);
      await loadWriterData();
    } catch (err: any) {
      alert(`Action failed: ${err?.message}`);
    } finally {
      setActioning(null);
    }
  };

  const handleSubmitDraft = (id: string) => {
    setDraftTargetAssignmentId(id);
    setDraftSelectedFile(null);
    setDraftNotes("");
    setDraftUploadProgress(null);
    setShowDraftUploadModal(true);
  };

  const handleConfirmDraftUpload = async () => {
    if (!draftTargetAssignmentId || !draftSelectedFile) return;
    const id = draftTargetAssignmentId;
    setActioning(id);
    setDraftUploadProgress(0);
    try {
      const uploadRes = await storageService.uploadFile(
        "draft",
        id,
        draftSelectedFile,
        (prog) => setDraftUploadProgress(prog)
      );

      await projectService.submitDraftViaApi(
        id,
        uploadRes.url,
        draftNotes.trim() || "Deliverable draft uploaded by writer.",
        {
          fileId: uploadRes.fileId,
          storageKey: uploadRes.storageKey,
          fileName: uploadRes.fileName,
        }
      );

      setShowDraftUploadModal(false);
      setDraftTargetAssignmentId(null);
      setDraftSelectedFile(null);
      setDraftNotes("");
      await loadWriterData();
    } catch (err: any) {
      alert(`Submission failed: ${err?.message || err}`);
    } finally {
      setDraftUploadProgress(null);
      setActioning(null);
    }
  };

  const handleClaimProofreading = async (id: string) => {
    if (!isEligible) {
      alert("Unauthorized: Claim privileges are locked. Please complete academic verification inside the Verification Centre.");
      return;
    }
    setActioning(id);
    try {
      await projectService.transitionProjectStatus(id, "under_review", profile, {
        proofreaderId: profile.uid
      });
      await loadWriterData();
    } catch (err: any) {
      alert(`Audit claim failed: ${err?.message}`);
    } finally {
      setActioning(null);
    }
  };

  const handleApproveProofreading = async (id: string) => {
    setActioning(id);
    try {
      await projectService.transitionProjectStatus(id, "completed", profile);
      await loadWriterData();
    } catch (err: any) {
      alert(`Approval failed: ${err?.message}`);
    } finally {
      setActioning(null);
    }
  };

  const handleRejectProofreading = async (id: string) => {
    setActioning(id);
    try {
      await projectService.transitionProjectStatus(id, "review_rejected", profile);
      await loadWriterData();
    } catch (err: any) {
      alert(`Rejection return failed: ${err?.message}`);
    } finally {
      setActioning(null);
    }
  };

  const getProjectTypeLabel = (val?: string) => {
    return PROJECT_TYPES.find(p => p.value === val)?.label || val || "Other";
  };

  const handleRequestPayout = async () => {
    const amt = parseFloat(payoutAmount);
    if (isNaN(amt) || amt < 50) {
      alert("Minimum payout request is 50 ZMW.");
      return;
    }
    const currentBal = wallet?.availableBalance ?? (profile.availableBalance || 0);
    if (amt > currentBal) {
      alert(`Insufficient funds. Your available balance is K${currentBal.toFixed(2)}.`);
      return;
    }
    if (!payoutAccount.trim()) {
      alert("Please enter your mobile money number or bank details.");
      return;
    }
    setIsSubmittingPayout(true);
    try {
      await userService.requestPayout(amt, payoutMethod, { accountNumber: payoutAccount.trim() });
      setShowPayoutModal(false);
      setPayoutAmount("");
      setPayoutAccount("");
      alert("Payout request submitted successfully. Awaiting administrator approval.");
      await loadWriterData();
      if (refreshProfile) await refreshProfile();
    } catch (e: any) {
      alert("Payout request failed: " + (e?.message || e));
    } finally {
      setIsSubmittingPayout(false);
    }
  };

  const activeDrafting = myJobs.filter(a => ["assigned", "in_progress", "draft_submitted", "review_rejected"].includes(a.status));
  const activeAudits = myClaimedProofreadTasks;
  const activeResearch = myResearchJobs.filter(r => ["assigned", "in_progress", "submitted_for_review", "revision_requested"].includes(r.status));
  const completedAssignments = myJobs.filter(a => a.status === "completed");

  const activeCount = activeDrafting.length + activeAudits.length + activeResearch.length;
  const earningsSum = myJobs.filter(a => a.status === "completed" && a.payoutStatus === "released").reduce((sum, a) => sum + (a.budget || 0), 0) +
    myResearchJobs.filter(r => r.status === "completed" && r.quoteStatus === "paid").reduce((sum, r) => sum + ((r.quoteAmount || 0) * 0.5), 0);

  // Time-based greeting (Revision 4)
  const getGreetingText = (name: string) => {
    const hrs = new Date().getHours();
    if (hrs < 12) return `Good morning, ${name}`;
    if (hrs < 18) return `Good afternoon, ${name}`;
    return `Good evening, ${name}`;
  };

  const getWriterGreetingSubtitle = () => {
    if (!isEligible) {
      if (verification === "pending_review") {
        return "Your academic credentials verification is currently pending admin review.";
      }
      if (verification === "clarification_required") {
        return "Action Required: Academic verification requires clarification.";
      }
      if (verification === "rejected") {
        return "Your academic credentials verification was rejected. Please update your details and resubmit.";
      }
      return "Please complete academic verification inside the Verification Centre to unlock claiming privileges.";
    }
    if (activeCount > 0) {
      return `You have ${activeCount} active task${activeCount > 1 ? "s" : ""} currently in progress.`;
    }
    return "No actions require your attention.";
  };

  // Helper to check if deadline is within 48 hours
  const hasApproachingDeadline = () => {
    const now = new Date();
    for (const job of activeDrafting) {
      if (job.deadline) {
        const diffMs = new Date(job.deadline).getTime() - now.getTime();
        const diffHrs = diffMs / (1000 * 60 * 60);
        if (diffHrs > 0 && diffHrs <= 48) return true;
      }
    }
    for (const res of activeResearch) {
      if (res.deadline) {
        const diffMs = new Date(res.deadline).getTime() - now.getTime();
        const diffHrs = diffMs / (1000 * 60 * 60);
        if (diffHrs > 0 && diffHrs <= 48) return true;
      }
    }
    return false;
  };

  // Writer Attention Cards (Revision 7) - Only show one at a time
  const getWriterAttentionCard = () => {
    if (!isEligible) {
      let title = "Action Required: Verification Required";
      let desc = "Academic certificate verification is required to browse and claim available escrow assignments.";
      let btnText = "Complete Verification";
      let borderClass = "border-danger/35 bg-danger/5 text-danger";
      let btnVariant: "primary" | "outline" | "danger" | "secondary" = "primary";

      if (verification === "pending_review") {
        title = "Verification Under Review";
        desc = "Your academic credentials and scans are currently being audited by system administrators. Vetting is typically completed within 24 hours.";
        btnText = "View Submission";
        borderClass = "border-warning/35 bg-warning/5 text-warning";
        btnVariant = "outline";
      } else if (verification === "clarification_required") {
        title = "⚠️ Clarification Required";
        desc = `Admin request: "${profile.rejectionReason || "Please verify your document scans."}"`;
        btnText = "Provide Clarification";
        borderClass = "border-warning/35 bg-warning/5 text-warning";
      } else if (verification === "rejected") {
        title = "❌ Credentials Rejected";
        desc = `Reason: "${profile.rejectionReason || "Uploaded documents do not meet requirements."}"`;
        btnText = "Update & Resubmit";
        borderClass = "border-danger/35 bg-danger/5 text-danger";
      }

      return (
        <Card className={`${borderClass} shadow-sm text-xs font-semibold`}>
          <CardContent className="pt-5 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex flex-col gap-1">
              <span className={`font-extrabold text-sm ${verification === "rejected" ? "text-danger" : "text-foreground"}`}>{title}</span>
              <p className="text-muted-foreground leading-relaxed font-semibold">
                {desc}
              </p>
            </div>
            <Link href="/verification" className="shrink-0 w-full sm:w-auto">
              <Button variant={btnVariant} size="sm" className="w-full font-bold uppercase tracking-wider text-[10px]">{btnText}</Button>
            </Link>
          </CardContent>
        </Card>
      );
    }

    const hasRevision = myJobs.some(a => a.status === "review_rejected") || myResearchJobs.some(r => r.status === "revision_requested");
    if (hasRevision) {
      return (
        <Card className="border-warning/35 bg-warning/5 shadow-sm text-xs font-semibold">
          <CardContent className="pt-5 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-extrabold text-sm text-warning">✍️ Revision Requested</span>
              <p className="text-muted-foreground leading-relaxed font-semibold">
                One or more of your submissions has been returned for revisions. Please check your active workspace.
              </p>
            </div>
            <a href="#active-workload" className="shrink-0 w-full sm:w-auto">
              <Button variant="primary" size="sm" className="w-full bg-warning border-warning text-foreground font-bold uppercase tracking-wider text-[10px]">Open Workbench</Button>
            </a>
          </CardContent>
        </Card>
      );
    }

    if (hasApproachingDeadline()) {
      return (
        <Card className="border-primary/35 bg-primary/5 shadow-sm text-xs font-semibold">
          <CardContent className="pt-5 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-extrabold text-sm text-primary">📅 Deadline Approaching</span>
              <p className="text-muted-foreground leading-relaxed font-semibold">
                An active task on your workbench is due within the next 48 hours. Please check your guidelines.
              </p>
            </div>
            <a href="#active-workload" className="shrink-0 w-full sm:w-auto">
              <Button variant="primary" size="sm" className="w-full font-bold uppercase tracking-wider text-[10px]">Open Workbench</Button>
            </a>
          </CardContent>
        </Card>
      );
    }

    return null;
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* Dynamic Welcome Greeting (Revision 4) */}
      <div className="flex flex-col gap-1.5 p-6 rounded-xl border border-border/40 bg-secondary/15">
        <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
          {getGreetingText(profile.displayName)}
        </h1>
        <p className="text-xs font-semibold text-muted-foreground">
          {getWriterGreetingSubtitle()}
        </p>
      </div>

      {/* Writer Attention Card (Revision 7) */}
      {getWriterAttentionCard()}

      {/* 1. Verification Status Card (Revision 6) */}
      {!isEligible && (
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-black tracking-tight text-foreground">🛡️ Verification Status</h2>
          
          {(verification === "draft" || verification === "incomplete") && (
            <Card className="border border-red-500/25 bg-red-500/5 shadow-sm">
              <CardContent className="pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-extrabold text-sm text-foreground">Escrow Claims Locked</span>
                  <p className="text-xs text-muted-foreground max-w-xl font-semibold leading-relaxed">
                    Upload your degree certificate and official transcripts inside the Verification Centre to unlock claiming privileges.
                  </p>
                </div>
                <Link href="/verification" className="shrink-0 w-full sm:w-auto">
                  <Button variant="primary" size="sm" className="w-full">Verify Profile</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {verification === "pending_review" && (
            <Card className="border border-warning/35 bg-warning/5 shadow-sm">
              <CardContent className="pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-extrabold text-sm text-foreground block">Verification Review Pending</span>
                  <p className="text-xs text-muted-foreground max-w-xl font-semibold leading-relaxed mt-1">
                    Your uploaded degree credentials and transcript scans are currently being audited by system administration. Vetting is typically completed within 24 hours.
                  </p>
                </div>
                <Link href="/verification" className="shrink-0 w-full sm:w-auto">
                  <Button variant="outline" size="sm" className="w-full">View Details</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {verification === "clarification_required" && (
            <Card className="border border-amber-500/25 bg-amber-500/5 shadow-sm">
              <CardContent className="pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-extrabold text-sm text-foreground block">Clarification Required</span>
                  <p className="text-xs text-muted-foreground max-w-xl font-semibold leading-relaxed mt-1">
                    Administrative review requires clarification: <strong className="text-foreground">&quot;{profile.rejectionReason}&quot;</strong>. Please provide correction or updated files.
                  </p>
                </div>
                <Link href="/verification" className="shrink-0 w-full sm:w-auto">
                  <Button variant="primary" size="sm" className="w-full">Provide Clarification</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {verification === "rejected" && (
            <Card className="border border-red-500/25 bg-red-500/5 shadow-sm">
              <CardContent className="pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-extrabold text-sm text-foreground">Credentials Rejected</span>
                  <p className="text-xs text-muted-foreground max-w-xl font-semibold leading-relaxed">
                    Admin has rejected your uploaded qualifications. Reason: <strong className="text-foreground">&quot;{profile.rejectionReason || "Uploaded documents do not meet requirements."}&quot;</strong>. Please re-submit valid certificates.
                  </p>
                </div>
                <Link href="/verification" className="shrink-0 w-full sm:w-auto">
                  <Button variant="primary" size="sm" className="w-full bg-gradient-to-r from-red-600 to-orange-600 border-none">Update Credentials</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* 2. Active Work (Revision 6) */}
      {(activeDrafting.length > 0 || activeAudits.length > 0) && (
        <div id="active-workload" className="flex flex-col gap-3">
          <h2 className="text-base font-black tracking-tight text-foreground flex items-center gap-2">
            ⚡ Active Work Workbench
            <Badge variant="primary" className="text-[10px] font-bold py-0.5 px-2 bg-indigo-500/10 text-indigo-400">
              {activeDrafting.length + activeAudits.length}
            </Badge>
          </h2>

          <div className="flex flex-col gap-4">
            {activeDrafting.length > 0 && (
              <Card className="border border-border/40 bg-card p-4">
                <span className="text-xs font-black text-muted-foreground uppercase tracking-widest block mb-3">Active Writing Task</span>
                <TableContainer>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeDrafting.map(asg => (
                        <TableRow key={asg.id}>
                          <TableCell className="font-mono text-xs font-bold">{asg.id}</TableCell>
                          <TableCell className="font-semibold text-foreground">{asg.title}</TableCell>
                          <TableCell>{getProjectTypeLabel(asg.projectType)}</TableCell>
                          <TableCell>{getStatusBadge(asg.status)}</TableCell>
                          <TableCell className="text-right flex justify-end gap-2">
                            {asg.status === "assigned" && (
                              <Button 
                                variant="primary" 
                                size="sm"
                                onClick={() => handleStartDrafting(asg.id)}
                                isLoading={actioning === asg.id}
                              >
                                Start Drafting
                              </Button>
                            )}
                            {(asg.status === "in_progress" || asg.status === "review_rejected") && (
                              <Button 
                                variant="primary" 
                                size="sm"
                                onClick={() => handleSubmitDraft(asg.id)}
                                isLoading={actioning === asg.id}
                              >
                                Submit Draft
                              </Button>
                            )}
                            <Link href={`/projects/detail?id=${asg.id}`}><Button variant="outline" size="sm">Workspace</Button></Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            )}

            {activeAudits.length > 0 && (
              <Card className="border border-border/40 bg-card p-4">
                <span className="text-xs font-black text-muted-foreground uppercase tracking-widest block mb-3">Active Proofreading Audit</span>
                <TableContainer>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Audit Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeAudits.map(asg => (
                        <TableRow key={asg.id}>
                          <TableCell className="font-mono text-xs font-bold">{asg.id}</TableCell>
                          <TableCell className="font-semibold text-foreground">{asg.title}</TableCell>
                          <TableCell>{getStatusBadge(asg.status)}</TableCell>
                          <TableCell className="text-right flex justify-end gap-2">
                            <Button 
                              variant="primary" 
                              size="sm"
                              onClick={() => handleApproveProofreading(asg.id)}
                              isLoading={actioning === asg.id}
                              className="!bg-success !border-success !text-white hover:!bg-success/90"
                            >
                              Approve
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleRejectProofreading(asg.id)}
                              isLoading={actioning === asg.id}
                              className="hover:text-danger hover:border-danger"
                            >
                              Return
                            </Button>
                            <Link href={`/projects/detail?id=${asg.id}`} passHref>
                              <Button variant="outline" size="sm">Review Docs</Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* 3. Available Assignments (Revision 6) */}
      <div id="available-assignments" className="flex flex-col gap-4 border-t border-border/20 pt-6">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-black tracking-tight text-foreground flex items-center gap-2">
            🔬 Available Assignments Pool
          </h2>
          <Button variant="outline" size="sm" onClick={loadWriterData} disabled={loading} className="text-xs">
            🔄 Refresh List
          </Button>
        </div>

        {loading ? <Loader size="md" className="py-8" /> : unassignedJobs.length === 0 && unassignedProofreadTasks.length === 0 ? (
          <Card className="border border-border/30 bg-card/45 p-6 text-center flex flex-col items-center justify-center gap-3">
            <h3 className="text-xs font-bold text-foreground">Available assignments queue is clear</h3>
            <p className="text-[11px] text-muted-foreground max-w-sm font-semibold">
              New guidelines and tasks in secure escrow will appear here. Refresh the list to poll updates.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {unassignedJobs.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Writing Opportunities</span>
                <TableContainer>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project ID</TableHead>
                        <TableHead>Project Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Payout</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unassignedJobs.map(asg => (
                        <TableRow key={asg.id}>
                          <TableCell className="font-mono text-xs font-bold">{asg.id}</TableCell>
                          <TableCell className="font-semibold text-foreground">{asg.title}</TableCell>
                          <TableCell>{getProjectTypeLabel(asg.projectType)}</TableCell>
                          <TableCell className="font-bold text-primary">{formatBudget(asg)}</TableCell>
                          <TableCell className="text-right flex justify-end gap-2">
                            <Button 
                              variant={isEligible ? "primary" : "outline"} 
                              size="sm" 
                              onClick={() => handleClaimJob(asg.id)}
                              isLoading={actioning === asg.id}
                              disabled={activeCount > 0}
                            >
                              {isEligible ? "Claim Project" : "Claim (Verify First)"}
                            </Button>
                            <Link href={`/projects/detail?id=${asg.id}`}><Button variant="outline" size="sm">Details</Button></Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            )}

            {unassignedProofreadTasks.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Proofreading Opportunities</span>
                <TableContainer>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Payout</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unassignedProofreadTasks.map(asg => (
                        <TableRow key={asg.id}>
                          <TableCell className="font-mono text-xs font-bold">{asg.id}</TableCell>
                          <TableCell className="font-semibold text-foreground">{asg.title}</TableCell>
                          <TableCell className="font-black text-primary">{formatBudget(asg)}</TableCell>
                          <TableCell className="text-right flex justify-end gap-2">
                            <Button 
                              variant={isEligible ? "primary" : "outline"} 
                              size="sm" 
                              onClick={() => handleClaimProofreading(asg.id)}
                              isLoading={actioning === asg.id}
                              disabled={activeCount > 0}
                            >
                              {isEligible ? "Claim Audit" : "Claim Audit (Verify First)"}
                            </Button>
                            <Link href={`/projects/detail?id=${asg.id}`}><Button variant="outline" size="sm">Details</Button></Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Assigned Research Projects (Revision 6) */}
      <div className="flex flex-col gap-4 border-t border-border/20 pt-6">
        <h2 className="text-base font-black tracking-tight text-foreground flex items-center gap-2">
          🔬 Assigned Research Projects
          <Badge variant="secondary" className="text-[10px] font-bold py-0.5 px-2 bg-secondary/80 text-foreground">
            {activeResearch.length}
          </Badge>
        </h2>

        {loading ? <Loader size="md" className="py-8" /> : activeResearch.length === 0 ? (
          <Card className="border border-border/30 bg-card/45 p-6 text-center flex flex-col items-center justify-center gap-3">
            <h3 className="text-xs font-bold text-foreground">No assigned research projects</h3>
            <p className="text-[11px] text-muted-foreground max-w-sm font-semibold">
              Research requests allocated to you by administration will appear here.
            </p>
          </Card>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Research ID</TableHead>
                  <TableHead>Topic / Title</TableHead>
                  <TableHead>Subject Area</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeResearch.map(req => (
                  <TableRow key={req.id}>
                    <TableCell className="font-mono text-xs font-bold">{req.id}</TableCell>
                    <TableCell className="font-semibold text-foreground max-w-xs truncate">{req.title}</TableCell>
                    <TableCell>{req.subject}</TableCell>
                    <TableCell className="font-mono text-xs">📅 {req.deadline}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/research/detail?id=${req.id}`} passHref>
                        <Button variant="primary" size="sm">Open Workspace</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>

      {/* 5. Authoritative Wallet & Performance Metrics (Phase 4) */}
      <div className="flex flex-col gap-3 border-t border-border/20 pt-6">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-black tracking-tight text-foreground">💼 Wallet & Authoritative Ledger</h2>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowPayoutModal(true)}
            className="text-xs font-bold"
          >
            💸 Request Payout
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="border border-border/40 bg-card">
            <CardContent className="pt-5 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Available Balance</span>
                <div className="text-xl font-black text-success mt-1">
                  K{(wallet?.availableBalance ?? (profile.availableBalance || 0)).toFixed(2)}
                </div>
              </div>
              <div className="text-2xl bg-secondary/80 p-2 rounded-lg">💰</div>
            </CardContent>
          </Card>
          <Card className="border border-border/40 bg-card">
            <CardContent className="pt-5 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Pending Escrow</span>
                <div className="text-xl font-black text-warning mt-1">
                  K{(wallet?.pendingBalance ?? 0).toFixed(2)}
                </div>
              </div>
              <div className="text-2xl bg-secondary/80 p-2 rounded-lg">⏳</div>
            </CardContent>
          </Card>
          <Card className="border border-border/40 bg-card">
            <CardContent className="pt-5 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Total Paid Out</span>
                <div className="text-xl font-black text-foreground mt-1">
                  K{(wallet?.totalPaidOut ?? (profile.totalPaidOut || 0)).toFixed(2)}
                </div>
              </div>
              <div className="text-2xl bg-secondary/80 p-2 rounded-lg">🏦</div>
            </CardContent>
          </Card>
          <Card className="border border-border/40 bg-card">
            <CardContent className="pt-5 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Reputation Rating</span>
                <div className="text-xl font-black text-foreground mt-1">{profile.reputation && profile.reputation >= 1 ? `${profile.reputation.toFixed(2)} ★` : "Unrated"}</div>
              </div>
              <div className="text-2xl bg-secondary/80 p-2 rounded-lg">★</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Submit Deliverable Draft Modal (Cloudflare R2) */}
      <Modal
        isOpen={showDraftUploadModal}
        onClose={() => {
          if (draftUploadProgress === null) setShowDraftUploadModal(false);
        }}
        title="Submit Deliverable Draft"
        footerActions={
          <>
            <Button
              variant="outline"
              disabled={draftUploadProgress !== null}
              onClick={() => setShowDraftUploadModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmDraftUpload}
              isLoading={actioning !== null}
              disabled={!draftSelectedFile || draftUploadProgress !== null}
            >
              Upload & Submit Draft
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-foreground">Deliverable File (.pdf, .doc, .docx)</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              disabled={draftUploadProgress !== null}
              onChange={(e) => setDraftSelectedFile(e.target.files?.[0] || null)}
              className="text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
            />
          </div>
          <Input
            label="Submission Notes (Optional)"
            placeholder="Summary of completed deliverable or citations checked..."
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
          />
          {draftUploadProgress !== null && (
            <span className="text-xs font-bold text-primary">
              Uploading deliverable to private R2 storage... {draftUploadProgress}%
            </span>
          )}
        </div>
      </Modal>

      {/* Payout Request Modal */}
      <Modal
        isOpen={showPayoutModal}
        onClose={() => setShowPayoutModal(false)}
        title="Request Earnings Payout"
        footerActions={
          <>
            <Button variant="outline" onClick={() => setShowPayoutModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleRequestPayout}
              isLoading={isSubmittingPayout}
              className="font-bold"
            >
              Submit Request
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Alert variant="info" title="Authoritative Ledger Release">
            Payout requests are audited against backend ledger transactions. Minimum withdrawal amount is K50.00.
          </Alert>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-foreground">Withdrawal Amount (ZMW)</label>
            <Input
              type="number"
              placeholder="e.g. 150"
              value={payoutAmount}
              onChange={(e) => setPayoutAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-foreground">Payment Method</label>
            <Select
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value)}
              options={[
                { value: "airtel_money", label: "Airtel Money" },
                { value: "mtn_money", label: "MTN Mobile Money" },
                { value: "zamtel_kwacha", label: "Zamtel Kwacha" },
                { value: "bank_transfer", label: "Bank Transfer" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-foreground">Account / Phone Number</label>
            <Input
              type="text"
              placeholder="+260 97X XXX XXX"
              value={payoutAccount}
              onChange={(e) => setPayoutAccount(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// 3. PROOFREADER / REVIEWER DASHBOARD SUBCOMPONENT
// ============================================================================
function ProofreaderDashboard({ profile, refreshProfile }: SubDashboardProps) {
  const [activeTab, setActiveTab] = useState("pending");
  const [pendingReviews, setPendingReviews] = useState<Project[]>([]);
  const [myReviews, setMyReviews] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [showDraftUploadModal, setShowDraftUploadModal] = useState(false);
  const [draftTargetAssignmentId, setDraftTargetAssignmentId] = useState<string | null>(null);
  const [draftSelectedFile, setDraftSelectedFile] = useState<File | null>(null);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftUploadProgress, setDraftUploadProgress] = useState<number | null>(null);

  const loadProofreaderData = async () => {
    setLoading(true);
    try {
      // 1. Get projects awaiting review
      const awaiting = await projectService.listProjects({ status: "draft_submitted" });
      setPendingReviews(awaiting);

      // 2. Get projects review history
      const mine = await projectService.listProjects({ proofreaderId: profile.uid });
      setMyReviews(mine);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProofreaderData();
  }, [profile]);

  const handleClaimReview = async (id: string) => {
    setActioning(id);
    try {
      await projectService.transitionProjectStatus(id, "under_review", profile, {
        proofreaderId: profile.uid
      });
      await loadProofreaderData();
    } catch (err: any) {
      alert(`Failed to claim: ${err?.message}`);
    } finally {
      setActioning(null);
    }
  };

  const handleApproveDraft = async (id: string) => {
    setActioning(id);
    try {
      await projectService.transitionProjectStatus(id, "completed", profile);
      await loadProofreaderData();
    } catch (err: any) {
      alert(`Approval failed: ${err?.message}`);
    } finally {
      setActioning(null);
    }
  };

  const handleRejectDraft = async (id: string) => {
    setActioning(id);
    try {
      await projectService.transitionProjectStatus(id, "review_rejected", profile);
      await loadProofreaderData();
    } catch (err: any) {
      alert(`Return failed: ${err?.message}`);
    } finally {
      setActioning(null);
    }
  };

  const getProjectTypeLabel = (val?: string) => {
    return PROJECT_TYPES.find(p => p.value === val)?.label || val || "Other";
  };

  const proofreaderTabs = [
    { id: "pending", label: `Pending Claims Queue (${pendingReviews.length})` },
    { id: "active", label: `My Active Reviews (${myReviews.filter(a => a.status === "under_review").length})` },
    { id: "completed", label: "Completed Reviews" }
  ];

  return (
    <>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-gradient-to-r from-info/10 to-violet-500/5 p-6 rounded-xl border border-info/20">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-foreground">
              {(() => {
                const hrs = new Date().getHours();
                let greeting = "Good evening";
                if (hrs < 12) greeting = "Good morning";
                else if (hrs < 18) greeting = "Good afternoon";
                return `${greeting}, ${profile.displayName || "User"}`;
              })()}
            </h1>
            <Badge variant="info">Review Desk</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Verify peer draft documents, evaluate deliverables, and release payouts.</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold uppercase text-muted-foreground">Claimable Audits</span>
              <div className="text-2xl font-black text-foreground mt-1">{pendingReviews.length}</div>
            </div>
            <div className="text-3xl bg-secondary/80 p-2 rounded-lg">🔬</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold uppercase text-muted-foreground">Finished Review Projects</span>
              <div className="text-2xl font-black text-foreground mt-1">{myReviews.filter(a => a.status === "completed").length}</div>
            </div>
            <div className="text-3xl bg-secondary/80 p-2 rounded-lg">✅</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex justify-between items-center">
            <div>
              <span className="text-xs font-bold uppercase text-muted-foreground">My Platform Reputation</span>
              <div className="text-2xl font-black text-foreground mt-1">{profile.reputation && profile.reputation >= 1 ? `${profile.reputation.toFixed(2)} ★` : "Unrated"}</div>
            </div>
            <div className="text-3xl bg-secondary/80 p-2 rounded-lg">★</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Tabs tabs={proofreaderTabs} activeTab={activeTab} onChange={setActiveTab} />

        {loading ? <Loader size="md" className="py-12" /> : (
          <>
            {/* Tab 1: Pending Audits */}
            {activeTab === "pending" && (
              <div className="flex flex-col gap-4">
                <h3 className="text-lg font-bold text-foreground">Pending Draft Reviews</h3>
                {pendingReviews.length === 0 ? (
                  <Alert variant="success" title="Review Queue Clear">No submissions are currently awaiting review.</Alert>
                ) : (
                  <TableContainer>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project ID</TableHead>
                          <TableHead>Project Title</TableHead>
                          <TableHead>Scope Budget</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingReviews.map(asg => (
                          <TableRow key={asg.id}>
                            <TableCell className="font-mono text-xs font-bold">{asg.id}</TableCell>
                            <TableCell className="font-semibold text-foreground">{asg.title}</TableCell>
                            <TableCell className="font-black text-primary">{formatBudget(asg)}</TableCell>
                            <TableCell className="text-right flex justify-end gap-2">
                              <Button 
                                variant="primary" 
                                size="sm"
                                onClick={() => handleClaimReview(asg.id)}
                                isLoading={actioning === asg.id}
                              >
                                Claim Review
                              </Button>
                              <Link href={`/projects/detail?id=${asg.id}`}><Button variant="outline" size="sm">Workspace</Button></Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </div>
            )}

            {/* Tab 2: Active Reviews */}
            {activeTab === "active" && (
              <div className="flex flex-col gap-4">
                <h3 className="text-lg font-bold text-foreground">My Claimed Audits</h3>
                {myReviews.filter(a => a.status === "under_review").length === 0 ? (
                  <Alert variant="info" title="No Active Audits">You have not claimed any active draft audits.</Alert>
                ) : (
                  <TableContainer>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project ID</TableHead>
                          <TableHead>Project Title</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {myReviews.filter(a => a.status === "under_review").map(asg => (
                          <TableRow key={asg.id}>
                            <TableCell className="font-mono text-xs font-bold">{asg.id}</TableCell>
                            <TableCell className="font-semibold text-foreground">{asg.title}</TableCell>
                            <TableCell>{getStatusBadge(asg.status)}</TableCell>
                            <TableCell className="text-right flex justify-end gap-2">
                              <Button 
                                variant="primary" 
                                size="sm"
                                onClick={() => handleApproveDraft(asg.id)}
                                isLoading={actioning === asg.id}
                                className="!bg-success !border-success !text-white hover:!bg-success/90"
                              >
                                Approve & Payout
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleRejectDraft(asg.id)}
                                isLoading={actioning === asg.id}
                                className="hover:text-danger hover:border-danger"
                              >
                                Return with Remarks
                              </Button>
                              <Link href={`/projects/detail?id=${asg.id}`}><Button variant="outline" size="sm">Workspace Docs</Button></Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </div>
            )}

            {/* Tab 3: Completed Reviews */}
            {activeTab === "completed" && (
              <div className="flex flex-col gap-4">
                <h3 className="text-lg font-bold text-foreground">Completed Review Audits</h3>
                {myReviews.filter(a => a.status === "completed").length === 0 ? (
                  <Alert variant="info" title="No History">No completed reviews found in your audit logs.</Alert>
                ) : (
                  <TableContainer>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project ID</TableHead>
                          <TableHead>Project Title</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Scope budget</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {myReviews.filter(a => a.status === "completed").map(asg => (
                          <TableRow key={asg.id}>
                            <TableCell className="font-mono text-xs font-bold">{asg.id}</TableCell>
                            <TableCell className="font-semibold text-foreground">{asg.title}</TableCell>
                            <TableCell>{getProjectTypeLabel(asg.projectType)}</TableCell>
                            <TableCell className="text-right font-black text-success">${asg.budget.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
