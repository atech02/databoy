import crypto from "crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { adminDb } from "../config/firebaseAdmin.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { RateLimiterBundle } from "../middleware/rateLimit.js";
import { logAuditEvent } from "../services/auditService.js";
import { getEmailProviderConfig } from "../services/notificationService.js";

const registerPushTokenSchema = z.object({
  token: z.string().min(10).max(4096),
  deviceLabel: z.string().max(120).optional(),
  platform: z.string().max(80).optional(),
  userAgent: z.string().max(500).optional(),
});

const unregisterPushTokenSchema = z.object({
  token: z.string().min(10).max(4096).optional(),
  unregisterAll: z.boolean().optional(),
});

const updatePreferencesSchema = z.object({
  notifications: z
    .object({
      inApp: z.boolean().optional(),
      email: z.boolean().optional(),
      push: z.boolean().optional(),
    })
    .optional(),
  inAppNotifications: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
});

function resolveStoredNotifPrefs(prefs: any): { inApp: boolean; email: boolean; push: boolean } {
  const nested = prefs?.notifications || {};
  return {
    inApp: nested.inApp !== undefined ? nested.inApp !== false : prefs?.inAppNotifications !== false,
    email: nested.email !== undefined ? nested.email !== false : prefs?.emailNotifications !== false,
    push: nested.push !== undefined ? nested.push === true : prefs?.pushNotifications === true,
  };
}

function buildTokenDocId(uid: string, token: string): string {
  const hash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
  return `${uid}_${hash}`;
}

export function createNotificationRouter(_limiters?: RateLimiterBundle): Router {
  const router = Router();

  router.use(authMiddleware);

  /**
   * GET /api/notifications/status
   * Returns current user's notification preferences, registered push devices count,
   * and backend email provider configuration status (never fakes delivery configuration).
   */
  router.get("/status", async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const [userSnap, tokensSnap] = await Promise.all([
        adminDb.collection("users").doc(user.uid).get(),
        adminDb
          .collection("userDeviceTokens")
          .where("userId", "==", user.uid)
          .where("enabled", "==", true)
          .get(),
      ]);

      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const resolved = resolveStoredNotifPrefs(userData.preferences || {});
      const emailConfig = getEmailProviderConfig();

      const devices = tokensSnap.docs.map((d) => {
        const data = d.data();
        return {
          deviceId: d.id,
          deviceLabel: data.deviceLabel || "Web Browser",
          platform: data.platform || "Web",
          updatedAt: data.updatedAt || data.createdAt,
        };
      });

      res.status(200).json({
        preferences: {
          notifications: resolved,
          inAppNotifications: resolved.inApp,
          emailNotifications: resolved.email,
          pushNotifications: resolved.push,
        },
        emailDelivery: {
          configured: emailConfig.configured,
          provider: emailConfig.provider,
          missingVars: emailConfig.missingVars,
          recipientEmail: user.email,
        },
        pushDevices: {
          count: devices.length,
          devices,
        },
      });
    } catch (err: any) {
      console.error("[NotificationRoutes] Status error:", err);
      res.status(500).json({ error: "Failed to load notification configuration status" });
    }
  });

  /**
   * POST /api/notifications/preferences
   * Updates user's primary notification preferences (In-App, Email, Push).
   * Essential security messages (e.g. password reset) cannot be disabled.
   */
  router.post("/preferences", async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = updatePreferencesSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid preferences payload", details: parsed.error.format() });
        return;
      }

      const user = req.user!;
      const userRef = adminDb.collection("users").doc(user.uid);
      const snap = await userRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }

      const currentPrefs = snap.data()?.preferences || {};
      const currentResolved = resolveStoredNotifPrefs(currentPrefs);
      const nextInApp =
        parsed.data.notifications?.inApp ?? parsed.data.inAppNotifications ?? currentResolved.inApp;
      const nextEmail =
        parsed.data.notifications?.email ?? parsed.data.emailNotifications ?? currentResolved.email;
      const nextPush =
        parsed.data.notifications?.push ?? parsed.data.pushNotifications ?? currentResolved.push;

      const updatedPrefs = {
        ...currentPrefs,
        notifications: {
          inApp: nextInApp,
          email: nextEmail,
          push: nextPush,
        },
        inAppNotifications: nextInApp,
        emailNotifications: nextEmail,
        pushNotifications: nextPush,
      };

      const now = new Date().toISOString();
      await userRef.update({
        preferences: updatedPrefs,
        updatedAt: now,
      });

      await logAuditEvent({
        action: "notification_preferences_updated",
        actorId: user.uid,
        actorRole: user.role,
        targetId: user.uid,
        details: updatedPrefs.notifications,
        ip: req.ip as string | undefined,
      });

      res.status(200).json({
        success: true,
        preferences: {
          notifications: updatedPrefs.notifications,
          inAppNotifications: nextInApp,
          emailNotifications: nextEmail,
          pushNotifications: nextPush,
        },
      });
    } catch (err: any) {
      console.error("[NotificationRoutes] Preferences update error:", err);
      res.status(500).json({ error: "Failed to update notification preferences" });
    }
  });

  /**
   * POST /api/notifications/push-tokens
   * Registers or refreshes an FCM Web Push token for the authenticated user.
   * Supports multiple devices per user.
   */
  router.post("/push-tokens", async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = registerPushTokenSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid push token payload", details: parsed.error.format() });
        return;
      }

      const user = req.user!;
      const { token, deviceLabel, platform, userAgent } = parsed.data;
      const docId = buildTokenDocId(user.uid, token.trim());
      const now = new Date().toISOString();

      await adminDb.collection("userDeviceTokens").doc(docId).set(
        {
          id: docId,
          userId: user.uid,
          userEmail: user.email || "",
          token: token.trim(),
          deviceLabel: deviceLabel || "Web Browser",
          platform: platform || "Web",
          userAgent: userAgent ? userAgent.slice(0, 300) : null,
          enabled: true,
          updatedAt: now,
          createdAt: now,
        },
        { merge: true }
      );

      // Ensure pushNotifications preference is marked enabled on user profile
      const userRef = adminDb.collection("users").doc(user.uid);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        const currentPrefs = userSnap.data()?.preferences || {};
        const currentResolved = resolveStoredNotifPrefs(currentPrefs);
        await userRef.update({
          preferences: {
            ...currentPrefs,
            notifications: {
              ...currentResolved,
              push: true,
            },
            pushNotifications: true,
          },
          updatedAt: now,
        });
      }

      await logAuditEvent({
        action: "push_device_registered",
        actorId: user.uid,
        actorRole: user.role,
        targetId: docId,
        details: { platform: platform || "Web", deviceLabel: deviceLabel || "Web Browser" },
        ip: req.ip as string | undefined,
      });

      res.status(200).json({
        success: true,
        deviceId: docId,
        message: "Push notification device registered",
      });
    } catch (err: any) {
      console.error("[NotificationRoutes] Push token register error:", err);
      res.status(500).json({ error: "Failed to register push token" });
    }
  });

  /**
   * DELETE /api/notifications/push-tokens
   * Unregisters a specific FCM device token or all devices for the authenticated user.
   */
  router.delete("/push-tokens", async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = unregisterPushTokenSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid unregister payload", details: parsed.error.format() });
        return;
      }

      const user = req.user!;
      const queryToken = typeof req.query?.token === "string" ? req.query.token : undefined;
      const queryUnregisterAll = req.query?.unregisterAll === "true";
      const token = parsed.data.token || queryToken;
      const unregisterAll = parsed.data.unregisterAll ?? queryUnregisterAll;
      const now = new Date().toISOString();

      let removedCount = 0;

      if (token && !unregisterAll) {
        const docId = buildTokenDocId(user.uid, token.trim());
        const ref = adminDb.collection("userDeviceTokens").doc(docId);
        const snap = await ref.get();
        if (snap.exists && snap.data()?.userId === user.uid) {
          await ref.delete();
          removedCount = 1;
        }
      } else {
        const snap = await adminDb
          .collection("userDeviceTokens")
          .where("userId", "==", user.uid)
          .get();
        const batch = adminDb.batch();
        snap.docs.forEach((d) => {
          batch.delete(d.ref);
          removedCount++;
        });
        if (!snap.empty) {
          await batch.commit();
        }
      }

      // Check remaining active devices
      const remainingSnap = await adminDb
        .collection("userDeviceTokens")
        .where("userId", "==", user.uid)
        .where("enabled", "==", true)
        .get();

      if (remainingSnap.empty || unregisterAll) {
        const userRef = adminDb.collection("users").doc(user.uid);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const currentPrefs = userSnap.data()?.preferences || {};
          const currentResolved = resolveStoredNotifPrefs(currentPrefs);
          await userRef.update({
            preferences: {
              ...currentPrefs,
              notifications: {
                ...currentResolved,
                push: false,
              },
              pushNotifications: false,
            },
            updatedAt: now,
          });
        }
      }

      await logAuditEvent({
        action: "push_device_unregistered",
        actorId: user.uid,
        actorRole: user.role,
        targetId: user.uid,
        details: { removedCount, unregisterAll: Boolean(unregisterAll) },
        ip: req.ip as string | undefined,
      });

      res.status(200).json({
        success: true,
        removedCount,
        remainingDevices: remainingSnap.size,
      });
    } catch (err: any) {
      console.error("[NotificationRoutes] Push token unregister error:", err);
      res.status(500).json({ error: "Failed to unregister push token" });
    }
  });

  /**
   * POST /api/notifications/push-tokens/unregister
   * Alternative POST unregister endpoint for environments where proxies strip DELETE bodies.
   */
  router.post("/push-tokens/unregister", async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = unregisterPushTokenSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid unregister payload", details: parsed.error.format() });
        return;
      }

      const user = req.user!;
      const { token, unregisterAll } = parsed.data;
      const now = new Date().toISOString();

      let removedCount = 0;

      if (token && !unregisterAll) {
        const docId = buildTokenDocId(user.uid, token.trim());
        const ref = adminDb.collection("userDeviceTokens").doc(docId);
        const snap = await ref.get();
        if (snap.exists && snap.data()?.userId === user.uid) {
          await ref.delete();
          removedCount = 1;
        }
      } else {
        const snap = await adminDb
          .collection("userDeviceTokens")
          .where("userId", "==", user.uid)
          .get();
        const batch = adminDb.batch();
        snap.docs.forEach((d) => {
          batch.delete(d.ref);
          removedCount++;
        });
        if (!snap.empty) {
          await batch.commit();
        }
      }

      const remainingSnap = await adminDb
        .collection("userDeviceTokens")
        .where("userId", "==", user.uid)
        .where("enabled", "==", true)
        .get();

      if (remainingSnap.empty || unregisterAll) {
        const userRef = adminDb.collection("users").doc(user.uid);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const currentPrefs = userSnap.data()?.preferences || {};
          const currentResolved = resolveStoredNotifPrefs(currentPrefs);
          await userRef.update({
            preferences: {
              ...currentPrefs,
              notifications: {
                ...currentResolved,
                push: false,
              },
              pushNotifications: false,
            },
            updatedAt: now,
          });
        }
      }

      res.status(200).json({
        success: true,
        removedCount,
        remainingDevices: remainingSnap.size,
      });
    } catch (err: any) {
      console.error("[NotificationRoutes] Push token POST unregister error:", err);
      res.status(500).json({ error: "Failed to unregister push token" });
    }
  });

  return router;
}

export default createNotificationRouter();
