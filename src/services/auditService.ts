import { collection, addDoc, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/config/firebase";
import { 
  ProjectActivity, 
  UserProfile, 
  ProjectStatus, 
  ActivityType 
} from "@/types/domain";
import { validateActivity } from "@/utils/validation";

const PROJECTS_COLLECTION = "assignments"; // Must be 'assignments' to respect firestore.rules
const ACTIVITY_SUBCOLLECTION = "activity";  // Must be 'activity' to respect firestore.rules

export const auditService = {
  /**
   * Fetches all activity timeline events for a project, ordered chronologically
   */
  async getProjectActivity(projectId: string): Promise<ProjectActivity[]> {
    try {
      const colRef = collection(db, PROJECTS_COLLECTION, projectId, ACTIVITY_SUBCOLLECTION);
      const q = query(colRef, orderBy("createdAt", "desc"));
      const querySnap = await getDocs(q);

      const activities: ProjectActivity[] = [];
      querySnap.forEach((doc) => {
        activities.push({
          id: doc.id,
          ...doc.data()
        } as ProjectActivity);
      });

      return activities;
    } catch (error) {
      console.error("Error fetching project activity:", error);
      throw error;
    }
  },

  /**
   * Base logger helper
   */
  async logActivity(projectId: string, activity: Omit<ProjectActivity, "id" | "createdAt">): Promise<ProjectActivity> {
    const newActivity: ProjectActivity = {
      id: "", // Filled by Firestore doc
      ...activity,
      createdAt: new Date().toISOString()
    };

    const errors = validateActivity(newActivity);
    if (errors.length > 0) {
      throw new Error(`Activity logger validation failed: ${errors.join(" | ")}`);
    }

    try {
      const colRef = collection(db, PROJECTS_COLLECTION, projectId, ACTIVITY_SUBCOLLECTION);
      const docRef = await addDoc(colRef, {
        type: newActivity.type,
        actorId: newActivity.actorId,
        actorName: newActivity.actorName,
        actorRole: newActivity.actorRole,
        message: newActivity.message,
        metadata: newActivity.metadata || {},
        createdAt: newActivity.createdAt
      });
      newActivity.id = docRef.id;
      return newActivity;
    } catch (error) {
      console.error("Error committing activity audit log:", error);
      throw error;
    }
  },

  /**
   * Logs a pipeline status change
   */
  async logStatusChange(
    projectId: string, 
    actor: UserProfile, 
    prevStatus: ProjectStatus, 
    nextStatus: ProjectStatus
  ): Promise<ProjectActivity> {
    return this.logActivity(projectId, {
      type: "status_change",
      actorId: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      message: `Status shifted from [${prevStatus}] to [${nextStatus}]`,
      metadata: {
        prevStatus,
        nextStatus
      }
    });
  },

  /**
   * Logs a comment collaboration
   */
  async logComment(projectId: string, actor: UserProfile, comment: string): Promise<ProjectActivity> {
    return this.logActivity(projectId, {
      type: "comment",
      actorId: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      message: comment
    });
  },

  /**
   * Logs a guideline draft upload
   */
  async logFileUpload(projectId: string, actor: UserProfile, fileName: string, fileUrl: string): Promise<ProjectActivity> {
    return this.logActivity(projectId, {
      type: "file_upload",
      actorId: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      message: `Uploaded new asset: ${fileName}`,
      metadata: {
        fileName,
        fileUrl
      }
    });
  }
};
