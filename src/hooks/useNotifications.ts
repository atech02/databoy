"use client";

import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { Notification } from "@/types/domain";
import { notificationService } from "@/services/notificationService";

export function formatNotificationTimestamp(raw: any): string {
  if (!raw) return "Just now";
  try {
    if (typeof raw?.toDate === "function") {
      return raw.toDate().toLocaleString();
    }
    if (typeof raw?.seconds === "number") {
      return new Date(raw.seconds * 1000).toLocaleString();
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  } catch {
    // Fallback
  }
  return "Recent";
}

export function normalizeNotificationUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl || typeof rawUrl !== "string") return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

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
  // Security validation: only permit internal single-slash paths
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || /[\r\n]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export function useNotifications(userId: string | undefined): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(40)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Notification[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const url = normalizeNotificationUrl(data.relatedUrl || data.link);
          items.push({
            id: d.id,
            ...data,
            relatedUrl: url,
          } as Notification);
        });
        setNotifications(items);
        setLoading(false);
      },
      (err) => {
        console.error("[useNotifications] Snapshot error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userId]);

  const markRead = useCallback(
    async (id: string) => {
      await notificationService.markAsRead(id);
    },
    []
  );

  const markAllRead = useCallback(
    async () => {
      if (!userId) return;
      await notificationService.markAllRead(userId);
    },
    [userId]
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, loading, markRead, markAllRead };
}
