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
  getDocs,
  collection,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { apiClient } from "@/services/apiClient";
import { Project, UserProfile } from "@/types/domain";

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
 * Check writer eligibility strictly based on conjunction logic and account status
 */
export const isWriterEligible = (writer: UserProfile): boolean => {
  return (
    writer.verificationStatus === "approved" &&
    writer.status !== "suspended" &&
    writer.performanceReviewStatus !== "suspended" &&
    writer.isVerifiedWriter === true &&
    writer.writerStatus !== "inactive"
  );
};

export const scoreWriterForProject = (project: Project, writer: UserProfile): number => {
  if (!isWriterEligible(writer)) {
    throw new Error(`Ineligible writer ${writer.uid} cannot be scored.`);
  }

  // STRICT SEPARATION OF DUTIES: Writer cannot proofread their own written assignment
  const isProofreadingTask =
    project.projectType?.toLowerCase().includes("proofread") ||
    project.serviceType?.toLowerCase().includes("proofread");
  if (isProofreadingTask && project.writerId && project.writerId === writer.uid) {
    return 0; // Disqualified due to separation of duties
  }

  let score = 0;
  score += 20; // Base verification bonus

  // 1. Subject match (up to 40 pts)
  const projectSubject = project.subject || "";
  const writerSpecs: string[] = writer.academic?.specializations || writer.metadata?.specializations || [];
  if (projectSubject && writerSpecs.includes(projectSubject)) {
    score += 40;
  } else if (projectSubject && writerSpecs.some(s => s.toLowerCase().includes(projectSubject.toLowerCase()))) {
    score += 20; // Partial match
  }

  // 2. Academic level match (up to 20 pts)
  const projectLevel = project.academicLevel || "degree";
  if (writer.academic?.yearOfStudy) {
    const isPostgrad = writer.academic.yearOfStudy === "postgraduate";
    if (isPostgrad) {
      score += 20;
    } else if (["high_school", "diploma", "degree"].includes(projectLevel)) {
      score += 12;
    }
  }

  // 3. Independent Role-Specific Performance Metric (Writing vs Proofreading)
  const activeRating = isProofreadingTask
    ? (writer.proofreadingRating ?? 0)
    : (writer.writingRating ?? writer.reputation ?? 0);

  if (activeRating > 0) {
    // Standard active rating: 1.0 to 5.0 scale (weighted x7 -> 7 to 35 pts)
    score += activeRating * 7;
  } else {
    // FAIR PROVISIONAL ALLOCATION: Unrated approved writers receive provisional normal baseline (3.5 * 7 = 24.5 pts)
    score += 24.5;
  }

  // 4. Dynamic Allocation Preference Tiers
  const preferenceTier = writer.allocationPreference || (
    activeRating >= 4.5 ? "highest" :
    activeRating >= 4.0 ? "high" :
    activeRating >= 3.0 ? "normal" :
    activeRating >= 2.0 ? "low" :
    activeRating > 0 ? "very_low" : "normal" // Unrated receives normal provisional preference
  );

  switch (preferenceTier) {
    case "highest":
      score += 35;
      break;
    case "high":
      score += 25;
      break;
    case "normal":
      score += 15;
      break;
    case "low":
      score -= 10;
      break;
    case "very_low":
      score -= 25;
      break;
    case "at_risk":
      score -= 50;
      break;
  }

  // 5. Completed Tasks Experience Bonus (up to 10 pts)
  const completed = isProofreadingTask
    ? (writer.proofreadingCompletedTasks ?? 0)
    : (writer.writingCompletedTasks ?? writer.completedCount ?? 0);
  score += Math.min(completed, 10);

  // 6. At-risk status penalty
  if (writer.performanceReviewStatus === "at_risk") {
    score -= 40;
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
   * Offer a project to a specific writer via backend admin allocation endpoint.
   */
  async offerProjectToWriter(
    project: Project,
    writerId: string,
    _adminProfile: UserProfile
  ): Promise<void> {
    await apiClient.post(`/api/assignments/${project.id}/allocate`, {
      mode: "offer",
      candidateWriterId: writerId,
    });
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

    // Timeout occurred — escalate via backend admin allocation endpoint
    const attempts = project.allocationAttempts || 1;

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
   * Move project to general pool via backend admin allocation endpoint.
   */
  async moveToPool(
    project: Project,
    _adminProfile: UserProfile,
    _eligibleWriterIds: string[]
  ): Promise<void> {
    await apiClient.post(`/api/assignments/${project.id}/allocate`, {
      mode: "open_pool",
    });
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
