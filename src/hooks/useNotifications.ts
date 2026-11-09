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
      limit(30)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Notification[] = [];
        snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Notification));
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
