import { createClient } from "redis";
import { adminDb } from "../../config/firebaseAdmin.js";
import { AIUsageRecord, AITokenUsage } from "./types.js";

// Safety limits per user
export const USER_AI_RPM_LIMIT = 5;          // 5 requests per minute per user
export const USER_AI_DAILY_LIMIT = 30;       // 30 requests per day per user
export const PROVIDER_COOLDOWN_MS = 60000;   // 60 seconds cooldown after a 429 quota exhaustion
export const REDIS_COOLDOWN_KEY = "ai:cooldown:google_gemini";

export interface RedisClientInterface {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<any>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<any>;
  ttl(key: string): Promise<number>;
  del?(key: string): Promise<any>;
}

interface WindowCounter {
  minuteCount: number;
  minuteResetAt: number;
  dayCount: number;
  dayResetAt: number;
}

export class AIUsageTracker {
  // In-memory fallback and tracking structures
  private static userWindows: Map<string, WindowCounter> = new Map();
  private static providerCooldownUntil: number = 0;
  private static totalTokensUsed: AITokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  // Redis integration
  private static customRedisClient: RedisClientInterface | null = null;
  private static nativeRedisClient: any = null;
  private static isRedisConnecting = false;

  /**
   * Allows injecting a custom or mock Redis client (for automated tests or custom connections).
   */
  public static setRedisClient(client: RedisClientInterface | null): void {
    this.customRedisClient = client;
  }

  /**
   * Lazily initializes and returns the active Redis client if REDIS_URL is available.
   * Gracefully returns null if Redis is not configured or fails to connect.
   */
  private static async getRedisClient(): Promise<RedisClientInterface | null> {
    if (this.customRedisClient) {
      return this.customRedisClient;
    }

    const redisUrl = (process.env.REDIS_URL || "").trim();
    if (!redisUrl) {
      return null;
    }

    if (this.nativeRedisClient && this.nativeRedisClient.isOpen) {
      return this.nativeRedisClient;
    }

    if (this.isRedisConnecting) {
      return null;
    }

    try {
      this.isRedisConnecting = true;
      const client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 2000,
          reconnectStrategy: (retries: number) => Math.min(200 * (retries + 1), 2000),
        },
      });

      client.on("error", (err: any) => {
        console.warn("[AIUsageTracker] Redis socket warning:", err?.message || err);
      });

      await client.connect();
      this.nativeRedisClient = client;
      return this.nativeRedisClient;
    } catch (connErr) {
      console.warn("[AIUsageTracker] Redis connection failed, using in-memory fallback:", connErr);
      return null;
    } finally {
      this.isRedisConnecting = false;
    }
  }

  /**
   * Evaluates whether a user is permitted to make an AI request under fair-use quotas.
   * Priority: Checks atomic Redis state first (shared across Render instances);
   * Falls back gracefully to process-memory window tracking if Redis is unreachable.
   */
  public static async canUserRequest(
    userUid: string
  ): Promise<{ allowed: boolean; reason?: string; retryAfterSeconds?: number }> {
    const now = Date.now();

    // 1. Check Redis State First (Multi-Instance Consistency)
    try {
      const client = await this.getRedisClient();
      if (client) {
        // (A) Check Shared 429 Cooldown Key
        const cooldownVal = await client.get(REDIS_COOLDOWN_KEY);
        if (cooldownVal) {
          const ttlSec = await client.ttl(REDIS_COOLDOWN_KEY);
          const waitSec = ttlSec > 0 ? ttlSec : Math.ceil(PROVIDER_COOLDOWN_MS / 1000);
          return {
            allowed: false,
            reason: `AI service is temporarily resting to respect Google free-tier limits. Please retry in ${waitSec}s.`,
            retryAfterSeconds: waitSec,
          };
        }

        // (B) Check Per-User RPM Counter
        const rpmVal = await client.get(`ai:rpm:${userUid}`);
        if (rpmVal && parseInt(rpmVal, 10) >= USER_AI_RPM_LIMIT) {
          const ttl = await client.ttl(`ai:rpm:${userUid}`);
          const waitSec = ttl > 0 ? ttl : 60;
          return {
            allowed: false,
            reason: `Rate limit reached (${USER_AI_RPM_LIMIT} requests/min). Please wait ${waitSec}s.`,
            retryAfterSeconds: waitSec,
          };
        }

        // (C) Check Per-User Daily Counter
        const today = new Date().toISOString().slice(0, 10);
        const dailyVal = await client.get(`ai:daily:${userUid}:${today}`);
        if (dailyVal && parseInt(dailyVal, 10) >= USER_AI_DAILY_LIMIT) {
          return {
            allowed: false,
            reason: `Daily free AI quota reached (${USER_AI_DAILY_LIMIT} requests/day). Assignment parsing is available via local engine.`,
          };
        }

        return { allowed: true };
      }
    } catch (redisErr) {
      console.warn("[AIUsageTracker] Redis query failed, falling back to in-memory check:", redisErr);
    }

    // 2. Safe In-Memory Fallback (Active during Redis outages or local dev without Redis)
    if (now < this.providerCooldownUntil) {
      const waitSec = Math.ceil((this.providerCooldownUntil - now) / 1000);
      return {
        allowed: false,
        reason: `AI service is temporarily resting to respect Google free-tier limits. Please retry in ${waitSec}s.`,
        retryAfterSeconds: waitSec,
      };
    }

    let counter = this.userWindows.get(userUid);
    if (!counter) {
      counter = {
        minuteCount: 0,
        minuteResetAt: now + 60000,
        dayCount: 0,
        dayResetAt: now + 86400000,
      };
      this.userWindows.set(userUid, counter);
    }

    if (now > counter.minuteResetAt) {
      counter.minuteCount = 0;
      counter.minuteResetAt = now + 60000;
    }

    if (now > counter.dayResetAt) {
      counter.dayCount = 0;
      counter.dayResetAt = now + 86400000;
    }

    if (counter.minuteCount >= USER_AI_RPM_LIMIT) {
      const waitSec = Math.ceil((counter.minuteResetAt - now) / 1000);
      return {
        allowed: false,
        reason: `Rate limit reached (${USER_AI_RPM_LIMIT} requests/min). Please wait ${waitSec}s.`,
        retryAfterSeconds: waitSec,
      };
    }

    if (counter.dayCount >= USER_AI_DAILY_LIMIT) {
      return {
        allowed: false,
        reason: `Daily free AI quota reached (${USER_AI_DAILY_LIMIT} requests/day). Assignment parsing is available via local engine.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Atomically increments the request counters for a user in Redis and in-memory.
   */
  public static async incrementUserUsage(userUid: string): Promise<void> {
    // 1. Atomic Redis Increments
    try {
      const client = await this.getRedisClient();
      if (client) {
        const rpmKey = `ai:rpm:${userUid}`;
        const currentRpm = await client.incr(rpmKey);
        if (currentRpm === 1) {
          await client.expire(rpmKey, 60);
        }

        const today = new Date().toISOString().slice(0, 10);
        const dailyKey = `ai:daily:${userUid}:${today}`;
        const currentDaily = await client.incr(dailyKey);
        if (currentDaily === 1) {
          await client.expire(dailyKey, 86400);
        }
      }
    } catch (redisErr) {
      console.warn("[AIUsageTracker] Redis increment failed, falling back to memory:", redisErr);
    }

    // 2. Local In-Memory Increment
    const counter = this.userWindows.get(userUid);
    if (counter) {
      counter.minuteCount++;
      counter.dayCount++;
    }
  }

  /**
   * Flags a 429 quota exhaustion from Gemini across all Render instances using Redis shared key.
   */
  public static async reportQuotaExhaustion(cooldownMs = PROVIDER_COOLDOWN_MS): Promise<void> {
    const cooldownSec = Math.max(1, Math.ceil(cooldownMs / 1000));
    this.providerCooldownUntil = Date.now() + cooldownMs;

    try {
      const client = await this.getRedisClient();
      if (client) {
        await client.set(REDIS_COOLDOWN_KEY, "1", { EX: cooldownSec });
        console.warn(`[AIUsageTracker] Redis shared cooldown active for ${cooldownSec}s.`);
      }
    } catch (redisErr) {
      console.warn("[AIUsageTracker] Redis cooldown set failed, retained in memory:", redisErr);
    }
  }

  /**
   * Records completed token consumption and writes audit log to Firestore (non-blocking).
   */
  public static async recordUsage(record: AIUsageRecord): Promise<void> {
    this.totalTokensUsed.promptTokens += record.promptTokens;
    this.totalTokensUsed.completionTokens += record.completionTokens;
    this.totalTokensUsed.totalTokens += record.totalTokens;

    if (process.env.NODE_ENV !== "test" || process.env.FIRESTORE_EMULATOR_HOST) {
      try {
        await adminDb.collection("aiUsageLogs").add({
          ...record,
          recordedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn("[AIUsageTracker] Non-blocking error writing usage log:", err);
      }
    }
  }

  /**
   * Retrieves summary telemetry for testing and monitoring.
   */
  public static getTelemetry(): {
    totalTokens: AITokenUsage;
    isCoolingDown: boolean;
    cooldownRemainingSec: number;
  } {
    const now = Date.now();
    return {
      totalTokens: { ...this.totalTokensUsed },
      isCoolingDown: now < this.providerCooldownUntil,
      cooldownRemainingSec: Math.max(0, Math.ceil((this.providerCooldownUntil - now) / 1000)),
    };
  }

  /**
   * Resets in-memory counters (primarily for automated unit test suites).
   */
  public static resetForTesting(): void {
    this.userWindows.clear();
    this.providerCooldownUntil = 0;
    this.totalTokensUsed = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.customRedisClient = null;
  }
}
