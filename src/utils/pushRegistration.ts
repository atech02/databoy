export type PushRegistrationState =
  | "unsupported"
  | "permission_denied"
  | "configuration_missing"
  | "registration_failed"
  | "enabled";

export interface PushEnableResult {
  success: boolean;
  state: PushRegistrationState;
  token?: string;
  deviceId?: string;
  error?: string;
}

export interface PushEnableDependencies {
  vapidKey?: string;
  checkSupport: () => {
    supported: boolean;
    permission: NotificationPermission | "unsupported";
    isIosWithoutStandalone: boolean;
    reason?: string;
  };
  requestPermission: () => Promise<NotificationPermission>;
  getServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration>;
  acquireFcmToken: (swReg: ServiceWorkerRegistration, vapidKey: string) => Promise<string | null>;
  registerTokenWithBackend: (payload: {
    token: string;
    deviceLabel: string;
    platform: string;
    userAgent: string;
  }) => Promise<{ success: boolean; deviceId: string }>;
  saveLocalToken?: (token: string) => void;
  userAgent?: string;
  hostname?: string;
}

/**
 * Pure, dependency-injectable Web Push / FCM registration flow.
 * Enforces strict VAPID validation, genuine Firebase getToken() acquisition,
 * and backend registration. NEVER fabricates synthetic device tokens.
 */
export async function executePushRegistration(deps: PushEnableDependencies): Promise<PushEnableResult> {
  const support = deps.checkSupport();
  if (!support.supported) {
    return {
      success: false,
      state: "unsupported",
      error:
        support.reason ||
        "Push notifications are not supported on this browser/device. In-app notifications will continue working.",
    };
  }

  const vapidKey = (deps.vapidKey || "").trim();
  if (!vapidKey || vapidKey.length < 20) {
    return {
      success: false,
      state: "configuration_missing",
      error:
        "Push notifications are not yet configured for this environment (missing Web Push VAPID public key). In-app notifications remain active.",
    };
  }

  try {
    const permission = await deps.requestPermission();
    if (permission !== "granted") {
      return {
        success: false,
        state: "permission_denied",
        error:
          permission === "denied"
            ? "Notification permission was denied in your browser settings. Please allow notifications for this site to enable push alerts. In-app notifications remain active."
            : "Notification permission request was dismissed. In-app notifications remain active.",
      };
    }

    const swReg = await deps.getServiceWorkerRegistration();
    let fcmToken: string | null = null;
    try {
      fcmToken = await deps.acquireFcmToken(swReg, vapidKey);
    } catch (fcmErr: any) {
      return {
        success: false,
        state: "registration_failed",
        error:
          fcmErr?.message ||
          "Could not acquire a Firebase Cloud Messaging token from this browser. In-app notifications remain active.",
      };
    }

    const cleanToken = typeof fcmToken === "string" ? fcmToken.trim() : "";
    if (!cleanToken || cleanToken.startsWith("webpush_device_")) {
      return {
        success: false,
        state: "registration_failed",
        error:
          "Firebase Cloud Messaging did not return a valid device token. Push notifications could not be enabled; in-app notifications remain active.",
      };
    }

    const ua = deps.userAgent || "";
    const hostname = deps.hostname || "databoy";
    const platform = /android/i.test(ua)
      ? "Android"
      : /ipad|iphone|ipod/i.test(ua)
      ? "iOS / iPadOS"
      : /windows/i.test(ua)
      ? "Windows Desktop"
      : /macintosh|mac os/i.test(ua)
      ? "macOS Desktop"
      : "Web Browser";

    let backendRes: { success: boolean; deviceId: string };
    try {
      backendRes = await deps.registerTokenWithBackend({
        token: cleanToken,
        deviceLabel: `${platform} (${hostname})`,
        platform,
        userAgent: ua,
      });
    } catch (backendErr: any) {
      return {
        success: false,
        state: "registration_failed",
        error:
          backendErr?.message ||
          "Failed to register your push notification token with the DataBoy server. Please try again later.",
      };
    }

    if (!backendRes || !backendRes.success || !backendRes.deviceId) {
      return {
        success: false,
        state: "registration_failed",
        error: "Server did not confirm push device registration. Please try again.",
      };
    }

    if (deps.saveLocalToken) {
      deps.saveLocalToken(cleanToken);
    }

    return {
      success: true,
      state: "enabled",
      token: cleanToken,
      deviceId: backendRes.deviceId,
    };
  } catch (err: any) {
    return {
      success: false,
      state: "registration_failed",
      error: err?.message || "Failed to enable push notifications.",
    };
  }
}
