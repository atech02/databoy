import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/config/firebase";
import { UserProfile, UserStatus, UserAvailability, VerificationStatus } from "@/types/domain";
import { validateUserProfile } from "@/utils/validation";
import { apiClient } from "./apiClient";

const USERS_COLLECTION = "users";

/**
 * Normalizes user profile data in-memory without persisting to Firestore.
 * Ensures legacy accounts with missing fields render smoothly and cleanly
 * without triggering unauthorized client-side writes to protected fields.
 */
export function normalizeUserProfile(raw: any): UserProfile {
  const user = { ...raw } as UserProfile;

  const vStatus = user.verificationStatus as string | undefined;
  if (vStatus === "verified" || vStatus === "approved") {
    user.verificationStatus = "approved";
    user.writerStatus = "active";
    user.isVerifiedWriter = true;
  } else if (vStatus === "pending" || vStatus === "pending_review") {
    user.verificationStatus = "pending_review";
    user.writerStatus = "inactive";
    user.isVerifiedWriter = false;
  } else {
    user.verificationStatus = (vStatus === "incomplete" || vStatus === "clarification_required" || vStatus === "rejected")
      ? vStatus
      : "draft";
    user.writerStatus = "inactive";
    user.isVerifiedWriter = false;
  }

  user.competencies = user.competencies ?? (user.academic?.specializations || []);
  user.subjectExpertise = user.subjectExpertise ?? (user.academic?.specializations || []);
  user.degreeLevel = user.degreeLevel ?? (user.academic?.yearOfStudy || "");
  user.yearsOfExperience = user.yearsOfExperience ?? 0;
  user.preferredWorkload = user.preferredWorkload ?? 5;
  user.averageRating = user.averageRating ?? (user.reputation || 0);
  user.activeTaskCount = user.activeTaskCount ?? 0;
  user.completedAssignments = user.completedAssignments ?? (user.completedCount || 0);
  user.disputeCount = user.disputeCount ?? 0;
  user.revisionCount = user.revisionCount ?? 0;
  user.reputation = user.reputation ?? 0;

  return user;
}

export const userService = {
  /**
   * Retrieves a user profile by UID
   */
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    console.log(`[QUERY_START] collection: ${USERS_COLLECTION} | operation: get | path: ${USERS_COLLECTION}/${uid} | filters: none | orderBy: none | limit: 1`);
    try {
      const docRef = doc(db, USERS_COLLECTION, uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        console.log(`[QUERY_SUCCESS] collection: ${USERS_COLLECTION} | operation: get | path: ${USERS_COLLECTION}/${uid} | exists: true`);
        // Pure in-memory normalization: do not perform client-side writes to protected fields
        return normalizeUserProfile(docSnap.data());
      }
      console.log(`[QUERY_SUCCESS] collection: ${USERS_COLLECTION} | operation: get | path: ${USERS_COLLECTION}/${uid} | exists: false`);
      return null;
    } catch (error: any) {
      console.error(`[QUERY_FAILURE] collection: ${USERS_COLLECTION} | operation: get | path: ${USERS_COLLECTION}/${uid} | code: ${error?.code || 'unknown'} | message: ${error?.message}`);
      throw error;
    }
  },

  /**
   * Creates a new user profile with validations (omitting protected server-controlled metrics/balances from Firestore write)
   */
  async createUserProfile(profile: Omit<UserProfile, "completedCount" | "reputation" | "createdAt" | "updatedAt">): Promise<UserProfile> {
    const timestamp = new Date().toISOString();
    const clientPayload = {
      ...profile,
      role: "customer" as const,
      status: "active" as const,
      yearsOfExperience: 0,
      preferredWorkload: 5,
      competencies: [],
      subjectExpertise: [],
      degreeLevel: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const newProfile: UserProfile = {
      ...clientPayload,
      reputation: 0,
      completedCount: 0,
      completedAssignments: 0,
      averageRating: 0,
      activeTaskCount: 0,
      disputeCount: 0,
      revisionCount: 0,
    };

    // Run inputs validation
    const validationErrors = validateUserProfile(newProfile);
    if (validationErrors.length > 0) {
      throw new Error(`Profile validation failed: ${validationErrors.join(" | ")}`);
    }

    console.log(`[QUERY_START] collection: ${USERS_COLLECTION} | operation: create | path: ${USERS_COLLECTION}/${newProfile.uid} | filters: none | orderBy: none | limit: none`);
    try {
      const docRef = doc(db, USERS_COLLECTION, newProfile.uid);
      await setDoc(docRef, clientPayload);
      console.log(`[QUERY_SUCCESS] collection: ${USERS_COLLECTION} | operation: create | path: ${USERS_COLLECTION}/${newProfile.uid}`);
      return newProfile;
    } catch (error: any) {
      console.error(`[QUERY_FAILURE] collection: ${USERS_COLLECTION} | operation: create | path: ${USERS_COLLECTION}/${newProfile.uid} | code: ${error?.code || 'unknown'} | message: ${error?.message}`);
      throw error;
    }
  },

  /**
   * Updates specific fields of a user profile
   */
  async updateUserProfile(uid: string, updates: Partial<Omit<UserProfile, "uid" | "createdAt" | "updatedAt">>): Promise<void> {
    console.log(`[QUERY_START] collection: ${USERS_COLLECTION} | operation: update | path: ${USERS_COLLECTION}/${uid} | fields: ${Object.keys(updates).join(',')} | orderBy: none | limit: none`);
    try {
      const docRef = doc(db, USERS_COLLECTION, uid);
      
      const payload = {
        ...updates,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(docRef, payload);
      console.log(`[QUERY_SUCCESS] collection: ${USERS_COLLECTION} | operation: update | path: ${USERS_COLLECTION}/${uid}`);
    } catch (error: any) {
      console.error(`[QUERY_FAILURE] collection: ${USERS_COLLECTION} | operation: update | path: ${USERS_COLLECTION}/${uid} | code: ${error?.code || 'unknown'} | message: ${error?.message}`);
      throw error;
    }
  },

  /**
   * Toggles active/suspended state of a user (Admin restricted Express API only)
   */
  async toggleUserStatus(uid: string, status: UserStatus): Promise<void> {
    if (status === "suspended") {
      await apiClient.post(`/api/admin/users/${uid}/suspend`, { reason: "Administrative suspension" });
    } else {
      await apiClient.post(`/api/admin/users/${uid}/activate`);
    }
  },

  /**
   * Changes a user's role via Express Backend API only.
   */
  async changeUserRole(uid: string, role: "customer" | "writer" | "admin"): Promise<void> {
    await apiClient.post(`/api/admin/users/${uid}/role`, { role });
  },

  /**
   * Submits writer application to the backend API
   */
  async applyForWriter(applicationData: {
    university: string;
    major: string;
    yearOfStudy: string;
    degreeLevel?: string;
    subjects: string[];
    phone: string;
    bio?: string;
    degreeCertificateUrl?: string;
    transcriptUrl?: string;
    cvUrl?: string;
    canProofread?: boolean;
  }): Promise<{ success: boolean; message: string; verificationStatus: string }> {
    return apiClient.post("/api/writers/apply", applicationData);
  },

  /**
   * Lists all users who have a verification status (Admin Queue)
   */
  async listPendingVerifications(): Promise<UserProfile[]> {
    console.log(`[QUERY_START] collection: ${USERS_COLLECTION} | operation: list | filters: role in [writer, proofreader] | orderBy: none | limit: none`);
    try {
      const colRef = collection(db, USERS_COLLECTION);
      const q = query(colRef, where("role", "in", ["writer", "proofreader"]));
      const querySnap = await getDocs(q);
      console.log(`[QUERY_SUCCESS] collection: ${USERS_COLLECTION} | operation: list | resultSize: ${querySnap.size}`);
      const list: UserProfile[] = [];
      querySnap.forEach((doc) => {
        const u = doc.data() as UserProfile;
        if (u.verificationStatus) {
          list.push(u);
        }
      });
      return list;
    } catch (error: any) {
      console.error(`[QUERY_FAILURE] collection: ${USERS_COLLECTION} | operation: list | code: ${error?.code || 'unknown'} | message: ${error?.message}`);
      throw error;
    }
  },

  /**
   * Approves academic credentials via Express Backend API only (no Cloud Function or direct fallback).
   */
  async approveVerification(uid: string, _adminProfile: UserProfile): Promise<void> {
    await apiClient.post(`/api/admin/writers/${uid}/approve`, { grantProofreading: true });
  },

  /**
   * Rejects academic credentials via Express Backend API only.
   */
  async rejectVerification(uid: string, reason: string, _adminProfile: UserProfile): Promise<void> {
    await apiClient.post(`/api/admin/writers/${uid}/reject`, { reason });
  },

  /**
   * Requests clarification on academic documents via Admin Backend API
   */
  async requestClarification(uid: string, message: string, _adminProfile: UserProfile): Promise<void> {
    await apiClient.post(`/api/admin/writers/${uid}/clarification`, { note: message });
  },

  /**
   * Fully suspends user account permissions via Admin Backend API
   */
  async suspendUser(uid: string): Promise<void> {
    await apiClient.post(`/api/admin/users/${uid}/suspend`, { reason: "Administrative suspension" });
  },

  /**
   * Updates expert work availability status via Writer Backend API
   */
  async updateExpertAvailability(_uid: string, availability: UserAvailability): Promise<void> {
    await apiClient.post("/api/writers/me/availability", { availability });
  },

  /**
   * Retrieves all user documents in the collection
   */
  async listAllUsers(): Promise<UserProfile[]> {
    console.log(`[QUERY_START] collection: ${USERS_COLLECTION} | operation: list | filters: none | orderBy: none | limit: none`);
    try {
      const colRef = collection(db, USERS_COLLECTION);
      const querySnap = await getDocs(colRef);
      console.log(`[QUERY_SUCCESS] collection: ${USERS_COLLECTION} | operation: list | resultSize: ${querySnap.size}`);
      const list: UserProfile[] = [];
      querySnap.forEach((doc) => {
        list.push(doc.data() as UserProfile);
      });
      return list;
    } catch (error: any) {
      console.error(`[QUERY_FAILURE] collection: ${USERS_COLLECTION} | operation: list | code: ${error?.code || 'unknown'} | message: ${error?.message}`);
      throw error;
    }
  },

  /**
   * Fetches authoritatively calculated wallet earnings and ledger transactions for current writer
   */
  async getWriterEarnings(): Promise<{ wallet: any; transactions: any[] }> {
    const res = await apiClient.get<{ wallet: any; transactions: any[] }>("/api/writers/me/earnings");
    return res;
  },

  /**
   * Submits a formal payout request against available balance
   */
  async requestPayout(amount: number, paymentMethod: string, paymentDetails: Record<string, any>): Promise<any> {
    const res = await apiClient.post<{ message: string; payoutId: string; remainingBalance: number }>(
      "/api/writers/me/payout-request",
      { amount, paymentMethod, paymentDetails }
    );
    return res;
  }
};
