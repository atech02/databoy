/**
 * DataBoy In-App Notification Service
 *
 * Reads/writes the top-level `notifications` Firestore collection.
 * All real-time subscription is handled by useNotifications hook.
 */

import {
  collection,
  getDocs,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";
import { db, messaging } from "@/config/firebase";
import { Notification, NotificationType } from "@/types/domain";
import { apiClient } from "./apiClient";

const COLLECTION = "notifications";
const PUSH_TOKEN_STORAGE_KEY = "databoy_fcm_push_token";

export interface NotificationConfigStatus {
  preferences: {
    inAppNotifications: boolean;
    emailNotifications: boolean;
    pushNotifications: boolean;
  };
  emailDelivery: {
    configured: boolean;
    provider: string;
    missingVars: string[];
    recipientEmail: string;
  };
  pushDevices: {
    count: number;
    devices: Array<{
      deviceId: string;
      deviceLabel: string;
      platform: string;
      updatedAt: string;
    }>;
  };
}

import {
  executePushRegistration,
  PushRegistrationState,
  PushEnableResult,
  PushEnableDependencies,
} from "@/utils/pushRegistration";

export type { PushRegistrationState, PushEnableResult, PushEnableDependencies };
export { executePushRegistration };

export const notificationService = {
  /**
   * Fetches backend notification configuration, preferences, and registered push devices.
   */
  async getNotificationStatus(): Promise<NotificationConfigStatus> {
    return apiClient.get<NotificationConfigStatus>("/api/notifications/status");
  },

  /**
   * Updates user notification preferences via backend API.
   */
  async updatePreferences(prefs: {
    inAppNotifications?: boolean;
    emailNotifications?: boolean;
    pushNotifications?: boolean;
  }): Promise<{
    success: boolean;
    preferences: {
      inAppNotifications: boolean;
      emailNotifications: boolean;
      pushNotifications: boolean;
    };
  }> {
    return apiClient.post("/api/notifications/preferences", prefs);
  },

  /**
   * Checks whether the current browser/device supports Web Push / FCM notifications.
   */
  isBrowserPushSupported(): {
    supported: boolean;
    permission: NotificationPermission | "unsupported";
    isIosWithoutStandalone: boolean;
    reason?: string;
  } {
    if (typeof window === "undefined") {
      return { supported: false, permission: "unsupported", isIosWithoutStandalone: false };
    }

    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return {
        supported: false,
        permission: "unsupported",
        isIosWithoutStandalone: isIos && !isStandalone,
        reason:
          isIos && !isStandalone
            ? "On iOS/iPadOS, add DataBoy to your Home Screen first to enable Web Push notifications."
            : "This browser does not support Web Push notifications. In-app notifications will continue working automatically.",
      };
    }

    return {
      supported: true,
      permission: window.Notification.permission,
      isIosWithoutStandalone: isIos && !isStandalone,
    };
  },

  /**
   * Returns current Web Push configuration & browser readiness state without requesting permission.
   */
  getPushReadinessState(isCurrentlyEnabled = false): {
    state: PushRegistrationState | "ready";
    vapidConfigured: boolean;
    reason?: string;
  } {
    const support = this.isBrowserPushSupported();
    if (!support.supported) {
      return { state: "unsupported", vapidConfigured: false, reason: support.reason };
    }
    const vapidKey = (process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "").trim();
    const vapidConfigured = vapidKey.length >= 20;
    if (!vapidConfigured) {
      return {
        state: "configuration_missing",
        vapidConfigured: false,
        reason: "Web Push VAPID public key is not configured for this build. In-app notifications continue working.",
      };
    }
    if (support.permission === "denied") {
      return {
        state: "permission_denied",
        vapidConfigured: true,
        reason: "Browser notification permission is denied. Allow notifications in site settings to enable push alerts.",
      };
    }
    if (isCurrentlyEnabled) {
      return { state: "enabled", vapidConfigured: true };
    }
    return { state: "ready", vapidConfigured: true };
  },

  /**
   * Requests browser notification permission, obtains a genuine FCM device token via getToken(),
   * and registers it with the backend for the authenticated user.
   * Never fabricates synthetic tokens if VAPID is missing or Firebase getToken() fails.
   */
  async enablePushNotifications(): Promise<PushEnableResult> {
    return executePushRegistration({
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      checkSupport: () => this.isBrowserPushSupported(),
      requestPermission: () => window.Notification.requestPermission(),
      getServiceWorkerRegistration: async () => {
        const existing = await navigator.serviceWorker.getRegistration("/sw.js");
        if (existing) return existing;
        return navigator.serviceWorker.register("/sw.js");
      },
      acquireFcmToken: async (swReg, vapidKey) => {
        if (!messaging) {
          throw new Error("Firebase Cloud Messaging is not supported or initialized in this browser.");
        }
        const { getToken } = await import("firebase/messaging");
        return getToken(messaging, {
          serviceWorkerRegistration: swReg,
          vapidKey,
        });
      },
      registerTokenWithBackend: (payload) =>
        apiClient.post<{ success: boolean; deviceId: string }>("/api/notifications/push-tokens", payload),
      saveLocalToken: (token) => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
        }
      },
      userAgent: typeof window !== "undefined" ? window.navigator.userAgent : "",
      hostname: typeof window !== "undefined" ? window.location.hostname : "databoy",
    });
  },

  /**
   * Disables push notifications and unregisters the current device (or all devices) from the backend.
   */
  async disablePushNotifications(unregisterAll = false): Promise<void> {
    let localToken: string | null = null;
    if (typeof window !== "undefined") {
      localToken = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
      if (messaging && localToken) {
        try {
          const { deleteToken } = await import("firebase/messaging");
          await deleteToken(messaging);
        } catch {
          // Best-effort client token revocation
        }
      }
      window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    }

    await apiClient.post("/api/notifications/preferences", { pushNotifications: false });
    await apiClient.post("/api/notifications/push-tokens/unregister", {
      ...(localToken ? { token: localToken } : {}),
      unregisterAll,
    });
  },
  /**
   * Notifications are issued authoritatively by backend services.
   * Client code no longer writes directly to `notifications`.
   */
  async createNotification(
    _userId: string,
    _type: NotificationType,
    _title: string,
    _message: string,
    _relatedId?: string,
    _relatedType?: Notification["relatedType"],
    _relatedUrl?: string
  ): Promise<void> {
    return;
  },

  async createBulkNotifications(
    _userIds: string[],
    _type: NotificationType,
    _title: string,
    _message: string,
    _relatedId?: string,
    _relatedType?: Notification["relatedType"],
    _relatedUrl?: string
  ): Promise<void> {
    return;
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
