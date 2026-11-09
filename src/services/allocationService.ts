/**
 * DataBoy Writer Allocation Engine — V1
 *
 * Ranked, rule-based writer assignment with timeout escalation.
 * No AI. No random selection. Deterministic score-based matching.
 *
 * Allocation flow:
 *   1. Rank all verified writers by subject match + level + rating + workload
 *   2. Offer to top-ranked writer with a timeout window
 *   3. On timeout: increment attempt, offer to next
 *   4. After MAX_ATTEMPTS: move to general pool (first-come-first-serve)
 */

import {
  doc,
  updateDoc,
  getDocs,
  collection,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { Project, UserProfile } from "@/types/domain";
import { notificationService } from "./notificationService";
import { adminService } from "./adminService";

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

const MAX_ALLOCATION_ATTEMPTS = 3;
const OFFER_TIMEOUT_MINUTES = 5;
const OFFER_TIMEOUT_MS = OFFER_TIMEOUT_MINUTES * 60 * 1000;

// ---------------------------------------------------------------------------
// SCORING
// ---------------------------------------------------------------------------

/**
 * Score a writer against a project.
 * Higher = better match.
 *
 * Scoring breakdown:
 *   Subject match:    40 pts
 *   Academic level:   20 pts
 *   Rating (×10):     0–50 pts
 *   Verification:     20 pts
 *   Workload penalty: -10 per active task (max -30)
 *   Reputation:       0–10 pts
 */
/**
 * Check writer eligibility strictly based on conjunction logic (Issue 2)
 */
export const isWriterEligible = (writer: UserProfile): boolean => {
  return (
    writer.verificationStatus === "approved" &&
    writer.writerStatus === "active" &&
    writer.isVerifiedWriter === true
  );
};

export const scoreWriterForProject = (project: Project, writer: UserProfile): number => {
  if (!isWriterEligible(writer)) {
    throw new Error(`Ineligible writer ${writer.uid} cannot be scored.`);
  }

  let score = 0;
  score += 20; // Verification bonus

  // Subject match
  const projectSubject = project.subject || "";
  const writerSpecs: string[] = writer.academic?.specializations || writer.metadata?.specializations || [];
  if (projectSubject && writerSpecs.includes(projectSubject)) {
    score += 40;
  } else if (projectSubject && writerSpecs.some(s => s.toLowerCase().includes(projectSubject.toLowerCase()))) {
    score += 20; // Partial match
  }

  // Academic level match
  const projectLevel = project.academicLevel || "degree";
  if (writer.academic?.yearOfStudy) {
    // Postgraduate writers can handle all levels; undergraduate match their level
    const isPostgrad = writer.academic.yearOfStudy === "postgraduate";
    if (isPostgrad) {
      score += 20;
    } else if (["high_school", "diploma", "degree"].includes(projectLevel)) {
      score += 12;
    }
  }

  // Rating (1–5 scale, weight ×10)
  score += (writer.reputation || 3) * 10;

  // Reputation (completed tasks, capped at 10)
  score += Math.min(writer.completedCount || 0, 10);

  // Workload penalty (we'd need active task count — use reputation heuristic for V1)
  // In V1, we penalize lower reputation as a proxy for busyness
  if ((writer.reputation || 0) < 2) {
    score -= 15;
  }

  return Math.max(0, score);
};

// ---------------------------------------------------------------------------
// MAIN ALLOCATION ENGINE
// ---------------------------------------------------------------------------

export const allocationService = {
  /**
   * Rank all verified writers for a project, returning ordered list.
   */
  async rankWritersForProject(project: Project): Promise<(UserProfile & { _score: number })[]> {
    const colRef = collection(db, "users");
    const q = query(colRef, where("role", "==", "writer"));
    const snap = await getDocs(q);
    const writers: (UserProfile & { _score: number })[] = [];

    snap.forEach((d) => {
      const writer = { uid: d.id, ...d.data() } as UserProfile;
      if (isWriterEligible(writer)) {
        const score = scoreWriterForProject(project, writer);
        writers.push({ ...writer, _score: score });
      }
    });

    writers.sort((a, b) => b._score - a._score);
    return writers;
  },

  /**
   * Offer a project to a specific writer with a timeout.
   * Updates the project document with offer metadata.
   */
  async offerProjectToWriter(
    project: Project,
    writerId: string,
    adminProfile: UserProfile
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_MS).toISOString();
    const projRef = doc(db, "assignments", project.id);

    await updateDoc(projRef, {
      allocationStatus: "offered",
      currentOfferWriterId: writerId,
      offerExpiresAt: expiresAt,
      allocationAttempts: (project.allocationAttempts || 0) + 1,
      updatedAt: new Date().toISOString(),
    });

    // Notify the writer
    await notificationService.notifyWriterOffered(
      writerId,
      project.id,
      project.title,
      OFFER_TIMEOUT_MINUTES
    );

    // Log the allocation offer in platform audit
    await adminService.logPlatformAudit(
      adminProfile,
      "WRITER_OFFERED",
      project.id,
      "assignment",
      `Writer [${writerId}] offered assignment "${project.title}" (attempt #${(project.allocationAttempts || 0) + 1}). Expires: ${expiresAt}`
    );
  },

  /**
   * Trigger the initial allocation for a funded assignment.
   * Ranks writers and sends the first offer.
   */
  async triggerAllocation(project: Project, adminProfile: UserProfile): Promise<{
    offered: boolean;
    writerId?: string;
    message: string;
  }> {
    const rankedWriters = await this.rankWritersForProject(project);

    if (rankedWriters.length === 0) {
      // No eligible writers — move directly to pool
      await this.moveToPool(project, adminProfile, []);
      return { offered: false, message: "No eligible writers found. Assignment moved to general pool." };
    }

    // Find first writer not already attempted
    const attempted = new Set<string>(); // In V1, no attempt history stored; fresh allocation
    const nextWriter = rankedWriters.find(w => !attempted.has(w.uid));

    if (!nextWriter) {
      await this.moveToPool(project, adminProfile, rankedWriters.map(w => w.uid));
      return { offered: false, message: "All ranked writers attempted. Assignment moved to general pool." };
    }

    await this.offerProjectToWriter(project, nextWriter.uid, adminProfile);
    return { offered: true, writerId: nextWriter.uid, message: `Offer sent to writer [${nextWriter.uid}]` };
  },

  /**
   * Checks if a project's offer has timed out and escalates.
   * Call this from an admin action (V1 manual trigger; V2 Cloud Function).
   */
  async checkAndEscalateTimeout(
    project: Project,
    adminProfile: UserProfile
  ): Promise<{ escalated: boolean; movedToPool: boolean; message: string }> {
    // Not in offered state
    if (project.allocationStatus !== "offered") {
      return { escalated: false, movedToPool: false, message: "Project is not in 'offered' state." };
    }

    // Check if offer has expired
    const now = Date.now();
    const expiresAt = project.offerExpiresAt ? new Date(project.offerExpiresAt).getTime() : 0;
    if (now < expiresAt) {
      const remaining = Math.ceil((expiresAt - now) / 1000 / 60);
      return { escalated: false, movedToPool: false, message: `Offer still active. ${remaining} minutes remaining.` };
    }

    // Timeout occurred — notify admins
    const attempts = project.allocationAttempts || 1;
    const adminIds = await this.getAdminIds();
    await notificationService.notifyWriterTimeout(adminIds, project.id, project.title, attempts);
    await adminService.logPlatformAudit(
      adminProfile,
      "WRITER_TIMEOUT",
      project.id,
      "assignment",
      `Writer offer timed out for "${project.title}" (attempt #${attempts}).`
    );

    // Check if we should try next writer or move to pool
    if (attempts >= MAX_ALLOCATION_ATTEMPTS) {
      const rankedWriters = await this.rankWritersForProject(project);
      await this.moveToPool(project, adminProfile, rankedWriters.map(w => w.uid));
      return { escalated: false, movedToPool: true, message: `Max attempts (${MAX_ALLOCATION_ATTEMPTS}) reached. Assignment moved to general pool.` };
    }

    // Try next best writer
    const rankedWriters = await this.rankWritersForProject(project);
    // Skip the writer who just timed out
    const nextWriter = rankedWriters.find(w => w.uid !== project.currentOfferWriterId);
    if (!nextWriter) {
      await this.moveToPool(project, adminProfile, rankedWriters.map(w => w.uid));
      return { escalated: false, movedToPool: true, message: "No next writer available. Assignment moved to general pool." };
    }

    await this.offerProjectToWriter(project, nextWriter.uid, adminProfile);
    return { escalated: true, movedToPool: false, message: `Offer escalated to writer [${nextWriter.uid}]` };
  },

  /**
   * Move project to general pool — first-come-first-serve among eligible writers.
   */
  async moveToPool(
    project: Project,
    adminProfile: UserProfile,
    eligibleWriterIds: string[]
  ): Promise<void> {
    const projRef = doc(db, "assignments", project.id);
    await updateDoc(projRef, {
      allocationStatus: "pool",
      currentOfferWriterId: null,
      offerExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });

    // Notify eligible writers
    if (eligibleWriterIds.length > 0) {
      await notificationService.notifyPoolOpened(eligibleWriterIds, project.id, project.title);
    }

    await adminService.logPlatformAudit(
      adminProfile,
      "ASSIGNMENT_POOL_OPENED",
      project.id,
      "assignment",
      `Assignment "${project.title}" moved to general pool after ${project.allocationAttempts || 0} allocation attempt(s).`
    );
  },

  /** Helper: get all admin UIDs */
  async getAdminIds(): Promise<string[]> {
    try {
      const q = query(collection(db, "users"), where("role", "==", "admin"));
      const snap = await getDocs(q);
      const ids: string[] = [];
      snap.forEach(d => ids.push(d.id));
      return ids;
    } catch {
      return [];
    }
  },
};
