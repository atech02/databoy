import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/config/firebase";
import { UserProfile, UserStatus, UserAvailability, VerificationStatus } from "@/types/domain";
import { validateUserProfile } from "@/utils/validation";

const USERS_COLLECTION = "users";

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
        const user = docSnap.data() as UserProfile;
        let modified = false;

        // Auto-migration & standardisation (Revision 1 & Issue 1 & 3)
        const vStatus = user.verificationStatus as string | undefined;
        if (vStatus === "verified" || vStatus === "approved") {
          if (user.verificationStatus !== "approved" || user.writerStatus !== "active" || user.isVerifiedWriter !== true) {
            user.verificationStatus = "approved";
            user.writerStatus = "active";
            user.isVerifiedWriter = true;
            modified = true;
          }
        } else if (vStatus === "pending" || vStatus === "pending_review") {
          if (user.verificationStatus !== "pending_review" || user.writerStatus !== "inactive" || user.isVerifiedWriter !== false) {
            user.verificationStatus = "pending_review";
            user.writerStatus = "inactive";
            user.isVerifiedWriter = false;
            modified = true;
          }
        } else {
          // draft, incomplete, unverified, clarification_required, rejected, null, undefined
          const targetStatus: any = (vStatus === "unverified" || !vStatus) 
            ? "draft" 
            : (vStatus === "incomplete" || vStatus === "clarification_required" || vStatus === "rejected" || vStatus === "draft")
            ? vStatus
            : "draft";

          if (user.verificationStatus !== targetStatus || user.writerStatus !== "inactive" || user.isVerifiedWriter !== false) {
            user.verificationStatus = targetStatus;
            user.writerStatus = "inactive";
            user.isVerifiedWriter = false;
            modified = true;
          }
        }

        // Initialize future-matching fields if missing (Revision 6)
        if (user.competencies === undefined) {
          user.competencies = user.academic?.specializations || [];
          modified = true;
        }
        if (user.subjectExpertise === undefined) {
          user.subjectExpertise = user.academic?.specializations || [];
          modified = true;
        }
        if (user.degreeLevel === undefined) {
          user.degreeLevel = user.academic?.yearOfStudy || "";
          modified = true;
        }
        if (user.yearsOfExperience === undefined) {
          user.yearsOfExperience = 0;
          modified = true;
        }
        if (user.preferredWorkload === undefined) {
          user.preferredWorkload = 5;
          modified = true;
        }
        if (user.averageRating === undefined) {
          user.averageRating = user.reputation || 0;
          modified = true;
        }
        if (user.activeTaskCount === undefined) {
          user.activeTaskCount = 0;
          modified = true;
        }
        if (user.completedAssignments === undefined) {
          user.completedAssignments = user.completedCount || 0;
          modified = true;
        }
        if (user.disputeCount === undefined) {
          user.disputeCount = 0;
          modified = true;
        }
        if (user.revisionCount === undefined) {
          user.revisionCount = 0;
          modified = true;
        }

        // Initialize reputation properly (Revision 6)
        if (user.reputation === undefined) {
          user.reputation = 0;
          modified = true;
        }

        if (modified) {
          // Save updated profile back to database asynchronously
          updateDoc(docRef, {
            verificationStatus: user.verificationStatus,
            writerStatus: user.writerStatus,
            isVerifiedWriter: user.isVerifiedWriter,
            competencies: user.competencies,
            subjectExpertise: user.subjectExpertise,
            degreeLevel: user.degreeLevel,
            yearsOfExperience: user.yearsOfExperience,
            preferredWorkload: user.preferredWorkload,
            averageRating: user.averageRating,
            activeTaskCount: user.activeTaskCount,
            completedAssignments: user.completedAssignments,
            disputeCount: user.disputeCount,
            revisionCount: user.revisionCount,
            reputation: user.reputation,
            updatedAt: new Date().toISOString()
          }).catch(err => console.error("Profile auto-migration failed:", err));
        }

        return user;
      }
      console.log(`[QUERY_SUCCESS] collection: ${USERS_COLLECTION} | operation: get | path: ${USERS_COLLECTION}/${uid} | exists: false`);
      return null;
    } catch (error: any) {
      console.error(`[QUERY_FAILURE] collection: ${USERS_COLLECTION} | operation: get | path: ${USERS_COLLECTION}/${uid} | code: ${error?.code || 'unknown'} | message: ${error?.message}`);
      throw error;
    }
  },

  /**
   * Creates a new user profile with validations
   */
  async createUserProfile(profile: Omit<UserProfile, "completedCount" | "reputation" | "createdAt" | "updatedAt">): Promise<UserProfile> {
    const timestamp = new Date().toISOString();
    const newProfile: UserProfile = {
      ...profile,
      reputation: 0, // Reputation framework default (Revision 6 / Issue 4)
      completedCount: 0,
      completedAssignments: 0,
      averageRating: 0,
      activeTaskCount: 0,
      disputeCount: 0,
      revisionCount: 0,
      yearsOfExperience: 0,
      preferredWorkload: 5,
      competencies: [],
      subjectExpertise: [],
      degreeLevel: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Run inputs validation
    const validationErrors = validateUserProfile(newProfile);
    if (validationErrors.length > 0) {
      throw new Error(`Profile validation failed: ${validationErrors.join(" | ")}`);
    }

    console.log(`[QUERY_START] collection: ${USERS_COLLECTION} | operation: create | path: ${USERS_COLLECTION}/${newProfile.uid} | filters: none | orderBy: none | limit: none`);
    try {
      const docRef = doc(db, USERS_COLLECTION, newProfile.uid);
      await setDoc(docRef, newProfile);
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
   * Toggles active/suspended state of a user (Admin restricted capability)
   */
  async toggleUserStatus(uid: string, status: UserStatus): Promise<void> {
    try {
      const docRef = doc(db, USERS_COLLECTION, uid);
      await updateDoc(docRef, {
        status,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error toggling user status:", error);
      throw error;
    }
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
   * Approves academic credentials, enabling expert dashboard access (Revision 1 & 7)
   */
  async approveVerification(uid: string, adminProfile: UserProfile): Promise<void> {
    try {
      const docRef = doc(db, USERS_COLLECTION, uid);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) throw new Error("User profile not found.");
      
      const user = docSnap.data() as UserProfile;
      const timestamp = new Date().toISOString();
      
      const newHistoryEntry = {
        status: "approved",
        actorId: adminProfile.uid,
        actorName: adminProfile.displayName,
        actorRole: adminProfile.role,
        timestamp,
        note: "Credentials approved manually by administrator."
      };
      
      const statusHistory = [...(user.statusHistory || []), newHistoryEntry];
      
      await updateDoc(docRef, {
        verificationStatus: "approved",
        writerStatus: "active",
        isVerifiedWriter: true,
        verifiedAt: timestamp,
        status: "active",
        availability: "available",
        profileCompletion: 100,
        
        // Reputation initialization (Revision 5)
        reputation: 0,
        completedCount: 0,
        disputeCount: 0,
        revisionCount: 0,
        activeTaskCount: 0,
        
        // Matching readiness default values (Revision 11)
        competencies: user.academic?.specializations || [],
        subjectExpertise: user.academic?.specializations || [],
        degreeLevel: user.academic?.yearOfStudy || "Degree",
        yearsOfExperience: 0,
        preferredWorkload: 5,
        averageRating: 0,
        completedAssignments: 0,
        
        statusHistory,
        updatedAt: timestamp
      });
    } catch (error) {
      console.error("Error approving expert verification:", error);
      throw error;
    }
  },

  /**
   * Rejects academic credentials and disables dashboard capabilities (Revision 1, 7 & 8)
   */
  async rejectVerification(uid: string, reason: string, adminProfile: UserProfile): Promise<void> {
    try {
      const docRef = doc(db, USERS_COLLECTION, uid);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) throw new Error("User profile not found.");
      
      const user = docSnap.data() as UserProfile;
      const timestamp = new Date().toISOString();
      
      const newHistoryEntry = {
        status: "rejected",
        actorId: adminProfile.uid,
        actorName: adminProfile.displayName,
        actorRole: adminProfile.role,
        timestamp,
        note: `Credentials rejected. Reason: ${reason}`
      };
      
      const statusHistory = [...(user.statusHistory || []), newHistoryEntry];
      const previousRejectionsCount = (user.previousRejectionsCount || 0) + 1;
      
      await updateDoc(docRef, {
        verificationStatus: "rejected",
        writerStatus: "inactive",
        isVerifiedWriter: false,
        rejectedAt: timestamp,
        rejectionReason: reason,
        statusHistory,
        previousRejectionsCount,
        updatedAt: timestamp
      });
    } catch (error) {
      console.error("Error rejecting expert verification:", error);
      throw error;
    }
  },

  /**
   * Requests clarification on academic documents (Revision 9)
   */
  async requestClarification(uid: string, message: string, adminProfile: UserProfile): Promise<void> {
    try {
      const docRef = doc(db, USERS_COLLECTION, uid);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) throw new Error("User profile not found.");
      
      const user = docSnap.data() as UserProfile;
      const timestamp = new Date().toISOString();
      
      const newHistoryEntry = {
        status: "clarification_required",
        actorId: adminProfile.uid,
        actorName: adminProfile.displayName,
        actorRole: adminProfile.role,
        timestamp,
        note: `Clarification requested: ${message}`
      };
      
      const statusHistory = [...(user.statusHistory || []), newHistoryEntry];
      const previousClarificationsCount = (user.previousClarificationsCount || 0) + 1;
      
      await updateDoc(docRef, {
        verificationStatus: "clarification_required",
        writerStatus: "inactive",
        isVerifiedWriter: false,
        rejectionReason: message, // Reuse field or display as feedback message
        statusHistory,
        previousClarificationsCount,
        updatedAt: timestamp
      });
    } catch (error) {
      console.error("Error requesting clarification:", error);
      throw error;
    }
  },

  /**
   * Fully suspends user account permissions
   */
  async suspendUser(uid: string): Promise<void> {
    try {
      const docRef = doc(db, USERS_COLLECTION, uid);
      await updateDoc(docRef, {
        status: "suspended",
        writerStatus: "inactive",
        isVerifiedWriter: false,
        availability: "suspended",
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error fully suspending user profile:", error);
      throw error;
    }
  },

  /**
   * Updates expert work availability status
   */
  async updateExpertAvailability(uid: string, availability: UserAvailability): Promise<void> {
    try {
      const docRef = doc(db, USERS_COLLECTION, uid);
      await updateDoc(docRef, {
        availability,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error updating expert availability:", error);
      throw error;
    }
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
  }
};
