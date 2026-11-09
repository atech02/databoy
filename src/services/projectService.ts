import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  query, 
  collection, 
  where, 
  getDocs, 
  runTransaction 
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

const PROJECTS_COLLECTION = "assignments"; // Must be 'assignments' to comply with firestore.rules

// Valid transition mapping matrix
const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ["priced", "awaiting_payment", "unassigned", "cancelled"],
  priced: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["funded", "cancelled"],
  funded: ["awaiting_assignment", "cancelled"],
  awaiting_assignment: ["assigned", "cancelled"],
  unassigned: ["assigned", "cancelled", "awaiting_payment", "awaiting_assignment"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["draft_submitted", "cancelled", "disputed"],
  draft_submitted: ["under_review", "disputed"],
  under_review: ["completed", "review_rejected", "disputed"],
  review_rejected: ["in_progress", "disputed"],
  completed: [], // Terminal state
  disputed: ["under_review", "completed", "cancelled"], // Admin mediation routes
  cancelled: [] // Terminal state
};

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
  async createProject(project: Omit<Project, "id" | "status" | "payoutStatus" | "writerId" | "proofreaderId" | "files" | "createdAt" | "updatedAt"> & { id?: string; status?: ProjectStatus }): Promise<Project> {
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

    try {
      const docRef = doc(db, PROJECTS_COLLECTION, id);
      await setDoc(docRef, newProject);
      return newProject;
    } catch (error) {
      console.error("Error creating project:", error);
      throw error;
    }
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
   * Central Transactional State Transition Engine.
   * Enforces transition constraints, validates actor roles, and commits audit logs atomically.
   */
  async transitionProjectStatus(
    projectId: string,
    nextStatus: ProjectStatus,
    actor: UserProfile,
    updates: Partial<Omit<Project, "id" | "status" | "createdAt" | "updatedAt">> = {}
  ): Promise<void> {
    const docRef = doc(db, PROJECTS_COLLECTION, projectId);
    let prevStatus: ProjectStatus = "unassigned";

    try {
      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(docRef);

        if (!docSnap.exists()) {
          throw new Error("Project document does not exist.");
        }

        const proj = docSnap.data() as Project;
        prevStatus = proj.status;

        // 1. Verify transition constraints
        const allowedNextStates = VALID_TRANSITIONS[prevStatus] || [];
        if (actor.role !== "admin" && !allowedNextStates.includes(nextStatus)) {
          throw new Error(`Invalid status transition: cannot move project from [${prevStatus}] to [${nextStatus}].`);
        }

        // 2. Validate actor roles per transition
        this.enforceRolePrivileges(prevStatus, nextStatus, actor, proj);

        // 3. Prepare next state updates
        const timestamp = new Date().toISOString();
        
        let note = "";
        if (nextStatus === "funded") {
          note = "Test escrow funded: payment secured.";
        } else if (nextStatus === "awaiting_assignment") {
          note = "Assignment moved to awaiting assignment queue.";
        } else if (nextStatus === "completed") {
          note = "Test escrow released: payment paid to writer.";
        } else if (nextStatus === "cancelled") {
          note = "Test escrow refunded: payment returned to student.";
        } else if (nextStatus === "assigned") {
          note = "Writer assigned and matched to task.";
        } else if (nextStatus === "in_progress") {
          note = "Writer started working on the draft.";
        } else if (nextStatus === "draft_submitted") {
          note = "Writer submitted a draft for review.";
        } else if (nextStatus === "under_review") {
          note = "Draft is currently under peer proofreading review.";
        } else if (nextStatus === "review_rejected") {
          note = "Draft rejected and returned to writer for revision.";
        }

        const nextHistoryEntry = {
          status: nextStatus,
          actorId: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          timestamp,
          note
        };
        const currentHistory = proj.statusHistory || [];

        const payload: Partial<Project> = {
          ...updates,
          status: nextStatus,
          statusHistory: [...currentHistory, nextHistoryEntry],
          updatedAt: timestamp
        };

        // Automate Payout transitions matching state
        if (nextStatus === "assigned" && proj.payoutStatus === "pending") {
          payload.payoutStatus = "escrowed"; // Move budget to Escrow upon claim
        } else if (nextStatus === "completed" && proj.payoutStatus === "escrowed") {
          payload.payoutStatus = "released"; // Release payment to specialist upon approval
        } else if (nextStatus === "cancelled" && proj.payoutStatus === "escrowed") {
          payload.payoutStatus = "refunded"; // Refund customer if project cancelled
        }

        // 4. Commit status update atomically
        transaction.update(docRef, payload);
      });

      // 5. Automatically log the activity
      await auditService.logStatusChange(projectId, actor, prevStatus, nextStatus);

    } catch (error) {
      console.error("Transactional state transition aborted:", error);
      throw error;
    }
  },

  /**
   * Enforces domain role privileges for status transitions
   */
  enforceRolePrivileges(
    prev: ProjectStatus, 
    next: ProjectStatus, 
    actor: UserProfile, 
    proj: Project
  ): void {
    // Admins bypass all role validation checks
    if (actor.role === "admin") return;

    // Check customer-owned pipelines
    if (next === "cancelled" || next === "unassigned" || next === "funded" || next === "awaiting_assignment" || next === "awaiting_payment") {
      if (actor.role !== "customer" || actor.uid !== proj.customerId) {
        throw new Error("Only the customer who created this project can modify its payment or assignment status.");
      }
    }

    const specialistRoles = ["writer", "proofreader"];

    // Check writer-owned actions (specialists)
    const isApprovedSpecialist = 
      actor.verificationStatus === "approved" && 
      actor.writerStatus === "active" && 
      actor.isVerifiedWriter === true;

    if (next === "assigned") {
      if (!specialistRoles.includes(actor.role)) {
        throw new Error("Only active specialists can claim unassigned projects.");
      }
      if (!isApprovedSpecialist) {
        throw new Error("You must be a verified specialist with an active account status to claim projects.");
      }
    }
    if (next === "draft_submitted" || (prev === "review_rejected" && next === "in_progress")) {
      if (!specialistRoles.includes(actor.role) || actor.uid !== proj.writerId) {
        throw new Error("Only the assigned specialist can submit work or start drafting changes.");
      }
    }

    // Check proofreader-owned actions (reviewers)
    if (next === "under_review" || next === "review_rejected" || next === "completed") {
      if (!specialistRoles.includes(actor.role)) {
        throw new Error("Only designated specialists can review, approve, or return drafts.");
      }
      if (next === "under_review" && !isApprovedSpecialist) {
        throw new Error("You must be a verified specialist to claim audits.");
      }
    }
  }
};
