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

    try {
      const docRef = doc(db, RESEARCH_COLLECTION, id);
      await setDoc(docRef, newRequest);

      // Log activity
      await auditService.logActivity(id, {
        type: "system_alert",
        actorId: request.studentId,
        actorName: "Student",
        actorRole: "customer",
        message: `Research request ${id} created with status: ${initialStatus}`
      });

      return newRequest;
    } catch (e) {
      console.error("Error creating research request:", e);
      throw e;
    }
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
   * Send a clarification message
   */
  async sendClarificationMessage(
    requestId: string,
    message: Omit<ClarificationMessage, "createdAt">,
    actorProfile: UserProfile,
    nextStatus?: ResearchRequestStatus
  ): Promise<void> {
    const docRef = doc(db, RESEARCH_COLLECTION, requestId);
    const timestamp = new Date().toISOString();

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists()) {
          throw new Error("Research request does not exist.");
        }
        const data = snap.data() as ResearchRequest;
        const thread = data.clarificationThread || [];
        
        const newMessage: ClarificationMessage = {
          ...message,
          createdAt: timestamp
        };

        const updatedThread = [...thread, newMessage];
        const payload: Partial<ResearchRequest> = {
          clarificationThread: updatedThread,
          updatedAt: timestamp
        };

        if (nextStatus) {
          payload.status = nextStatus;
          payload.clarificationNeeded = (nextStatus === "needs_clarification");
        }

        transaction.update(docRef, payload);
      });

      // Log activity
      await auditService.logActivity(requestId, {
        type: "comment",
        actorId: actorProfile.uid,
        actorName: actorProfile.displayName,
        actorRole: actorProfile.role,
        message: `Posted clarification message: ${message.message.substring(0, 100)}...`
      });

    } catch (e) {
      console.error("Error posting clarification message:", e);
      throw e;
    }
  },

  /**
   * Submit Quote by Admin
   */
  async submitQuote(requestId: string, amount: number, notes: string, adminProfile: UserProfile): Promise<void> {
    const docRef = doc(db, RESEARCH_COLLECTION, requestId);
    const timestamp = new Date().toISOString();

    try {
      await updateDoc(docRef, {
        quoteAmount: amount,
        quoteNotes: notes,
        quoteStatus: "pending_acceptance",
        status: "quote_ready",
        adminReviewedBy: adminProfile.uid,
        clarificationNeeded: false,
        updatedAt: timestamp
      });

      await auditService.logActivity(requestId, {
        type: "status_change",
        actorId: adminProfile.uid,
        actorName: adminProfile.displayName,
        actorRole: "admin",
        message: `Admin issued research quote: K${amount} (Notes: ${notes})`
      });
    } catch (e) {
      console.error("Error submitting quote:", e);
      throw e;
    }
  },

  /**
   * Student Accepts or Rejects Quote
   */
  async handleQuoteDecision(requestId: string, accepted: boolean, studentProfile: UserProfile): Promise<void> {
    const docRef = doc(db, RESEARCH_COLLECTION, requestId);
    const timestamp = new Date().toISOString();

    const nextStatus: ResearchRequestStatus = accepted ? "awaiting_payment" : "submitted";
    const quoteStatus = accepted ? "accepted" : "rejected";

    try {
      await updateDoc(docRef, {
        quoteStatus,
        status: nextStatus,
        updatedAt: timestamp
      });

      await auditService.logActivity(requestId, {
        type: "status_change",
        actorId: studentProfile.uid,
        actorName: studentProfile.displayName,
        actorRole: "customer",
        message: `Student ${quoteStatus} the administration quote.`
      });
    } catch (e) {
      console.error("Error handling quote decision:", e);
      throw e;
    }
  },

  /**
   * Complete Escrow Payment (Student)
   */
  async completeEscrowPayment(requestId: string, studentProfile: UserProfile): Promise<void> {
    const docRef = doc(db, RESEARCH_COLLECTION, requestId);
    const timestamp = new Date().toISOString();

    try {
      await updateDoc(docRef, {
        status: "funded",
        "quoteStatus": "paid",
        updatedAt: timestamp
      });

      await auditService.logActivity(requestId, {
        type: "status_change",
        actorId: studentProfile.uid,
        actorName: studentProfile.displayName,
        actorRole: "customer",
        message: `Escrow payment successfully loaded and funded for research request ${requestId}.`
      });
    } catch (e) {
      console.error("Error completing escrow payment:", e);
      throw e;
    }
  },

  /**
   * Assign Writer (Admin)
   */
  async assignWriter(requestId: string, writerId: string, adminProfile: UserProfile): Promise<void> {
    const docRef = doc(db, RESEARCH_COLLECTION, requestId);
    const timestamp = new Date().toISOString();

    try {
      await updateDoc(docRef, {
        assignedWriterId: writerId,
        status: "assigned",
        updatedAt: timestamp
      });

      await auditService.logActivity(requestId, {
        type: "status_change",
        actorId: adminProfile.uid,
        actorName: adminProfile.displayName,
        actorRole: "admin",
        message: `Admin assigned research request ${requestId} to Expert writer.`
      });
    } catch (e) {
      console.error("Error assigning writer:", e);
      throw e;
    }
  },

  /**
   * Update Status (Universal)
   */
  async transitionStatus(
    requestId: string,
    nextStatus: ResearchRequestStatus,
    actorProfile: UserProfile,
    extraUpdates: Partial<ResearchRequest> = {}
  ): Promise<void> {
    const docRef = doc(db, RESEARCH_COLLECTION, requestId);
    const timestamp = new Date().toISOString();

    try {
      await updateDoc(docRef, {
        ...extraUpdates,
        status: nextStatus,
        updatedAt: timestamp
      });

      await auditService.logActivity(requestId, {
        type: "status_change",
        actorId: actorProfile.uid,
        actorName: actorProfile.displayName,
        actorRole: actorProfile.role,
        message: `Research status shifted to [${nextStatus}]`
      });
    } catch (e) {
      console.error("Error updating status:", e);
      throw e;
    }
  }
};
