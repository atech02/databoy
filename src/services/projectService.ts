import { 
  doc, 
  getDoc, 
  setDoc, 
  query, 
  collection, 
  where, 
  getDocs 
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { 
  Project, 
  ProjectStatus, 
  UserProfile, 
  PayoutStatus 
} from "@/types/domain";
import { validateProject } from "@/utils/validation";
import { auditService } from "./auditService";
import { userService } from "./userService";
import { apiClient } from "./apiClient";

const PROJECTS_COLLECTION = "assignments"; // Must be 'assignments' to comply with firestore.rules

export const projectService = {
  /**
   * Fetches a project by ID
   */
  async getProject(id: string): Promise<Project | null> {
    console.log(`[QUERY_START] collection: ${PROJECTS_COLLECTION} | operation: get | path: ${PROJECTS_COLLECTION}/${id} | filters: none | orderBy: none | limit: 1`);
    try {
      const docRef = doc(db, PROJECTS_COLLECTION, id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        console.log(`[QUERY_SUCCESS] collection: ${PROJECTS_COLLECTION} | operation: get | path: ${PROJECTS_COLLECTION}/${id} | exists: true`);
        return docSnap.data() as Project;
      }
      console.log(`[QUERY_SUCCESS] collection: ${PROJECTS_COLLECTION} | operation: get | path: ${PROJECTS_COLLECTION}/${id} | exists: false`);
      return null;
    } catch (error: any) {
      console.error(`[QUERY_FAILURE] collection: ${PROJECTS_COLLECTION} | operation: get | path: ${PROJECTS_COLLECTION}/${id} | code: ${error?.code || 'unknown'} | message: ${error?.message}`);
      throw error;
    }
  },

  /**
   * Deploys a new project pipeline with inputs validation
   */
  async createProject(project: Omit<Project, "id" | "status" | "payoutStatus" | "writerId" | "proofreaderId" | "files" | "createdAt" | "updatedAt"> & { id?: string; status?: ProjectStatus; files?: any[] }): Promise<Project> {
    const id = project.id || `PRJ-${Math.floor(1000 + Math.random() * 9000)}`;
    const timestamp = new Date().toISOString();

    // Fetch customer's academic profile to seed matching priorities
    let customerUniversity = "";
    let customerMajor = "";
    try {
      const custProfile = await userService.getUserProfile(project.customerId);
      if (custProfile?.academic) {
        customerUniversity = custProfile.academic.university || "";
        customerMajor = custProfile.academic.major || "";
      }
    } catch (e) {
      console.warn("Failed to fetch customer profile details for matching priorities:", e);
    }

    const newProject: Project = {
      ...project,
      id,
      status: project.status || "draft",
      payoutStatus: "pending",
      writerId: null,
      proofreaderId: null,
      files: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      customerUniversity,
      customerMajor
    };

    const errors = validateProject(newProject);
    if (errors.length > 0) {
      throw new Error(`Project pipeline validation failed: ${errors.join(" | ")}`);
    }

    // Authoritative server-side assignment creation (C-1: no client setDoc fallback)
    const apiRes = await apiClient.post<{
      success: boolean;
      assignmentId: string;
      budget: number;
      pricingBreakdown: any;
    }>("/api/assignments", {
      title: project.title,
      description: project.guidelines || "Standard academic guidelines",
      academicLevel: project.academicLevel || "degree",
      subject: project.subject || "general",
      deadline: project.deadline,
      pageCount: project.pageCount,
      wordCount: project.wordCount,
      serviceType: project.projectType || "assignment",
      referencingStyle: project.referencingStyle,
      files: project.files || [],
    });

    if (!apiRes?.assignmentId) {
      throw new Error("Assignment creation failed: server did not return an assignment ID.");
    }

    const fetched = await this.getProject(apiRes.assignmentId);
    if (fetched) return fetched;

    return {
      ...newProject,
      id: apiRes.assignmentId,
      budget: apiRes.budget,
      pricingBreakdown: apiRes.pricingBreakdown,
    };
  },

  /**
   * Evaluates the priority level (Section 13) for a specialist matching a project
   * - Priority 1: Same Institution + Same Program
   * - Priority 2: Same Program (Different Institution)
   * - Priority 3: General Pool
   */
  calculateMatchingPriority(project: Project, specialist: UserProfile): 1 | 2 | 3 {
    if (!specialist.academic || project.projectType !== "academic_assignment") {
      return 3;
    }

    const specUni = specialist.academic.university;
    const specMajor = specialist.academic.major;
    const custUni = project.customerUniversity;
    const custMajor = project.customerMajor;

    if (!custUni || !custMajor) {
      return 3;
    }

    if (specUni === custUni && specMajor === custMajor) {
      return 1;
    }

    if (specMajor === custMajor) {
      return 2;
    }

    return 3;
  },

  /**
   * Dynamic project listings matching filters
   */
  async listProjects(filters: {
    customerId?: string;
    writerId?: string;
    proofreaderId?: string;
    status?: ProjectStatus;
  }): Promise<Project[]> {
    const whereFilters: string[] = [];
    if (filters.customerId)    whereFilters.push(`customerId==${filters.customerId}`);
    if (filters.writerId)      whereFilters.push(`writerId==${filters.writerId}`);
    if (filters.proofreaderId) whereFilters.push(`proofreaderId==${filters.proofreaderId}`);
    if (filters.status)        whereFilters.push(`status==${filters.status}`);
    const filterStr = whereFilters.length > 0 ? whereFilters.join(' AND ') : 'none';

    console.log(`[QUERY_START] collection: ${PROJECTS_COLLECTION} | operation: list | filters: ${filterStr} | orderBy: none | limit: none`);
    try {
      const colRef = collection(db, PROJECTS_COLLECTION);
      let q = query(colRef);

      if (filters.customerId) {
        q = query(q, where("customerId", "==", filters.customerId));
      }
      if (filters.writerId) {
        q = query(q, where("writerId", "==", filters.writerId));
      }
      if (filters.proofreaderId) {
        q = query(q, where("proofreaderId", "==", filters.proofreaderId));
      }
      if (filters.status) {
        q = query(q, where("status", "==", filters.status));
      }

      const querySnap = await Promise.race([
        getDocs(q),
        new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error("Database project list query timed out (8s limit).")), 8000)
        )
      ]);
      console.log(`[QUERY_SUCCESS] collection: ${PROJECTS_COLLECTION} | operation: list | filters: ${filterStr} | resultSize: ${querySnap.size}`);
      const list: Project[] = [];
      querySnap.forEach((doc: any) => {
        list.push({
          id: doc.id,
          ...doc.data()
        } as Project);
      });

      return list;
    } catch (error: any) {
      console.error(`[QUERY_FAILURE] collection: ${PROJECTS_COLLECTION} | operation: list | filters: ${filterStr} | code: ${error?.code || 'unknown'} | message: ${error?.message}`);
      throw error;
    }
  },

  /**
   * Central Status Transition Engine (Express Backend Only).
   * Rejects direct client/Cloud-Function workflow mutations; all state & escrow
   * transitions must pass through authenticated Express API routes.
   */
  async transitionProjectStatus(
    projectId: string,
    nextStatus: ProjectStatus,
    actor: UserProfile,
    updates: Partial<Omit<Project, "id" | "status" | "createdAt" | "updatedAt">> = {}
  ): Promise<void> {
    if (nextStatus === "funded") {
      throw new Error(
        "Direct assignment funding is disabled. Use Lipila Mobile Money checkout (/api/payments/initiate)."
      );
    }

    const prevStatus: ProjectStatus = "unassigned";

    if (nextStatus === "assigned") {
      await apiClient.post(`/api/assignments/${projectId}/claim`);
      await auditService.logStatusChange(projectId, actor, prevStatus, nextStatus);
      return;
    } else if (nextStatus === "draft_submitted") {
      await apiClient.post(`/api/assignments/${projectId}/submit-draft`, {
        fileUrl: updates.files?.[0]?.url || "",
        notes: "Draft submitted for review",
      });
      await auditService.logStatusChange(projectId, actor, prevStatus, nextStatus);
      return;
    } else if (nextStatus === "under_review") {
      await apiClient.post(`/api/assignments/${projectId}/claim-review`);
      await auditService.logStatusChange(projectId, actor, prevStatus, nextStatus);
      return;
    } else if (nextStatus === "review_rejected") {
      await apiClient.post(`/api/assignments/${projectId}/reject-review`, {
        feedback: "Draft revision requested",
      });
      await auditService.logStatusChange(projectId, actor, prevStatus, nextStatus);
      return;
    } else if (nextStatus === "completed") {
      await apiClient.post(`/api/assignments/${projectId}/approve`, {
        finalFileUrl: updates.files?.[0]?.url || "",
        notes: "Approved and completed",
      });
      await auditService.logStatusChange(projectId, actor, prevStatus, nextStatus);
      return;
    }

    throw new Error(
      `Unsupported client status transition to '${nextStatus}'. Use the authoritative Express backend API.`
    );
  },

  // ---------------------------------------------------------------------------
  // BACKEND API INTEGRATIONS (Phase 4)
  // ---------------------------------------------------------------------------

  async fundViaApi(_assignmentId: string, _paymentMethod?: string, _transactionReference?: string): Promise<any> {
    throw new Error(
      "Direct assignment funding (/fund) is disabled. Use Lipila Mobile Money checkout (/api/payments/initiate)."
    );
  },

  async claimViaApi(assignmentId: string): Promise<any> {
    return apiClient.post(`/api/assignments/${assignmentId}/claim`);
  },

  async submitDraftViaApi(
    assignmentId: string,
    draftUrl: string,
    notes?: string,
    fileMeta?: { fileId?: string; storageKey?: string; fileName?: string }
  ): Promise<any> {
    return apiClient.post(`/api/assignments/${assignmentId}/submit-draft`, {
      draftUrl,
      notes,
      ...(fileMeta?.fileId ? { fileId: fileMeta.fileId } : {}),
      ...(fileMeta?.storageKey ? { storageKey: fileMeta.storageKey } : {}),
      ...(fileMeta?.fileName ? { fileName: fileMeta.fileName } : {}),
    });
  },

  async approveViaApi(assignmentId: string): Promise<any> {
    return apiClient.post(`/api/assignments/${assignmentId}/approve`);
  },

  async requestRevision(assignmentId: string, explanation: string): Promise<any> {
    return apiClient.post(`/api/assignments/${assignmentId}/revision`, { explanation });
  },

  async raiseDispute(assignmentId: string, reason: string, details?: string, evidenceFiles?: any[]): Promise<any> {
    return apiClient.post(`/api/assignments/${assignmentId}/dispute`, {
      reason,
      details,
      ...(evidenceFiles && evidenceFiles.length > 0 ? { evidenceFiles } : {}),
    });
  }
};
