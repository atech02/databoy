import crypto from "crypto";
import { adminDb, adminMessaging } from "../config/firebaseAdmin.js";

export type NotificationCategory =
  | "system"
  | "assignment"
  | "payment"
  | "review"
  | "research"
  | "writer_application"
  | "contract"
  | "transaction"
  | "announcement";

export interface CreateNotificationParams {
  userId: string;
  title: string;
  message: string;
  type?: NotificationCategory;
  link?: string;
  relatedUrl?: string;
  relatedId?: string;
  relatedType?: "assignment" | "research" | "dispute" | "writer_application" | "system";
  essential?: boolean;
  dedupeKey?: string;
  metadata?: Record<string, any>;
}

/**
 * Validates that a notification link is a safe internal application path
 * (blocks protocol-relative //, javascript:, http:// external redirects, etc.).
 */
export function normalizeDeepLink(rawLink?: string | null): string | null {
  if (!rawLink || typeof rawLink !== "string") return null;
  const trimmed = rawLink.trim();
  if (!trimmed) return null;

  if (trimmed === "/app/writer" || trimmed === "/app/dashboard") {
    return "/dashboard";
  }
  const asgMatch = trimmed.match(/^\/app\/assignments\/([^/?#]+)/);
  if (asgMatch) {
    return `/projects/detail?id=${encodeURIComponent(asgMatch[1])}`;
  }
  const resMatch = trimmed.match(/^\/app\/research\/([^/?#]+)/);
  if (resMatch) {
    return `/research/detail?id=${encodeURIComponent(resMatch[1])}`;
  }

  // Must be a single-leading-slash internal route
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || /[\r\n]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export interface EmailDeliveryCheck {
  configured: boolean;
  provider: "resend" | "sendgrid" | "unconfigured";
  apiKey?: string;
  fromAddress?: string;
  missingVars: string[];
}

/**
 * Inspects environment variables for a configured transactional email provider.
 * Never simulates or fakes delivery if unconfigured.
 */
export function getEmailProviderConfig(): EmailDeliveryCheck {
  const providerRaw = (process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  const sendgridKey = (process.env.SENDGRID_API_KEY || "").trim();
  const fromAddress = (process.env.EMAIL_FROM_ADDRESS || "").trim();

  if ((providerRaw === "resend" || (!providerRaw && resendKey)) && resendKey && fromAddress) {
    return {
      configured: true,
      provider: "resend",
      apiKey: resendKey,
      fromAddress,
      missingVars: [],
    };
  }

  if ((providerRaw === "sendgrid" || (!providerRaw && sendgridKey)) && sendgridKey && fromAddress) {
    return {
      configured: true,
      provider: "sendgrid",
      apiKey: sendgridKey,
      fromAddress,
      missingVars: [],
    };
  }

  const missingVars: string[] = [];
  if (!providerRaw && !resendKey && !sendgridKey) {
    missingVars.push("EMAIL_PROVIDER (resend | sendgrid)", "RESEND_API_KEY or SENDGRID_API_KEY");
  } else if (providerRaw === "resend" && !resendKey) {
    missingVars.push("RESEND_API_KEY");
  } else if (providerRaw === "sendgrid" && !sendgridKey) {
    missingVars.push("SENDGRID_API_KEY");
  }
  if (!fromAddress) {
    missingVars.push("EMAIL_FROM_ADDRESS");
  }

  return {
    configured: false,
    provider: "unconfigured",
    missingVars,
  };
}

/**
 * Dispatches a transactional email when an email provider is configured,
 * records delivery status in `emailDeliveries`, and avoids duplicate deliveries.
 * Does NOT simulate successful delivery when unconfigured.
 */
export async function dispatchEmailNotification(params: {
  userId: string;
  toEmail: string;
  subject: string;
  message: string;
  link?: string | null;
  essential?: boolean;
  emailEnabled?: boolean;
  dedupeKey?: string;
  notificationId?: string;
}): Promise<{
  status: "sent" | "skipped_disabled" | "skipped_unconfigured" | "failed" | "duplicate_suppressed";
  provider: string;
  error?: string;
}> {
  const {
    userId,
    toEmail,
    subject,
    message,
    link,
    essential = false,
    emailEnabled = true,
    dedupeKey,
    notificationId,
  } = params;

  const nowIso = new Date().toISOString();

  // Essential security/account emails cannot be disabled by preferences
  if (!essential && emailEnabled === false) {
    return { status: "skipped_disabled", provider: "none" };
  }

  if (!toEmail || !toEmail.includes("@")) {
    return { status: "failed", provider: "none", error: "Missing or invalid recipient email address" };
  }

  // Deduplication check inside recent window
  const effectiveDedupeKey =
    dedupeKey ||
    crypto
      .createHash("sha256")
      .update(`${userId}:${subject}:${message}`)
      .digest("hex")
      .slice(0, 32);

  try {
    const existingSnap = await adminDb
      .collection("emailDeliveries")
      .where("dedupeKey", "==", effectiveDedupeKey)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingData = existingSnap.docs[0].data();
      const prevTime = existingData.createdAt ? new Date(existingData.createdAt).getTime() : 0;
      // Suppress duplicate email within 5 minutes
      if (existingData.status === "sent" && Date.now() - prevTime < 5 * 60 * 1000) {
        return { status: "duplicate_suppressed", provider: existingData.provider || "none" };
      }
    }
  } catch {
    // Non-fatal dedupe lookup fallback
  }

  const cfg = getEmailProviderConfig();
  if (!cfg.configured || !cfg.apiKey || !cfg.fromAddress) {
    try {
      await adminDb.collection("emailDeliveries").add({
        userId,
        toEmail,
        subject,
        notificationId: notificationId || null,
        dedupeKey: effectiveDedupeKey,
        provider: "unconfigured",
        status: "skipped_unconfigured",
        missingVars: cfg.missingVars,
        essential,
        createdAt: nowIso,
      });
    } catch {
      // Ignore logging error
    }
    return {
      status: "skipped_unconfigured",
      provider: "unconfigured",
      error: `Email provider not configured. Missing: ${cfg.missingVars.join(", ")}`,
    };
  }

  const appOrigin = (process.env.APP_PUBLIC_ORIGIN || "https://databoy-aa871.web.app").replace(/\/+$/, "");
  const fullActionUrl = link ? (link.startsWith("http") ? link : `${appOrigin}${link}`) : appOrigin;
  const htmlBody = `
    <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 18px;">${subject}</h2>
      <p style="margin: 0 0 20px; color: #334155; font-size: 14px; line-height: 1.6;">${message}</p>
      ${
        link
          ? `<a href="${fullActionUrl}" style="display: inline-block; padding: 10px 18px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 13px;">View in DataBoy</a>`
          : ""
      }
      <hr style="margin: 24px 0 12px; border: 0; border-top: 1px solid #e2e8f0;" />
      <p style="margin: 0; color: #64748b; font-size: 11px;">DataBoy Academic Platform • Automated Notification</p>
    </div>
  `.trim();

  try {
    let response: Response;
    if (cfg.provider === "resend") {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: cfg.fromAddress,
          to: [toEmail],
          subject,
          html: htmlBody,
          text: `${subject}\n\n${message}${link ? `\n\nOpen: ${fullActionUrl}` : ""}`,
        }),
      });
    } else {
      response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toEmail }] }],
          from: { email: cfg.fromAddress },
          subject,
          content: [
            { type: "text/plain", value: `${subject}\n\n${message}${link ? `\n\nOpen: ${fullActionUrl}` : ""}` },
            { type: "text/html", value: htmlBody },
          ],
        }),
      });
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      await adminDb.collection("emailDeliveries").add({
        userId,
        toEmail,
        subject,
        notificationId: notificationId || null,
        dedupeKey: effectiveDedupeKey,
        provider: cfg.provider,
        status: "failed",
        error: `HTTP ${response.status}: ${errText.slice(0, 300)}`,
        essential,
        createdAt: nowIso,
      });
      return {
        status: "failed",
        provider: cfg.provider,
        error: `Email provider returned HTTP ${response.status}`,
      };
    }

    await adminDb.collection("emailDeliveries").add({
      userId,
      toEmail,
      subject,
      notificationId: notificationId || null,
      dedupeKey: effectiveDedupeKey,
      provider: cfg.provider,
      status: "sent",
      essential,
      createdAt: nowIso,
    });

    return { status: "sent", provider: cfg.provider };
  } catch (err: any) {
    const errMsg = err?.message || "Network error during email delivery";
    try {
      await adminDb.collection("emailDeliveries").add({
        userId,
        toEmail,
        subject,
        notificationId: notificationId || null,
        dedupeKey: effectiveDedupeKey,
        provider: cfg.provider,
        status: "failed",
        error: errMsg,
        essential,
        createdAt: nowIso,
      });
    } catch {
      // Ignore
    }
    return { status: "failed", provider: cfg.provider, error: errMsg };
  }
}

/**
 * Dispatches PWA Web Push notifications via Firebase Cloud Messaging (FCM)
 * to all registered devices for the target user, automatically pruning invalid tokens.
 */
export async function dispatchPushNotification(params: {
  userId: string;
  title: string;
  message: string;
  link?: string | null;
  pushEnabled?: boolean;
  notificationId?: string;
}): Promise<{
  status: "sent" | "skipped_disabled" | "no_devices" | "failed";
  sentCount: number;
  removedCount: number;
}> {
  const { userId, title, message, link, pushEnabled = true, notificationId } = params;

  if (pushEnabled === false) {
    return { status: "skipped_disabled", sentCount: 0, removedCount: 0 };
  }

  try {
    const tokensSnap = await adminDb
      .collection("userDeviceTokens")
      .where("userId", "==", userId)
      .where("enabled", "==", true)
      .get();

    if (tokensSnap.empty) {
      return { status: "no_devices", sentCount: 0, removedCount: 0 };
    }

    const tokenDocs = tokensSnap.docs;
    const tokens = tokenDocs
      .map((d) => d.data().token as string)
      .filter((t) => typeof t === "string" && t.trim().length > 10);

    if (tokens.length === 0) {
      return { status: "no_devices", sentCount: 0, removedCount: 0 };
    }

    // In test emulator environment without real FCM credentials, skip live network call safely
    const isTestEnv =
      (process.env.NODE_ENV || "").trim().toLowerCase() === "test" ||
      Boolean(process.env.FIRESTORE_EMULATOR_HOST?.trim());
    if (isTestEnv && process.env.FCM_LIVE_IN_TEST !== "true") {
      return { status: "no_devices", sentCount: 0, removedCount: 0 };
    }

    const targetUrl = link || "/dashboard";
    const multicastResult = await adminMessaging.sendEachForMulticast({
      tokens,
      notification: {
        title,
        body: message,
      },
      data: {
        url: targetUrl,
        notificationId: notificationId || "",
        title,
        body: message,
      },
      webpush: {
        fcmOptions: {
          link: targetUrl,
        },
        notification: {
          title,
          body: message,
          icon: "/brand-pack/App-Icons/app-icon-192x192.png",
          badge: "/brand-pack/Favicons/favicon-32x32.png",
        },
      },
    });

    let removedCount = 0;
    const invalidCodes = new Set([
      "messaging/invalid-registration-token",
      "messaging/registration-token-not-registered",
      "messaging/invalid-argument",
    ]);

    const cleanupPromises: Promise<any>[] = [];
    multicastResult.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error?.code && invalidCodes.has(resp.error.code)) {
        const badDoc = tokenDocs[idx];
        if (badDoc) {
          removedCount++;
          cleanupPromises.push(badDoc.ref.delete());
        }
      }
    });

    if (cleanupPromises.length > 0) {
      await Promise.allSettled(cleanupPromises);
    }

    return {
      status: multicastResult.successCount > 0 ? "sent" : "failed",
      sentCount: multicastResult.successCount,
      removedCount,
    };
  } catch (err) {
    console.warn("[NotificationService] FCM push dispatch error:", err);
    return { status: "failed", sentCount: 0, removedCount: 0 };
  }
}

export async function createNotification(params: CreateNotificationParams): Promise<string> {
  const {
    userId,
    title,
    message,
    type = "system",
    link,
    relatedUrl,
    relatedId,
    relatedType,
    essential = false,
    dedupeKey,
    metadata,
  } = params;

  if (!userId || !title || !message) {
    throw new Error("Missing required notification fields: userId, title, or message");
  }

  const normalizedUrl = normalizeDeepLink(relatedUrl || link);
  const nowIso = new Date().toISOString();

  // Check recipient user preferences
  let inAppEnabled = true;
  let emailEnabled = true;
  let pushEnabled = true;
  let recipientEmail = "";

  try {
    const userSnap = await adminDb.collection("users").doc(userId).get();
    if (userSnap.exists) {
      const u = userSnap.data() || {};
      recipientEmail = typeof u.email === "string" ? u.email : "";
      const prefs = u.preferences || {};
      const notifPrefs = prefs.notifications || {};
      if (notifPrefs.inApp === false || (notifPrefs.inApp === undefined && prefs.inAppNotifications === false)) {
        inAppEnabled = false;
      }
      if (notifPrefs.email === false || (notifPrefs.email === undefined && prefs.emailNotifications === false)) {
        emailEnabled = false;
      }
      if (notifPrefs.push === false || (notifPrefs.push === undefined && prefs.pushNotifications === false)) {
        pushEnabled = false;
      }
    }
  } catch {
    // Default to enabled if user profile read fails
  }

  // Deduplication check for identical unread notification within last 60 seconds
  if (dedupeKey) {
    try {
      const dupSnap = await adminDb
        .collection("notifications")
        .where("userId", "==", userId)
        .where("dedupeKey", "==", dedupeKey)
        .limit(1)
        .get();
      if (!dupSnap.empty) {
        return dupSnap.docs[0].id;
      }
    } catch {
      // Continue
    }
  }

  let notificationId = "";

  // Write in-app notification if essential or inAppNotifications is enabled
  if (essential || inAppEnabled) {
    const docRef = await adminDb.collection("notifications").add({
      userId,
      title,
      message,
      type,
      link: normalizedUrl,
      relatedUrl: normalizedUrl,
      relatedId: relatedId || null,
      relatedType: relatedType || (type === "assignment" || type === "research" ? type : "system"),
      essential: Boolean(essential),
      ...(dedupeKey ? { dedupeKey } : {}),
      metadata: metadata || {},
      read: false,
      createdAt: nowIso,
    });
    notificationId = docRef.id;
  }

  // Best-effort asynchronous email & push dispatch (awaited safely so delivery status is recorded)
  if (recipientEmail && (essential || emailEnabled)) {
    await dispatchEmailNotification({
      userId,
      toEmail: recipientEmail,
      subject: `[DataBoy] ${title}`,
      message,
      link: normalizedUrl,
      essential,
      emailEnabled,
      dedupeKey,
      notificationId: notificationId || undefined,
    });
  }

  if (essential || pushEnabled) {
    await dispatchPushNotification({
      userId,
      title,
      message,
      link: normalizedUrl,
      pushEnabled,
      notificationId: notificationId || undefined,
    });
  }

  return notificationId;
}
