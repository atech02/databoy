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
  } else if (vStatus === "under_review") {
    user.verificationStatus = "under_review";
    user.writerStatus = "inactive";
    user.isVerifiedWriter = false;
  } else {
    user.verificationStatus = (vStatus === "incomplete" || vStatus === "clarification_required" || vStatus === "rejected")
      ? vStatus
      : "draft";
    user.writerStatus = "inactive";
    user.isVerifiedWriter = false;
  }

  user.writerInterest = Boolean(
    user.writerInterest ||
    user.role === "writer" ||
    user.role === "proofreader" ||
    (vStatus && vStatus !== "draft")
  );
  const rawNotifPrefs = user.preferences?.notifications;
  const resolvedInApp =
    rawNotifPrefs?.inApp !== undefined
      ? rawNotifPrefs.inApp !== false
      : user.preferences?.inAppNotifications !== false;
  const resolvedEmail =
    rawNotifPrefs?.email !== undefined
      ? rawNotifPrefs.email !== false
      : user.preferences?.emailNotifications !== false;
  const resolvedPush =
    rawNotifPrefs?.push !== undefined
      ? rawNotifPrefs.push === true
      : user.preferences?.pushNotifications === true;

  user.preferences = {
    notifications: {
      inApp: resolvedInApp,
      email: resolvedEmail,
      push: resolvedPush,
    },
    inAppNotifications: resolvedInApp,
    emailNotifications: resolvedEmail,
    pushNotifications: resolvedPush,
  };

  user.competencies = user.competencies ?? (user.academic?.specializations || []);
  user.subjectExpertise = user.subjectExpertise ?? (user.academic?.specializations || []);
  user.degreeLevel = user.degreeLevel ?? (user.academic?.yearOfStudy || "");
  user.yearsOfExperience = user.yearsOfExperience ?? 0;
  user.preferredWorkload = user.preferredWorkload ?? 5;
  user.activeTaskCount = user.activeTaskCount ?? 0;
  user.completedAssignments = user.completedAssignments ?? (user.completedCount || 0);
  user.disputeCount = user.disputeCount ?? 0;
  user.revisionCount = user.revisionCount ?? 0;

  // Safe reputation normalization: preserves legitimate scores (1.0-5.0), preserves 0 (unrated),
  // parses valid numeric strings, defaults missing/null/invalid to 0 (unrated) without mutating stored data
  const rawRep = raw?.reputation;
  if (rawRep === undefined || rawRep === null) {
    user.reputation = 0;
  } else if (typeof rawRep === "number") {
    if (Number.isFinite(rawRep) && (rawRep === 0 || (rawRep >= 1.0 && rawRep <= 5.0))) {
      user.reputation = rawRep;
    } else {
      user.reputation = 0;
    }
  } else if (typeof rawRep === "string") {
    const parsed = Number(rawRep);
    if (Number.isFinite(parsed) && (parsed === 0 || (parsed >= 1.0 && parsed <= 5.0))) {
      user.reputation = parsed;
    } else {
      user.reputation = 0;
    }
  } else {
    user.reputation = 0;
  }
  user.averageRating = user.averageRating ?? (user.reputation || 0);

  // Independent writer & proofreader performance normalization (Phase 5.23)
  if (user.role === "writer" || user.role === "proofreader") {
    const rawWritingRating = raw?.writingRating;
    if (typeof rawWritingRating === "number" && Number.isFinite(rawWritingRating) && (rawWritingRating === 0 || (rawWritingRating >= 1.0 && rawWritingRating <= 5.0))) {
      user.writingRating = rawWritingRating;
    } else {
      user.writingRating = user.reputation || 0;
    }

    const rawProofreadingRating = raw?.proofreadingRating;
    if (typeof rawProofreadingRating === "number" && Number.isFinite(rawProofreadingRating) && (rawProofreadingRating === 0 || (rawProofreadingRating >= 1.0 && rawProofreadingRating <= 5.0))) {
      user.proofreadingRating = rawProofreadingRating;
    } else {
      user.proofreadingRating = 0;
    }

    const rawOverall = raw?.overallRating;
    if (typeof rawOverall === "number" && Number.isFinite(rawOverall) && (rawOverall === 0 || (rawOverall >= 1.0 && rawOverall <= 5.0))) {
      user.overallRating = rawOverall;
    } else {
      if (user.writingRating > 0 && user.proofreadingRating > 0) {
        user.overallRating = Number(((user.writingRating * 0.7) + (user.proofreadingRating * 0.3)).toFixed(2));
      } else if (user.writingRating > 0) {
        user.overallRating = user.writingRating;
      } else if (user.proofreadingRating > 0) {
        user.overallRating = user.proofreadingRating;
      } else {
        user.overallRating = 0;
      }
    }

    user.writingCompletedTasks = user.writingCompletedTasks ?? (user.completedAssignments || 0);
    user.proofreadingCompletedTasks = user.proofreadingCompletedTasks ?? 0;
    user.writingOnTimeRate = user.writingOnTimeRate ?? 100;
    user.proofreadingOnTimeRate = user.proofreadingOnTimeRate ?? 100;
    user.writingRejectionRate = user.writingRejectionRate ?? 0;
    user.proofreadingRejectionRate = user.proofreadingRejectionRate ?? 0;
    user.verifiedComplaintCount = user.verifiedComplaintCount ?? 0;
    user.performanceReviewStatus = user.performanceReviewStatus ?? (user.completedCount > 0 ? "good_standing" : "unrated");
    user.allocationPreference = user.allocationPreference ?? (
      user.overallRating >= 4.5 ? "highest" :
      user.overallRating >= 4.0 ? "high" :
      user.overallRating >= 3.0 ? "normal" :
      user.overallRating >= 2.0 ? "low" :
      user.overallRating > 0 ? "very_low" : "normal" // Unrated gets normal provisional preference
    );
    user.ratingHistory = Array.isArray(user.ratingHistory) ? user.ratingHistory : [];
  }

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
    fullName?: string;
    university: string;
    faculty?: string;
    major: string;
    yearOfStudy: string;
    degreeLevel?: string;
    subjects: string[];
    phone: string;
    bio?: string;
    degreeCertificateUrl?: string;
    transcriptUrl?: string;
    cvUrl?: string;
    certificationsUrl?: string;
    publicationsUrl?: string;
    supportingDocsUrl?: string;
    canProofread?: boolean;
    allowResubmit?: boolean;
  }): Promise<{ success: boolean; message: string; verificationStatus: string }> {
    return apiClient.post("/api/writers/apply", applicationData);
  },

  /**
   * Lists all users who have submitted or hold a writer verification status (Admin Queue)
   */
  async listPendingVerifications(): Promise<UserProfile[]> {
    console.log(`[QUERY_START] collection: ${USERS_COLLECTION} | operation: list | filters: writer applications | orderBy: none | limit: none`);
    try {
      const colRef = collection(db, USERS_COLLECTION);
      const querySnap = await getDocs(colRef);
      console.log(`[QUERY_SUCCESS] collection: ${USERS_COLLECTION} | operation: list | resultSize: ${querySnap.size}`);
      const list: UserProfile[] = [];
      querySnap.forEach((d) => {
        const raw = d.data() as UserProfile;
        const isApplicant =
          raw.role === "writer" ||
          raw.role === "proofreader" ||
          raw.writerInterest === true ||
          (raw.verificationStatus &&
            ["pending_review", "under_review", "clarification_required", "approved", "rejected"].includes(
              raw.verificationStatus
            ));
        if (isApplicant && raw.role !== "admin") {
          list.push(normalizeUserProfile(raw));
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
  async approveVerification(uid: string, _adminProfile: UserProfile, note?: string): Promise<void> {
    await apiClient.post(`/api/admin/writers/${uid}/approve`, {
      grantProofreading: true,
      ...(note ? { note } : {}),
    });
  },

  /**
   * Marks an application as Under Review via Express Backend API only.
   */
  async markVerificationUnderReview(uid: string, note?: string): Promise<void> {
    await apiClient.post(`/api/admin/writers/${uid}/under-review`, {
      ...(note ? { note } : {}),
    });
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
