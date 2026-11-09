/**
 * DataBoy In-App Notification Service
 *
 * Reads/writes the top-level `notifications` Firestore collection.
 * All real-time subscription is handled by useNotifications hook.
 */

import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { Notification, NotificationType } from "@/types/domain";

const COLLECTION = "notifications";

export const notificationService = {
  /**
   * Creates a notification for a single user.
   */
  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    relatedId?: string,
    relatedType?: Notification["relatedType"],
    relatedUrl?: string
  ): Promise<void> {
    try {
      const colRef = collection(db, COLLECTION);
      await addDoc(colRef, {
        userId,
        type,
        title,
        message,
        relatedId: relatedId ?? null,
        relatedType: relatedType ?? null,
        relatedUrl: relatedUrl ?? null,
        read: false,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      // Notification failures should not crash the caller
      console.error("[notificationService] Failed to create notification:", e);
    }
  },

  /**
   * Creates the same notification for multiple users at once (batch).
   */
  async createBulkNotifications(
    userIds: string[],
    type: NotificationType,
    title: string,
    message: string,
    relatedId?: string,
    relatedType?: Notification["relatedType"],
    relatedUrl?: string
  ): Promise<void> {
    if (!userIds.length) return;
    try {
      const batch = writeBatch(db);
      const colRef = collection(db, COLLECTION);
      const timestamp = new Date().toISOString();
      for (const userId of userIds) {
        const newRef = doc(colRef);
        batch.set(newRef, {
          userId,
          type,
          title,
          message,
          relatedId: relatedId ?? null,
          relatedType: relatedType ?? null,
          relatedUrl: relatedUrl ?? null,
          read: false,
          createdAt: timestamp,
        });
      }
      await batch.commit();
    } catch (e) {
      console.error("[notificationService] Failed to create bulk notifications:", e);
    }
  },

  /**
   * Fetches notifications for a user (descending by time, max 50).
   */
  async getUserNotifications(userId: string, maxItems = 50): Promise<Notification[]> {
    try {
      const q = query(
        collection(db, COLLECTION),
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        limit(maxItems)
      );
      const snap = await getDocs(q);
      const items: Notification[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Notification));
      return items;
    } catch (e) {
      console.error("[notificationService] Failed to fetch notifications:", e);
      return [];
    }
  },

  /**
   * Marks a single notification as read.
   */
  async markAsRead(notificationId: string): Promise<void> {
    try {
      const ref = doc(db, COLLECTION, notificationId);
      await updateDoc(ref, { read: true });
    } catch (e) {
      console.error("[notificationService] markAsRead failed:", e);
    }
  },

  /**
   * Marks all unread notifications for a user as read.
   */
  async markAllRead(userId: string): Promise<void> {
    try {
      const q = query(
        collection(db, COLLECTION),
        where("userId", "==", userId),
        where("read", "==", false)
      );
      const snap = await getDocs(q);
      if (snap.empty) return;
      const batch = writeBatch(db);
      snap.forEach((d) => batch.update(d.ref, { read: true }));
      await batch.commit();
    } catch (e) {
      console.error("[notificationService] markAllRead failed:", e);
    }
  },

  // ---------------------------------------------------------------------------
  // DOMAIN-SPECIFIC NOTIFICATION HELPERS
  // ---------------------------------------------------------------------------

  async notifyAssignmentCreated(
    customerId: string,
    adminIds: string[],
    projectId: string,
    title: string
  ) {
    const url = `/projects/detail?id=${projectId}`;
    await this.createNotification(
      customerId,
      "assignment_created",
      "Assignment Created",
      `Your assignment "${title}" has been created and is awaiting payment.`,
      projectId,
      "assignment",
      url
    );
    await this.createBulkNotifications(
      adminIds,
      "assignment_created",
      "New Assignment Submitted",
      `Student submitted a new assignment: "${title}". Awaiting escrow funding.`,
      projectId,
      "assignment",
      `/admin?tab=assignments`
    );
  },

  async notifyEscrowFunded(
    customerId: string,
    adminIds: string[],
    projectId: string,
    title: string,
    amount: number
  ) {
    const url = `/projects/detail?id=${projectId}`;
    await this.createNotification(
      customerId,
      "assignment_funded",
      "Escrow Funded ✓",
      `K${amount.toFixed(2)} has been secured in test escrow for "${title}". Writer matching is underway.`,
      projectId,
      "assignment",
      url
    );
    await this.createBulkNotifications(
      adminIds,
      "assignment_funded",
      "Escrow Funded — Assignment Ready",
      `Assignment "${title}" (${projectId}) has been funded. Ready for writer allocation.`,
      projectId,
      "assignment",
      `/admin?tab=assignments`
    );
  },

  async notifyWriterOffered(
    writerId: string,
    projectId: string,
    title: string,
    expiresInMinutes: number
  ) {
    await this.createNotification(
      writerId,
      "assignment_offered",
      "New Assignment Available",
      `You have been matched to "${title}". Accept within ${expiresInMinutes} minutes to claim it.`,
      projectId,
      "assignment",
      `/projects/detail?id=${projectId}`
    );
  },

  async notifyWriterTimeout(
    adminIds: string[],
    projectId: string,
    title: string,
    attempt: number
  ) {
    await this.createBulkNotifications(
      adminIds,
      "writer_timeout",
      "Writer Offer Timed Out",
      `Offer for "${title}" (attempt #${attempt}) expired. Escalating to next writer.`,
      projectId,
      "assignment",
      `/admin?tab=assignments`
    );
  },

  async notifyPoolOpened(
    writerIds: string[],
    projectId: string,
    title: string
  ) {
    await this.createBulkNotifications(
      writerIds,
      "pool_opened",
      "Assignment Available in Pool",
      `"${title}" is now open for first-come-first-serve claiming. Tap to view.`,
      projectId,
      "assignment",
      `/projects/detail?id=${projectId}`
    );
  },

  async notifyDraftSubmitted(
    customerId: string,
    adminIds: string[],
    projectId: string,
    title: string
  ) {
    const url = `/projects/detail?id=${projectId}`;
    await this.createNotification(
      customerId,
      "draft_submitted",
      "Draft Submitted for Review",
      `Your writer has submitted a draft for "${title}". A quality reviewer will audit it now.`,
      projectId,
      "assignment",
      url
    );
    await this.createBulkNotifications(
      adminIds,
      "draft_submitted",
      "Draft Submitted",
      `Draft ready for review: "${title}" (${projectId}).`,
      projectId,
      "assignment",
      `/admin?tab=assignments`
    );
  },

  async notifyRevisionRequested(
    writerId: string,
    projectId: string,
    title: string
  ) {
    await this.createNotification(
      writerId,
      "revision_requested",
      "Revision Requested",
      `Changes have been requested on "${title}". Please review and resubmit.`,
      projectId,
      "assignment",
      `/projects/detail?id=${projectId}`
    );
  },

  async notifyCompleted(
    customerId: string,
    writerId: string,
    projectId: string,
    title: string
  ) {
    const url = `/projects/detail?id=${projectId}`;
    await this.createNotification(
      customerId,
      "assignment_completed",
      "Assignment Completed ✓",
      `"${title}" has been approved and completed. Your writer has been paid.`,
      projectId,
      "assignment",
      url
    );
    await this.createNotification(
      writerId,
      "assignment_completed",
      "Payment Released ✓",
      `Escrow payment for "${title}" has been released to your account.`,
      projectId,
      "assignment",
      url
    );
  },

  // ---------------------------------------------------------------------------
  // WRITER VERIFICATION WORKFLOW NOTIFICATIONS (Revision 12)
  // ---------------------------------------------------------------------------

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

  async notifyVerificationSubmitted(writerId: string, writerName: string) {
    const adminIds = await this.getAdminIds();
    await this.createBulkNotifications(
      adminIds,
      "system",
      "New Verification Submitted",
      `Writer "${writerName}" has submitted credentials for administrative review.`,
      writerId,
      "system",
      `/admin?tab=verifications`
    );
  },

  async notifyVerificationResubmitted(writerId: string, writerName: string) {
    const adminIds = await this.getAdminIds();
    await this.createBulkNotifications(
      adminIds,
      "system",
      "Verification Resubmitted",
      `Writer "${writerName}" has resubmitted credentials after clarification request.`,
      writerId,
      "system",
      `/admin?tab=verifications`
    );
  },

  async notifyVerificationClarificationRequested(writerId: string, message: string) {
    await this.createNotification(
      writerId,
      "system",
      "Clarification Requested ⚠️",
      `Administrative review requires clarification on your credentials: "${message}"`,
      writerId,
      "system",
      `/verification`
    );
  },

  async notifyVerificationApproved(writerId: string) {
    await this.createNotification(
      writerId,
      "system",
      "Account Approved 🎉",
      "Congratulations! Your academic writer account has been approved. You are now eligible to claim assignments.",
      writerId,
      "system",
      `/dashboard`
    );
  },

  async notifyVerificationRejected(writerId: string, reason: string) {
    await this.createNotification(
      writerId,
      "system",
      "Verification Rejected ❌",
      `Your academic credentials verification was rejected. Reason: "${reason}". Please update and resubmit.`,
      writerId,
      "system",
      `/verification`
    );
  },
};
