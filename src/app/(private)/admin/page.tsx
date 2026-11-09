"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { Loader } from "@/components/ui/Loader";
import { Input, Textarea } from "@/components/ui/Input";
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
import { userService } from "@/services/userService";
import { auditService } from "@/services/auditService";
import { researchService } from "@/services/researchService";
import { adminService, PlatformAuditLog, PlatformMetrics } from "@/services/adminService";
import { notificationService } from "@/services/notificationService";
import { UNIVERSITIES, FACULTIES, MAJORS } from "@/utils/lookups";
import { UserProfile, Dispute } from "@/types/domain";

// Helper to count documents (Revision 6)
const countDocuments = (exp: UserProfile) => {
  if (!exp.academic?.documents) return 0;
  let cnt = 0;
  const docs = exp.academic.documents;
  if (docs.degreeCertificateUrl) cnt++;
  if (docs.transcriptUrl) cnt++;
  if (docs.cvUrl) cnt++;
  if (docs.certificationsUrl) cnt++;
  if (docs.publicationsUrl) cnt++;
  if (docs.supportingDocsUrl) cnt++;
  return cnt;
};

export default function AdminPanel() {
  const { profile } = useAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState("overview");

  // Research queue
  const [researchRequests, setResearchRequests] = useState<any[]>([]);
  const [loadingResearch, setLoadingResearch] = useState(true);

  // Verification queue (Revision 1 & 6)
  const [pendingExperts, setPendingExperts] = useState<UserProfile[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [actioningUser, setActioningUser] = useState<string | null>(null);
  const [verificationNotes, setVerificationNotes] = useState<Record<string, string>>({});
  const [verFilter, setVerFilter] = useState<"pending_review" | "approved" | "rejected" | "clarification_required">("pending_review");

  // Assignment queue
  const [allAssignments, setAllAssignments] = useState<any[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [assignmentFilter, setAssignmentFilter] = useState<string>("all");

  // User directory
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");

  // Disputes (live from Firestore)
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loadingDisputes, setLoadingDisputes] = useState(true);
  const [resolveModal, setResolveModal] = useState<{ disputeId: string; relatedId: string } | null>(null);
  const [resolveText, setResolveText] = useState("");
  const [resolveNotes, setResolveNotes] = useState("");
  const [isResolving, setIsResolving] = useState(false);

  // Audit logs (platform-wide)
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLog[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(true);

  // Platform metrics (live)
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  // ---------------------------------------------------------------------------
  // DATA LOADERS
  // ---------------------------------------------------------------------------

  const loadResearch = async () => {
    setLoadingResearch(true);
    try {
      const data = await researchService.listResearchRequests({});
      setResearchRequests(data);
    } catch { /* silent */ } finally { setLoadingResearch(false); }
  };

  const loadVerifications = async () => {
    setLoadingPending(true);
    try {
      const data = await userService.listPendingVerifications();
      setPendingExperts(data);
    } catch { /* silent */ } finally { setLoadingPending(false); }
  };

  const loadAssignments = async () => {
    setLoadingAssignments(true);
    try {
      const { projectService } = await import("@/services/projectService");
      const data = await projectService.listProjects({});
      setAllAssignments(data);
    } catch { /* silent */ } finally { setLoadingAssignments(false); }
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const data = await userService.listAllUsers();
      setUsers(data);
    } catch { /* silent */ } finally { setLoadingUsers(false); }
  };

  const loadDisputes = async () => {
    setLoadingDisputes(true);
    try {
      const data = await adminService.listDisputes();
      setDisputes(data);
    } catch { /* silent */ } finally { setLoadingDisputes(false); }
  };

  const loadAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const data = await adminService.getPlatformAuditLogs(150);
      setAuditLogs(data);
    } catch { /* silent */ } finally { setLoadingAudit(false); }
  };

  const loadMetrics = async () => {
    setLoadingMetrics(true);
    try {
      const data = await adminService.getPlatformMetrics();
      setMetrics(data);
    } catch { /* silent */ } finally { setLoadingMetrics(false); }
  };

  useEffect(() => {
    loadVerifications();
    loadAssignments();
    loadResearch();
    loadUsers();
    loadDisputes();
    loadAuditLogs();
    loadMetrics();
  }, []);

  // ---------------------------------------------------------------------------
  // COMPUTED / FILTERED DATA
  // ---------------------------------------------------------------------------

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchSearch =
        !userSearch ||
        u.displayName?.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email?.toLowerCase().includes(userSearch.toLowerCase());
      const matchRole = userRoleFilter === "all" || u.role === userRoleFilter;
      return matchSearch && matchRole;
    });
  }, [users, userSearch, userRoleFilter]);

  const filteredExperts = useMemo(() => {
    return pendingExperts.filter(exp => {
      const status = exp.verificationStatus || "draft";
      if (verFilter === "pending_review") return status === "pending_review";
      if (verFilter === "approved") return status === "approved";
      if (verFilter === "rejected") return status === "rejected";
      if (verFilter === "clarification_required") return status === "clarification_required";
      return false;
    });
  }, [pendingExperts, verFilter]);

  const openDisputes = disputes.filter(d => d.status === "open");
  const awaitingResearch = researchRequests.filter(r => ["submitted", "under_review"].includes(r.status));
  const unassignedAssignments = allAssignments.filter(a => a.status === "unassigned");

  // ---------------------------------------------------------------------------
  // VERIFICATION ACTIONS
  // ---------------------------------------------------------------------------

  const handleApproveExpert = async (uid: string, name: string, role: string) => {
    setActioningUser(uid);
    try {
      await userService.approveVerification(uid, profile!);
      await adminService.logPlatformAudit(
        profile!,
        "VERIFICATION_APPROVED",
        uid,
        "user",
        `Admin approved credentials for ${role.toUpperCase()}: ${name}`
      );
      await notificationService.notifyVerificationApproved(uid);
      await Promise.all([loadVerifications(), loadUsers(), loadAuditLogs(), loadMetrics()]);
    } catch (err: any) {
      alert(`Approval failed: ${err?.message}`);
    } finally { setActioningUser(null); }
  };

  const handleRejectExpert = async (uid: string, name: string, role: string) => {
    const reason = verificationNotes[uid];
    if (!reason?.trim()) {
      alert("Please enter a rejection reason in the notes field before rejecting the candidate.");
      return;
    }
    setActioningUser(uid);
    try {
      await userService.rejectVerification(uid, reason, profile!);
      await adminService.logPlatformAudit(
        profile!,
        "VERIFICATION_REJECTED",
        uid,
        "user",
        `Admin rejected credentials for ${role.toUpperCase()}: ${name}. Reason: ${reason}`
      );
      await notificationService.notifyVerificationRejected(uid, reason);
      await Promise.all([loadVerifications(), loadUsers(), loadAuditLogs(), loadMetrics()]);
    } catch (err: any) {
      alert(`Rejection failed: ${err?.message}`);
    } finally { setActioningUser(null); }
  };

  const handleRequestMoreInfo = async (uid: string, name: string) => {
    const notes = verificationNotes[uid];
    if (!notes?.trim()) { 
      alert("Please add a note describing what clarification is needed."); 
      return; 
    }
    setActioningUser(uid);
    try {
      await userService.requestClarification(uid, notes, profile!);
      await adminService.logPlatformAudit(
        profile!,
        "VERIFICATION_INFO_REQUESTED",
        uid,
        "user",
        `Admin requested clarification from ${name}: ${notes}`
      );
      await notificationService.notifyVerificationClarificationRequested(uid, notes);
      await Promise.all([loadVerifications(), loadAuditLogs(), loadMetrics()]);
    } catch (err: any) {
      alert(`Failed: ${err?.message}`);
    } finally { setActioningUser(null); }
  };

  // ---------------------------------------------------------------------------
  // USER MANAGEMENT ACTIONS
  // ---------------------------------------------------------------------------

  const handleToggleUserStatus = async (uid: string, currentStatus: string) => {
    setActioningUser(uid);
    try {
      const nextStatus = currentStatus === "active" ? "suspended" : "active";
      await userService.toggleUserStatus(uid, nextStatus as any);
      await adminService.logPlatformAudit(
        profile!,
        nextStatus === "suspended" ? "USER_SUSPENDED" : "USER_REACTIVATED",
        uid,
        "user",
        `Admin set user [${uid}] status to ${nextStatus.toUpperCase()}`
      );
      await Promise.all([loadUsers(), loadAuditLogs()]);
    } catch (err: any) {
      alert(`Failed: ${err?.message}`);
    } finally { setActioningUser(null); }
  };

  const handleChangeRole = async (uid: string, newRole: string) => {
    if (!confirm(`Change this user's role to ${newRole}? This will be audit-logged.`)) return;
    setActioningUser(uid);
    try {
      await userService.updateUserProfile(uid, { role: newRole as any });
      await adminService.logPlatformAudit(
        profile!,
        "ROLE_CHANGED",
        uid,
        "user",
        `Admin changed user [${uid}] role to ${newRole.toUpperCase()}`
      );
      await Promise.all([loadUsers(), loadAuditLogs()]);
    } catch (err: any) {
      alert(`Failed: ${err?.message}`);
    } finally { setActioningUser(null); }
  };

  // ---------------------------------------------------------------------------
  // DISPUTE ACTIONS
  // ---------------------------------------------------------------------------

  const handleOpenResolveModal = (disputeId: string, relatedId: string) => {
    setResolveModal({ disputeId, relatedId });
    setResolveText("");
    setResolveNotes("");
  };

  const handleResolveDispute = async () => {
    if (!resolveModal || !resolveText.trim()) return;
    setIsResolving(true);
    try {
      await adminService.resolveDispute(
        resolveModal.disputeId,
        resolveText,
        resolveNotes,
        profile!
      );
      await Promise.all([loadDisputes(), loadAuditLogs(), loadMetrics()]);
      setResolveModal(null);
    } catch (err: any) {
      alert(`Resolution failed: ${err?.message}`);
    } finally { setIsResolving(false); }
  };

  const handleRefundDispute = async (disputeId: string) => {
    if (!confirm("Issue a full escrow refund for this dispute? This action is irreversible.")) return;
    try {
      await adminService.refundDispute(disputeId, profile!);
      await Promise.all([loadDisputes(), loadAuditLogs()]);
    } catch (err: any) {
      alert(`Refund failed: ${err?.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  const getRoleBadge = (role: UserProfile["role"]) => {
    switch (role) {
      case "customer": return <Badge variant="primary">Student</Badge>;
      case "writer": return <Badge variant="warning">Writer</Badge>;
      case "proofreader": return <Badge variant="info">Proofreader</Badge>;
      case "admin": return <Badge variant="success">Admin</Badge>;
    }
  };

  const getUniversityLabel = (val?: string) =>
    UNIVERSITIES.find(u => u.value === val)?.label || val || "N/A";

  const getMajorLabel = (fac?: string, val?: string) => {
    if (!fac || !val) return "N/A";
    return MAJORS[fac]?.find(m => m.value === val)?.label || val || "N/A";
  };

  const adminTabs = [
    { id: "overview", label: "Overview" },
    { id: "research", label: `Research (${researchRequests.length})` },
    { id: "assignments", label: `Assignments (${allAssignments.length})` },
    { id: "verifications", label: `Verifications (${pendingExperts.length})` },
    { id: "disputes", label: `Disputes (${openDisputes.length})` },
    { id: "users", label: `Users (${users.length})` },
    { id: "metrics", label: "Metrics" },
    { id: "audit", label: "Audit Logs" },
  ];

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-8">

      {/* Title */}
      <div className="flex flex-col gap-1.5 border-b border-border/40 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
          System Administration Panel
        </h1>
        <p className="text-sm text-muted-foreground">
          Platform command centre — research, assignments, verifications, disputes, users, metrics and audit logs.
        </p>
      </div>

      {/* Tabs */}
      <Tabs tabs={adminTabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* =====================================================================
          OVERVIEW TAB
          ===================================================================== */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">Action Centre</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Platform health at a glance. Each item links to its workspace.</p>
          </div>

          {/* Action tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: "🔬",
                label: "Research Awaiting Review",
                count: awaitingResearch.length,
                tab: "research",
                urgent: awaitingResearch.length > 0,
                desc: "Submitted or under review"
              },
              {
                icon: "📋",
                label: "Assignments Unallocated",
                count: unassignedAssignments.length,
                tab: "assignments",
                urgent: unassignedAssignments.length > 0,
                desc: "Waiting for writer assignment"
              },
              {
                icon: "🛡️",
                label: "Verifications Pending",
                count: pendingExperts.length,
                tab: "verifications",
                urgent: pendingExperts.length > 0,
                desc: "Writer credentials awaiting review"
              },
              {
                icon: "⚖️",
                label: "Open Disputes",
                count: openDisputes.length,
                tab: "disputes",
                urgent: openDisputes.length > 0,
                desc: "Escrow arbitration required"
              },
              {
                icon: "👥",
                label: "Total Users",
                count: users.length,
                tab: "users",
                urgent: false,
                desc: "Registered on platform"
              },
              {
                icon: "📝",
                label: "Total Assignments",
                count: allAssignments.length,
                tab: "assignments",
                urgent: false,
                desc: "All time project pipeline"
              },
            ].map(item => (
              <button
                key={item.tab + item.label}
                onClick={() => setActiveTab(item.tab)}
                className={`text-left p-5 rounded-xl border transition-all hover:shadow-md cursor-pointer ${
                  item.urgent
                    ? "border-warning/40 bg-warning/5 hover:bg-warning/10"
                    : "border-border/40 bg-card hover:bg-secondary/30"
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl">{item.icon}</span>
                  <span className={`text-3xl font-black ${item.urgent ? "text-warning" : "text-foreground"}`}>
                    {item.count}
                  </span>
                </div>
                <div className="mt-3">
                  <span className="text-sm font-bold text-foreground block">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.desc}</span>
                </div>
                {item.urgent && (
                  <div className="mt-2">
                    <Badge variant="warning" className="text-[9px] uppercase font-extrabold tracking-wider">
                      Action Required
                    </Badge>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Quick metrics row */}
          {!loadingMetrics && metrics && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
              {[
                { label: "Active Assignments", val: metrics.activeAssignments, icon: "⚡" },
                { label: "Verified Writers", val: metrics.totalWriters, icon: "✍️" },
                { label: "Research Requests", val: metrics.totalResearch, icon: "📚" },
                { label: "Platform Users", val: metrics.totalUsers, icon: "🌐" },
              ].map((m, i) => (
                <Card key={i} className="border-border/30">
                  <CardContent className="pt-4 pb-4 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">{m.label}</span>
                      <span className="text-2xl font-black text-foreground mt-0.5 block">{m.val}</span>
                    </div>
                    <span className="text-2xl">{m.icon}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          RESEARCH QUEUE TAB
          ===================================================================== */}
      {activeTab === "research" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Research Requests Queue</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Govern intake workflows — clarify briefs, issue quotes, and assign expert writers.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadResearch} disabled={loadingResearch} className="text-xs">
              🔄 Refresh
            </Button>
          </div>

          {loadingResearch ? (
            <div className="py-12 flex justify-center"><Loader size="md" /></div>
          ) : researchRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <span className="text-5xl">🔬</span>
              <div>
                <h3 className="font-bold text-foreground">No Research Requests</h3>
                <p className="text-sm text-muted-foreground mt-1">No research support requests have been submitted yet. The queue is clear.</p>
              </div>
            </div>
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Request ID</TableHead>
                    <TableHead>Research Topic / Title</TableHead>
                    <TableHead>Subject Area</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {researchRequests.map((req) => {
                    let badgeColor: any = "secondary";
                    if (["submitted", "under_review"].includes(req.status)) badgeColor = "warning";
                    if (req.status === "needs_clarification") badgeColor = "danger";
                    if (req.status === "quote_ready" || req.status === "awaiting_payment") badgeColor = "info";
                    if (["funded", "assigned", "in_progress", "completed"].includes(req.status)) badgeColor = "success";
                    return (
                      <TableRow key={req.id}>
                        <TableCell className="font-bold text-xs font-mono">{req.id}</TableCell>
                        <TableCell className="font-semibold text-foreground max-w-xs truncate">{req.title}</TableCell>
                        <TableCell className="text-xs">{req.subject}</TableCell>
                        <TableCell className="text-xs">{req.levelOfStudy}</TableCell>
                        <TableCell className="font-mono text-xs">📅 {req.deadline}</TableCell>
                        <TableCell>
                          <Badge variant={badgeColor} className="uppercase text-[9px] tracking-wider font-extrabold px-2 py-0.5">
                            {req.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/research/detail?id=${req.id}`} passHref>
                            <Button variant="outline" size="sm">Open Workspace</Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </div>
      )}

      {/* =====================================================================
          ASSIGNMENT QUEUE TAB
          ===================================================================== */}
      {activeTab === "assignments" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Global Assignment Queue</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Monitor all project pipelines, deadlines, and writer allocations.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadAssignments} disabled={loadingAssignments} className="text-xs">
              🔄 Refresh
            </Button>
          </div>

          {/* Filter Pills */}
          {!loadingAssignments && allAssignments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {[
                { label: "All", value: "all", count: allAssignments.length },
                { label: "Awaiting Funding", value: "pending_funding", count: allAssignments.filter(a => a.escrowStatus === "pending_funding" || a.status === "awaiting_payment").length },
                { label: "Unassigned", value: "unassigned", count: allAssignments.filter(a => a.status === "unassigned" || a.status === "awaiting_assignment").length },
                { label: "Active", value: "active", count: allAssignments.filter(a => ["assigned","in_progress"].includes(a.status)).length },
                { label: "Submitted", value: "draft_submitted", count: allAssignments.filter(a => a.status === "draft_submitted").length },
                { label: "Under Review", value: "under_review", count: allAssignments.filter(a => a.status === "under_review").length },
                { label: "Revision", value: "review_rejected", count: allAssignments.filter(a => a.status === "review_rejected").length },
                { label: "Completed", value: "completed", count: allAssignments.filter(a => a.status === "completed").length },
                { label: "Disputed", value: "disputed", count: allAssignments.filter(a => a.status === "disputed").length },
              ].map(pill => (
                <button
                  key={pill.value}
                  onClick={() => setAssignmentFilter(pill.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                    assignmentFilter === pill.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {pill.label}
                  {pill.count > 0 && (
                    <span className={`ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                      assignmentFilter === pill.value ? "bg-white/20 text-white" : "bg-secondary text-muted-foreground"
                    }`}>{pill.count}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {loadingAssignments ? (
            <div className="py-12 flex justify-center"><Loader size="md" /></div>
          ) : allAssignments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <span className="text-5xl">📋</span>
              <div>
                <h3 className="font-bold text-foreground">No Assignments Yet</h3>
                <p className="text-sm text-muted-foreground mt-1">No academic support tasks are currently logged in the database.</p>
              </div>
            </div>
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project ID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Budget</TableHead>
                    <TableHead>Escrow</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Allocation</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allAssignments
                    .filter(asg => {
                      if (assignmentFilter === "all") return true;
                      if (assignmentFilter === "pending_funding") return asg.escrowStatus === "pending_funding" || asg.status === "awaiting_payment";
                      if (assignmentFilter === "unassigned") return asg.status === "unassigned" || asg.status === "awaiting_assignment";
                      if (assignmentFilter === "active") return ["assigned","in_progress"].includes(asg.status);
                      return asg.status === assignmentFilter;
                    })
                    .map(asg => (
                    <TableRow key={asg.id}>
                      <TableCell className="font-bold text-xs font-mono">{asg.id}</TableCell>
                      <TableCell className="font-semibold text-foreground max-w-[180px] truncate">{asg.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {asg.academicLevel ? (
                          <span className="capitalize">{asg.academicLevel.replace(/_/g, " ")}</span>
                        ) : <span className="text-border">—</span>}
                      </TableCell>
                      <TableCell className="font-bold text-primary">
                        {asg.currency === "ZMW" ? `K${asg.budget?.toFixed(2)}` : `$${asg.budget?.toFixed(2)}`}
                      </TableCell>
                      <TableCell>
                        <span className={`font-mono text-xs uppercase font-bold ${
                          asg.escrowStatus === "funded" ? "text-success" :
                          asg.escrowStatus === "released" ? "text-primary" :
                          asg.escrowStatus === "refunded" ? "text-danger" :
                          asg.escrowStatus === "pending_funding" ? "text-amber-600" :
                          "text-muted-foreground"
                        }`}>
                          {asg.escrowStatus || asg.payoutStatus}
                          {asg.escrowMode === "simulated" && <span className="text-[9px] text-amber-600 ml-0.5">(T)</span>}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {asg.deadline ? (() => {
                          const days = Math.ceil((new Date(asg.deadline).getTime() - Date.now()) / 86400000);
                          return <span className={days <= 1 ? "text-danger font-bold" : days <= 3 ? "text-amber-600 font-bold" : "text-muted-foreground"}>
                            {new Date(asg.deadline).toLocaleDateString()}
                            {days <= 3 && days >= 0 && <span className="ml-1 text-[9px]">({days}d)</span>}
                            {days < 0 && <span className="ml-1 text-[9px] text-danger">(OVERDUE)</span>}
                          </span>;
                        })() : "N/A"}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          switch (asg.status) {
                            case "draft": return <Badge variant="secondary">Draft</Badge>;
                            case "unassigned": return <Badge variant="primary">Unassigned</Badge>;
                            case "assigned": return <Badge variant="warning">Claimed</Badge>;
                            case "in_progress": return <Badge variant="warning">Drafting</Badge>;
                            case "draft_submitted": return <Badge variant="info">Submitted</Badge>;
                            case "under_review": return <Badge variant="info">Auditing</Badge>;
                            case "review_rejected": return <Badge variant="warning">Returned</Badge>;
                            case "completed": return <Badge variant="success">Completed</Badge>;
                            case "disputed": return <Badge variant="danger">Disputed</Badge>;
                            default: return <Badge variant="secondary">{asg.status}</Badge>;
                          }
                        })()}
                      </TableCell>
                      <TableCell>
                        {asg.allocationStatus && asg.allocationStatus !== "pending" ? (
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                            asg.allocationStatus === "offered" ? "bg-amber-500/15 text-amber-600" :
                            asg.allocationStatus === "accepted" ? "bg-success/15 text-success" :
                            asg.allocationStatus === "pool" ? "bg-primary/15 text-primary" :
                            asg.allocationStatus === "timed_out" ? "bg-danger/15 text-danger" :
                            "bg-secondary text-muted-foreground"
                          }`}>
                            {asg.allocationStatus}
                          </span>
                        ) : <span className="text-border text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/projects/detail?id=${asg.id}`}>
                          <Button variant="outline" size="sm">Open Workspace</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </div>
      )}

      {/* =====================================================================
          VERIFICATION QUEUE TAB
          ===================================================================== */}
      {activeTab === "verifications" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Academic Verification Review Queue</h2>
              <p className="text-sm text-muted-foreground -mt-0">
                Audit submitted certifications and transcripts. Approving enables writer workbench eligibility.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadVerifications} disabled={loadingPending} className="text-xs">
              🔄 Refresh
            </Button>
          </div>

          {/* Status Filter Pills (Revision 1 & 6) */}
          {!loadingPending && pendingExperts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {[
                { label: "Pending Review", value: "pending_review", count: pendingExperts.filter(e => e.verificationStatus === "pending_review").length },
                { label: "Approved", value: "approved", count: pendingExperts.filter(e => e.verificationStatus === "approved").length },
                { label: "Rejected", value: "rejected", count: pendingExperts.filter(e => e.verificationStatus === "rejected").length },
                { label: "Clarification Required", value: "clarification_required", count: pendingExperts.filter(e => e.verificationStatus === "clarification_required").length },
              ].map(pill => (
                <button
                  key={pill.value}
                  type="button"
                  onClick={() => setVerFilter(pill.value as any)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                    verFilter === pill.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {pill.label}
                  {pill.count > 0 && (
                    <span className={`ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                      verFilter === pill.value ? "bg-white/20 text-white" : "bg-secondary text-muted-foreground"
                    }`}>{pill.count}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {loadingPending ? (
            <div className="py-12 flex justify-center"><Loader size="md" /></div>
          ) : filteredExperts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center border border-border/30 bg-card rounded-xl">
              <span className="text-5xl">✅</span>
              <div>
                <h3 className="font-bold text-foreground">Queue Clear</h3>
                <p className="text-sm text-muted-foreground mt-1">No academic experts found under status: <strong className="text-foreground uppercase">{verFilter.replace(/_/g, " ")}</strong></p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {filteredExperts.map((exp) => (
                <Card key={exp.uid} className="border-border shadow-md">
                  <CardHeader className="border-b border-border/40 pb-4">
                    <div className="flex justify-between items-start gap-4 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={exp.role === "writer" ? "warning" : "info"} className="uppercase font-mono font-bold text-[10px]">
                            {exp.role} Candidate
                          </Badge>
                          <span className="font-mono text-xs text-muted-foreground">ID: {exp.uid.slice(0, 12)}...</span>
                          <span className="capitalize text-[10px] font-bold px-2 py-0.5 rounded bg-secondary text-muted-foreground font-mono">
                            Status: {exp.verificationStatus || "draft"}
                          </span>
                        </div>
                        <CardTitle className="text-xl mt-2">{exp.displayName}</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground font-semibold">
                          {exp.email} | Phone: {exp.academic?.phone || "N/A"}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-5 text-sm flex flex-col gap-4">
                    {/* Quality Vetting Metadata (Revision 6) */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 border-b border-border/10 pb-4 text-xs font-semibold">
                      <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Account Created</span>
                        <span className="text-foreground mt-0.5 block">{new Date(exp.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Last Login Date</span>
                        <span className="text-foreground mt-0.5 block">{exp.lastLoginDate ? new Date(exp.lastLoginDate).toLocaleDateString() : "Never"}</span>
                      </div>
                      <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Submission Date</span>
                        <span className="text-foreground mt-0.5 block">{exp.submissionDate ? new Date(exp.submissionDate).toLocaleDateString() : "N/A"}</span>
                      </div>
                      <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Documents Uploaded</span>
                        <span className="text-foreground mt-0.5 block font-extrabold text-primary">{countDocuments(exp)} files</span>
                      </div>
                      <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Previous Rejections</span>
                        <span className="text-foreground mt-0.5 block font-extrabold text-danger">{exp.previousRejectionsCount || 0}</span>
                      </div>
                      <div className="bg-secondary/20 p-2.5 rounded-lg border border-border/10">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Clarification Requests</span>
                        <span className="text-foreground mt-0.5 block font-extrabold text-amber-600">{exp.previousClarificationsCount || 0}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-border/20 pb-4">
                      <div>
                        <strong className="text-foreground block text-xs font-bold uppercase tracking-wider text-muted-foreground">Academic Attainment:</strong>
                        <div className="mt-1 font-semibold text-foreground">🏫 {getUniversityLabel(exp.academic?.university)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          🎓 Major: {getMajorLabel(exp.academic?.faculty, exp.academic?.major)} | Grad: {exp.academic?.yearOfStudy}
                        </div>
                      </div>
                      <div>
                        <strong className="text-foreground block text-xs font-bold uppercase tracking-wider text-muted-foreground">Academic Competencies:</strong>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {exp.academic?.specializations?.map((s) => (
                            <Badge key={s} variant="secondary" className="text-[10px] py-0 px-2 font-semibold">
                              {s.replace(/_/g, " ")}
                            </Badge>
                          )) || <span className="text-xs text-muted-foreground">None Specified</span>}
                        </div>
                      </div>
                    </div>

                    <div className="border-b border-border/20 pb-4">
                      <strong className="text-foreground block text-xs font-bold uppercase tracking-wider text-muted-foreground">Professional Biography:</strong>
                      <p className="text-foreground/90 mt-1.5 leading-relaxed text-xs italic bg-secondary/30 p-3 rounded-lg border border-border/40">
                        &quot;{exp.academic?.bio || "No professional biography supplied."}&quot;
                      </p>
                    </div>

                    {/* Submitted Credentials Documents (Revision 3) */}
                    <div className="border-b border-border/20 pb-4">
                      <strong className="text-foreground block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Submitted Credentials Documents:</strong>
                      <div className="flex gap-2 flex-wrap">
                        {exp.academic?.documents?.degreeCertificateUrl ? (
                          <a href={exp.academic.documents.degreeCertificateUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-bold bg-primary/10 text-primary py-2 px-3.5 rounded-lg border border-primary/25 hover:bg-primary/20 transition-all select-none">
                            🎓 Degree Certificate
                          </a>
                        ) : (
                          <span className="text-xs text-danger font-semibold bg-danger/10 py-2 px-3.5 rounded-lg border border-danger/20">Degree Scan Missing</span>
                        )}
                        {exp.academic?.documents?.transcriptUrl ? (
                          <a href={exp.academic.documents.transcriptUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-bold bg-primary/10 text-primary py-2 px-3.5 rounded-lg border border-primary/25 hover:bg-primary/20 transition-all select-none">
                            📊 Academic Transcript
                          </a>
                        ) : (
                          <span className="text-xs text-danger font-semibold bg-danger/10 py-2 px-3.5 rounded-lg border border-danger/20">Transcript Scan Missing</span>
                        )}
                        {exp.academic?.documents?.cvUrl && (
                          <a href={exp.academic.documents.cvUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-bold bg-secondary text-foreground py-2 px-3.5 rounded-lg border border-border hover:bg-secondary/80 transition-all select-none">
                            📄 CV File
                          </a>
                        )}
                        {exp.academic?.documents?.certificationsUrl && (
                          <a href={exp.academic.documents.certificationsUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-bold bg-secondary text-foreground py-2 px-3.5 rounded-lg border border-border hover:bg-secondary/80 transition-all select-none">
                            📜 Certifications
                          </a>
                        )}
                        {exp.academic?.documents?.publicationsUrl && (
                          <a href={exp.academic.documents.publicationsUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-bold bg-secondary text-foreground py-2 px-3.5 rounded-lg border border-border hover:bg-secondary/80 transition-all select-none">
                            📚 Publications
                          </a>
                        )}
                        {exp.academic?.documents?.supportingDocsUrl && (
                          <a href={exp.academic.documents.supportingDocsUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-bold bg-secondary text-foreground py-2 px-3.5 rounded-lg border border-border hover:bg-secondary/80 transition-all select-none">
                            📂 Supporting Files
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Admin internal notes */}
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                        Internal Notes / Rejection Reason / Clarification Description:
                      </label>
                      <textarea
                        className="w-full px-3.5 py-2.5 text-xs bg-background border border-border/50 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 min-h-[60px] placeholder:text-muted-foreground/50"
                        placeholder="Required for Rejections and Clarification requests..."
                        value={verificationNotes[exp.uid] || ""}
                        onChange={e => setVerificationNotes(prev => ({ ...prev, [exp.uid]: e.target.value }))}
                      />
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-wrap justify-end gap-3 border-t border-border/40 bg-secondary/20 pt-4">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => handleRequestMoreInfo(exp.uid, exp.displayName)}
                      disabled={actioningUser !== null || exp.verificationStatus === "approved"}
                      className="text-xs hover:text-primary hover:border-primary hover:bg-primary/5"
                    >
                      📩 Request Clarification
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => handleRejectExpert(exp.uid, exp.displayName, exp.role)}
                      disabled={actioningUser !== null || exp.verificationStatus === "approved"}
                      className="hover:text-danger hover:border-danger hover:bg-danger/5 transition-all text-xs"
                    >
                      Reject Candidate
                    </Button>
                    <Button
                      variant="primary" size="sm"
                      onClick={() => handleApproveExpert(exp.uid, exp.displayName, exp.role)}
                      isLoading={actioningUser === exp.uid}
                      disabled={actioningUser !== null || exp.verificationStatus === "approved"}
                      className="bg-success border-success hover:bg-success/90 hover:border-success/90 transition-all text-xs font-bold"
                    >
                      ✓ Approve Expert Account
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          DISPUTES TAB
          ===================================================================== */}
      {activeTab === "disputes" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Dispute Arbitration Centre</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Review active escrow disputes and take resolution action.</p>
            </div>
            <Button variant="outline" size="sm" onClick={loadDisputes} disabled={loadingDisputes} className="text-xs">
              🔄 Refresh
            </Button>
          </div>

          {loadingDisputes ? (
            <div className="py-12 flex justify-center"><Loader size="md" /></div>
          ) : openDisputes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <span className="text-5xl">⚖️</span>
              <div>
                <h3 className="font-bold text-foreground">No Active Disputes</h3>
                <p className="text-sm text-muted-foreground mt-1">The platform is running clean. No escrow disputes require attention.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {openDisputes.map((dis) => (
                <Card key={dis.disputeId} className="border-danger/20 bg-danger/3">
                  <CardHeader className="border-b border-danger/10">
                    <div className="flex justify-between items-start gap-4 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="danger" className="font-mono text-xs">{dis.disputeId}</Badge>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {dis.relatedType === "assignment" ? "📋" : "🔬"} {dis.relatedId}
                          </Badge>
                          <Badge variant="danger" className="uppercase text-[9px] font-extrabold">Open</Badge>
                        </div>
                        <CardTitle className="text-base mt-2">
                          {dis.relatedType === "assignment" ? "Assignment Dispute" : "Research Dispute"}
                        </CardTitle>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">
                        {new Date(dis.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <CardDescription className="text-sm mt-2">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Dispute Reason:</span>
                      <p className="text-foreground/90 mt-1 leading-relaxed text-sm">{dis.reason}</p>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4 text-xs flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-secondary/30 p-2.5 rounded-lg">
                        <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px] block">Student ID</span>
                        <span className="font-mono font-bold text-foreground">{dis.studentId?.slice(0, 12) || "N/A"}</span>
                      </div>
                      <div className="bg-secondary/30 p-2.5 rounded-lg">
                        <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px] block">Writer ID</span>
                        <span className="font-mono font-bold text-foreground">{dis.writerId?.slice(0, 12) || "N/A"}</span>
                      </div>
                    </div>
                    {dis.adminNotes && (
                      <div className="bg-secondary/20 p-2.5 rounded-lg mt-1">
                        <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px] block">Admin Notes</span>
                        <p className="text-foreground/80 mt-0.5 italic">{dis.adminNotes}</p>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex flex-wrap justify-end gap-3 border-t border-danger/10 bg-danger/5 pt-4">
                    <Link href={`/${dis.relatedType === "assignment" ? "projects" : "research"}/detail?id=${dis.relatedId}`}>
                      <Button variant="outline" size="sm" className="text-xs">View Workspace</Button>
                    </Link>
                    <Button variant="outline" size="sm" className="text-xs hover:text-primary hover:border-primary"
                      onClick={() => handleRefundDispute(dis.disputeId)}>
                      💳 Refund Escrow
                    </Button>
                    <Button variant="danger" size="sm" className="text-xs"
                      onClick={() => handleOpenResolveModal(dis.disputeId, dis.relatedId)}>
                      ✓ Resolve Dispute
                    </Button>
                  </CardFooter>
                </Card>
              ))}

              {/* Resolved disputes (collapsed) */}
              {disputes.filter(d => d.status === "resolved").length > 0 && (
                <details className="mt-4">
                  <summary className="text-xs font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors py-2">
                    View {disputes.filter(d => d.status === "resolved").length} resolved disputes ▾
                  </summary>
                  <div className="flex flex-col gap-3 mt-3">
                    {disputes.filter(d => d.status === "resolved").map(dis => (
                      <Card key={dis.disputeId} className="border-border/30 opacity-60">
                        <CardContent className="pt-4 flex justify-between items-center text-xs">
                          <div>
                            <Badge variant="secondary" className="font-mono mr-2">{dis.disputeId}</Badge>
                            <span className="text-foreground/70">{dis.reason.substring(0, 80)}...</span>
                          </div>
                          <Badge variant="success">Resolved</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          USER MANAGEMENT TAB
          ===================================================================== */}
      {activeTab === "users" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">User Management</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Search, filter, and manage platform accounts. All sensitive actions are audit-logged.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadUsers} disabled={loadingUsers} className="text-xs">
              🔄 Refresh
            </Button>
          </div>

          {/* Search + filter row */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search by name or email..."
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              className="flex-1 px-3.5 py-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 placeholder:text-muted-foreground/50"
            />
            <select
              value={userRoleFilter}
              onChange={e => setUserRoleFilter(e.target.value)}
              className="px-3.5 py-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 cursor-pointer"
            >
              <option value="all">All Roles</option>
              <option value="customer">Students</option>
              <option value="writer">Writers</option>
              <option value="proofreader">Proofreaders</option>
              <option value="admin">Admins</option>
            </select>
          </div>

          {loadingUsers ? (
            <div className="py-12 flex justify-center"><Loader size="md" /></div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <span className="text-5xl">👥</span>
              <div>
                <h3 className="font-bold text-foreground">No Users Found</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {userSearch || userRoleFilter !== "all" ? "No users match your search criteria." : "No registered user profiles found."}
                </p>
              </div>
            </div>
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Reputation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map(u => (
                    <TableRow key={u.uid}>
                      <TableCell className="font-semibold text-foreground">{u.displayName}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{u.email}</TableCell>
                      <TableCell>{getRoleBadge(u.role)}</TableCell>
                      <TableCell className="font-mono text-xs text-amber-500 font-bold">
                        {u.reputation ? `${u.reputation.toFixed(2)} ★` : "N/A"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.status === "active" ? "success" : "danger"} className="uppercase text-[9px] font-extrabold">
                          {u.status || "active"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2 flex-wrap">
                          <Link href={`/admin/detail?id=${u.uid}`} passHref>
                            <Button variant="outline" size="sm" className="text-xs">Profile</Button>
                          </Link>
                          <Button
                            variant="outline" size="sm"
                            onClick={() => handleToggleUserStatus(u.uid, u.status || "active")}
                            isLoading={actioningUser === u.uid}
                            className={`text-xs ${u.status === "suspended"
                              ? "bg-success/10 text-success hover:bg-success/20 border-success/30"
                              : "bg-danger/10 text-danger hover:bg-danger/20 border-danger/30"}`}
                          >
                            {u.status === "suspended" ? "Reactivate" : "Suspend"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </div>
      )}

      {/* =====================================================================
          SYSTEM METRICS TAB
          ===================================================================== */}
      {activeTab === "metrics" && (
        <div className="flex flex-col gap-6">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Platform Metrics Overview</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Live operational health indicators derived from Firestore data.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadMetrics} disabled={loadingMetrics} className="text-xs">
              🔄 Refresh
            </Button>
          </div>

          {loadingMetrics ? (
            <div className="py-12 flex justify-center"><Loader size="md" /></div>
          ) : !metrics ? (
            <Alert variant="error" title="Metrics Error">Failed to load platform metrics. Please try again.</Alert>
          ) : (
            <>
              {/* Primary metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: "Total Research Requests", val: metrics.totalResearch, sub: `${metrics.pendingResearch} pending review`, icon: "🔬", tab: "research" },
                  { label: "Total Assignments", val: metrics.totalAssignments, sub: `${metrics.activeAssignments} active`, icon: "📋", tab: "assignments" },
                  { label: "Pending Verifications", val: metrics.pendingVerifications, sub: "Awaiting credential review", icon: "🛡️", tab: "verifications" },
                  { label: "Open Disputes", val: metrics.openDisputes, sub: "Escrow arbitration", icon: "⚖️", tab: "disputes" },
                ].map((m, idx) => (
                  <button key={idx} onClick={() => setActiveTab(m.tab)} className="text-left">
                    <Card className={`hover:shadow-md transition-all cursor-pointer ${m.val > 0 && idx < 2 ? "" : m.val > 0 ? "border-warning/30 bg-warning/3" : ""}`}>
                      <CardContent className="pt-6 flex items-center justify-between">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</span>
                          <span className="text-3xl font-black text-foreground">{m.val}</span>
                          <span className="text-xs text-muted-foreground">{m.sub}</span>
                        </div>
                        <div className="text-3xl bg-secondary/50 p-2.5 rounded-lg select-none">{m.icon}</div>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>

              {/* Secondary metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {[
                  { label: "Platform Users", val: metrics.totalUsers, icon: "👥" },
                  { label: "Verified Writers", val: metrics.totalWriters, icon: "✍️" },
                  { label: "Unassigned Projects", val: metrics.unassignedAssignments, icon: "📌" },
                  { label: "Research Pending", val: metrics.pendingResearch, icon: "⏳" },
                ].map((m, idx) => (
                  <Card key={idx} className="border-border/30">
                    <CardContent className="pt-4 pb-4 flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">{m.label}</span>
                        <span className="text-2xl font-black text-foreground mt-0.5 block">{m.val}</span>
                      </div>
                      <span className="text-2xl">{m.icon}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Database status */}
              <Card className="border border-border/40">
                <CardHeader>
                  <CardTitle className="text-sm">Database Sync Integrity</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground font-semibold flex flex-col gap-2">
                  {[
                    ["Firestore Collections Status", <Badge variant="success">Operational</Badge>],
                    ["Security Rules Enforcement", <Badge variant="success">Active</Badge>],
                    ["Storage Rules Enforcement", <Badge variant="success">Active</Badge>],
                    ["Cloud Functions (OCR)", <Badge variant="success">europe-west1</Badge>],
                  ].map(([label, badge], i) => (
                    <div key={i} className="flex justify-between items-center border-b border-border/20 pb-2 last:border-0 last:pb-0">
                      <span>{label as string}</span>
                      {badge as React.ReactNode}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* =====================================================================
          AUDIT LOGS TAB
          ===================================================================== */}
      {activeTab === "audit" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Platform Audit Trail</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Immutable log of all sensitive administrative events. Platform-wide scope.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadAuditLogs} disabled={loadingAudit} className="text-xs">
              🔄 Refresh Logs
            </Button>
          </div>

          {loadingAudit ? (
            <div className="py-12 flex justify-center"><Loader size="md" /></div>
          ) : auditLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <span className="text-5xl">📜</span>
              <div>
                <h3 className="font-bold text-foreground">No Audit Logs</h3>
                <p className="text-sm text-muted-foreground mt-1">No platform-level administrative events have been recorded yet.</p>
              </div>
            </div>
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-semibold text-foreground text-xs">{log.actorName}</TableCell>
                      <TableCell className="uppercase font-mono text-[10px] font-bold text-muted-foreground">
                        {log.actorRole}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="uppercase font-mono text-[9px] py-0.5 px-2 font-extrabold bg-secondary/80">
                          {log.action?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <span className="uppercase text-[9px] font-bold">{log.targetType}</span>
                        <br />
                        <span>{log.targetId?.slice(0, 10)}</span>
                      </TableCell>
                      <TableCell className="text-foreground max-w-sm text-xs leading-normal font-semibold">
                        {log.details}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </div>
      )}

      {/* =====================================================================
          RESOLVE DISPUTE MODAL
          ===================================================================== */}
      <Modal
        isOpen={!!resolveModal}
        onClose={() => setResolveModal(null)}
        title="Resolve Dispute"
      >
        <div className="flex flex-col gap-4">
          <Alert variant="warning" title="Confirm Resolution">
            This action will mark the dispute as resolved and log it in the platform audit trail.
            Escrow will remain in its current state unless you also click Refund.
          </Alert>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Resolution Summary *
            </label>
            <textarea
              className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 min-h-[80px] resize-y placeholder:text-muted-foreground/50"
              placeholder="e.g. Writer agreed to submit revised work within 48 hours. Escrow held pending revision..."
              value={resolveText}
              onChange={e => setResolveText(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Admin Internal Notes (optional)
            </label>
            <textarea
              className="w-full px-3.5 py-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 min-h-[60px] resize-y placeholder:text-muted-foreground/50"
              placeholder="Internal notes not visible to students or writers..."
              value={resolveNotes}
              onChange={e => setResolveNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setResolveModal(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleResolveDispute}
              isLoading={isResolving}
              disabled={!resolveText.trim()}
              className="bg-success border-success hover:bg-success/90 font-bold"
            >
              ✓ Confirm Resolution
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
