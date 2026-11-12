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
  ResearchRequest, 
  ResearchRequestStatus, 
  ClarificationMessage,
  UserProfile,
  ProjectFile
} from "@/types/domain";
import { auditService } from "./auditService";
import { userService } from "./userService";
import { apiClient } from "./apiClient";

const RESEARCH_COLLECTION = "researchRequests";

export const researchService = {
  /**
   * Fetch a single research request
   */
  async getResearchRequest(id: string): Promise<ResearchRequest | null> {
    try {
      const docRef = doc(db, RESEARCH_COLLECTION, id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data() as ResearchRequest;
      }
      return null;
    } catch (e) {
      console.error(`Error fetching research request ${id}:`, e);
      throw e;
    }
  },

  /**
   * Create a new research request
   */
  async createResearchRequest(request: Omit<ResearchRequest, "id" | "status" | "createdAt" | "updatedAt">): Promise<ResearchRequest> {
    const id = `RES-${Math.floor(1000 + Math.random() * 9000)}`;
    const timestamp = new Date().toISOString();

    // Determine initial status based on completeness
    const isComplete = 
      request.title && 
      request.subject && 
      request.levelOfStudy && 
      request.deadline && 
      request.expectedDeliverable && 
      request.pastedBrief && 
      request.pastedBrief.trim().length > 30;

    const initialStatus: ResearchRequestStatus = isComplete ? "submitted" : "needs_clarification";

    const newRequest: ResearchRequest = {
      ...request,
      id,
      status: initialStatus,
      clarificationNeeded: !isComplete,
      clarificationThread: !isComplete ? [{
        senderId: "system",
        senderRole: "admin",
        senderName: "DataBoy Assistant",
        message: "Your research brief is incomplete. Please supply clarification details for Topic, Deadline, Level of Study, or Expected Deliverable in the box below to help our administration review your request.",
        createdAt: timestamp
      }] : [],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Authoritative backend API creation (no client setDoc fallback)
    const apiRes = await apiClient.post<{
      success: boolean;
      requestId: string;
      status: string;
    }>("/api/research", {
      title: request.title,
      requestTypes: request.requestTypes,
      pastedBrief: request.pastedBrief,
      expectedDeliverable: request.expectedDeliverable,
      subject: request.subject || "general",
      levelOfStudy: request.levelOfStudy || "degree",
      deadline: request.deadline,
      otherDetails: request.otherDetails,
      files: request.files || [],
    });

    if (!apiRes?.requestId) {
      throw new Error("Research request creation failed: server did not return a request ID.");
    }

    const fetched = await this.getResearchRequest(apiRes.requestId);
    if (fetched) return fetched;
    return {
      ...newRequest,
      id: apiRes.requestId,
    };
  },

  /**
   * List research requests with optional filters
   */
  async listResearchRequests(filters: {
    studentId?: string;
    assignedWriterId?: string;
    status?: ResearchRequestStatus;
  }): Promise<ResearchRequest[]> {
    try {
      const colRef = collection(db, RESEARCH_COLLECTION);
      let q = query(colRef);

      if (filters.studentId) {
        q = query(q, where("studentId", "==", filters.studentId));
      }
      if (filters.assignedWriterId) {
        q = query(q, where("assignedWriterId", "==", filters.assignedWriterId));
      }
      if (filters.status) {
        q = query(q, where("status", "==", filters.status));
      }

      const querySnap = await getDocs(q);
      const list: ResearchRequest[] = [];
      querySnap.forEach((doc) => {
        list.push(doc.data() as ResearchRequest);
      });
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.error("Error listing research requests:", e);
      throw e;
    }
  },

  /**
   * Send a clarification message via authenticated backend API
   */
  async sendClarificationMessage(
    requestId: string,
    message: Omit<ClarificationMessage, "createdAt">,
    actorProfile: UserProfile,
    nextStatus?: ResearchRequestStatus
  ): Promise<void> {
    await apiClient.post(`/api/research/${requestId}/clarifications`, {
      message: message.message,
      authorName: message.senderName || actorProfile.displayName,
      requestStudentClarification: nextStatus === "needs_clarification",
    });
  },

  /**
   * Submit Quote by Admin
   */
  async submitQuote(requestId: string, amount: number, notes: string, _adminProfile: UserProfile): Promise<void> {
    await apiClient.post(`/api/research/${requestId}/quote`, { quoteAmount: amount, quoteNotes: notes });
  },

  /**
   * Student Accepts or Rejects Quote
   */
  async handleQuoteDecision(requestId: string, accepted: boolean, studentProfile: UserProfile): Promise<void> {
    const quoteStatus = accepted ? "accepted" : "rejected";

    await apiClient.post(`/api/research/${requestId}/respond-quote`, { accept: accepted });
    await auditService.logActivity(requestId, {
      type: "status_change",
      actorId: studentProfile.uid,
      actorName: studentProfile.displayName,
      actorRole: "customer",
      message: `Student ${quoteStatus} the administration quote.`
    });
  },

  /**
   * Complete Escrow Payment (Student) — legacy direct funding is disabled.
   * Research requests must be funded through Lipila Mobile Money (/api/payments/initiate).
   */
  async completeEscrowPayment(_requestId: string, _studentProfile: UserProfile): Promise<void> {
    throw new Error(
      "Direct escrow funding is disabled. Please complete payment via Lipila Mobile Money checkout."
    );
  },

  /**
   * Assign Writer (Admin)
   */
  async assignWriter(requestId: string, writerId: string, _adminProfile: UserProfile): Promise<void> {
    await apiClient.post(`/api/research/${requestId}/assign`, { writerId });
  },

  /**
   * Update Status via authenticated backend API
   */
  async transitionStatus(
    requestId: string,
    nextStatus: ResearchRequestStatus,
    _actorProfile: UserProfile,
    extraUpdates: Partial<ResearchRequest> = {}
  ): Promise<void> {
    await apiClient.post(`/api/research/${requestId}/status`, {
      nextStatus,
      note: (extraUpdates as any)?.statusNote || undefined,
    });
  }
};
