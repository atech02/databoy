/**
 * DataBoy Centralized Frontend API Client
 *
 * Connects the Next.js frontend to the independent Express backend.
 * Handles Firebase Auth ID token injection, automatic token refresh,
 * standardized error parsing, and typed request/response handling.
 */

import { auth } from "@/config/firebase";

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export interface RequestOptions extends RequestInit {
  requiresAuth?: boolean;
  token?: string; // Optional explicit token override
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    const envUrl = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
    if (envUrl) {
      this.baseUrl = envUrl;
    } else if (
      typeof window !== "undefined" &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ) {
      this.baseUrl = "";
    } else {
      this.baseUrl = "http://localhost:5001";
    }
  }

  /**
   * Retrieves the current Firebase user ID token.
   * Forces refresh if expired or about to expire.
   */
  private async getIdToken(): Promise<string | null> {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return null;
      // getIdToken automatically refreshes expired tokens
      return await currentUser.getIdToken();
    } catch (err) {
      console.error("[ApiClient] Failed to obtain Firebase ID token:", err);
      return null;
    }
  }

  /**
   * Core request dispatcher with error normalization and auth header injection.
   */
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { requiresAuth = true, token: explicitToken, headers = {}, ...restOptions } = options;
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${this.baseUrl}${cleanPath}`;

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(headers as Record<string, string>),
    };

    if (requiresAuth) {
      const token = explicitToken || (await this.getIdToken());
      if (token) {
        requestHeaders["Authorization"] = `Bearer ${token}`;
      } else if (!explicitToken) {
        console.warn(`[ApiClient] Request to ${cleanPath} requires authentication, but no active user session found.`);
      }
    }

    try {
      const response = await fetch(url, {
        ...restOptions,
        headers: requestHeaders,
      });

      let responseData: any;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      if (!response.ok) {
        const errorMessage =
          (typeof responseData === "object" && responseData?.error) ||
          (typeof responseData === "object" && responseData?.message) ||
          (typeof responseData === "string" && responseData) ||
          `HTTP ${response.status} Error`;

        throw new ApiError(response.status, errorMessage, responseData);
      }

      return responseData as T;
    } catch (err: any) {
      if (err instanceof ApiError) {
        throw err;
      }

      console.error(`[ApiClient] Network or request error on [${options.method || "GET"} ${cleanPath}]:`, err?.message || err);
      throw new ApiError(0, err?.message || "Network request failed", null);
    }
  }

  /**
   * HTTP GET
   */
  public async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  /**
   * HTTP POST
   */
  public async post<T>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * HTTP PUT
   */
  public async put<T>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * HTTP DELETE
   */
  public async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }
}

export const apiClient = new ApiClient();
export default apiClient;
