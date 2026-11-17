import { AIProvider, StructuredGenerationParams, AIStructuredResponse } from "./types.js";
import { AIUsageTracker } from "./AIUsageTracker.js";

export class GeminiProvider implements AIProvider {
  public readonly id = "google_gemini";
  public readonly name = "Google Gemini Flash (Developer API)";
  private readonly defaultModel = "gemini-2.5-flash";
  private readonly fallbackModel = "gemini-1.5-flash";

  private getApiKey(): string {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  }

  public isAvailable(): boolean {
    return Boolean(this.getApiKey());
  }

  public async generateStructuredContent<T>(
    params: StructuredGenerationParams
  ): Promise<AIStructuredResponse<T>> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        metrics: { providerId: this.id, modelUsed: "none", durationMs: 0 },
        error: { code: "PROVIDER_ERROR", message: "GEMINI_API_KEY is not configured on backend." },
      };
    }

    const startTime = Date.now();
    const model = this.defaultModel;

    // 1. Construct parts: Prioritize plain text input over expensive image buffers
    const parts: any[] = [];
    if (params.userPrompt) {
      parts.push({ text: params.userPrompt });
    }

    if (params.textInput) {
      parts.push({
        text: `--- EXTRACTED ASSIGNMENT TEXT ---\n${params.textInput}\n--- END EXTRACTED TEXT ---`,
      });
    } else if (params.multimodalInput) {
      // Multimodal fallback only when raw text was not pre-extracted
      parts.push({
        inlineData: {
          mimeType: params.multimodalInput.mimeType,
          data: params.multimodalInput.buffer.toString("base64"),
        },
      });
    }

    const body: any = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: params.temperature ?? 0.1,
      },
    };

    if (params.schema) {
      body.generationConfig.responseSchema = params.schema;
    }

    if (params.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: params.systemPrompt }],
      };
    }

    const timeoutMs = params.timeoutMs || 30000;

    const executeCall = async (targetModel: string) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`;
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    };

    try {
      let activeModel = this.defaultModel;
      let response = await executeCall(activeModel);

      // 1. Handle 429 Quota Exhaustion immediately - NEVER fallback on 429
      if (response.status === 429) {
        await AIUsageTracker.reportQuotaExhaustion();
        const durationMs = Date.now() - startTime;
        return {
          success: false,
          metrics: { providerId: this.id, modelUsed: activeModel, durationMs },
          error: {
            code: "QUOTA_EXHAUSTED",
            message: "Gemini Developer API rate limit / quota reached. Falling back to local rule-based parsing.",
          },
        };
      }

      // 2. Handle 401/403 Authentication/Permission Errors - NEVER fallback on 401/403
      if (response.status === 401 || response.status === 403) {
        const durationMs = Date.now() - startTime;
        const errorText = await response.text();
        return {
          success: false,
          metrics: { providerId: this.id, modelUsed: activeModel, durationMs },
          error: {
            code: "PROVIDER_ERROR",
            message: `Gemini API authentication failed (HTTP ${response.status}): ${errorText.slice(0, 300)}`,
          },
        };
      }

      // 3. Conditional Fallback exclusively for HTTP 404 (model not found) and HTTP 503 (service unavailable / overloaded)
      if (response.status === 404 || response.status === 503) {
        console.warn(
          `[GeminiProvider] Primary model ${activeModel} unavailable (HTTP ${response.status}). Initiating fallback to ${this.fallbackModel}...`
        );
        activeModel = this.fallbackModel;
        response = await executeCall(activeModel);

        if (response.status === 429) {
          await AIUsageTracker.reportQuotaExhaustion();
          const durationMs = Date.now() - startTime;
          return {
            success: false,
            metrics: { providerId: this.id, modelUsed: activeModel, durationMs },
            error: {
              code: "QUOTA_EXHAUSTED",
              message: "Gemini Developer API rate limit / quota reached on fallback model.",
            },
          };
        }
      }

      if (!response.ok) {
        const durationMs = Date.now() - startTime;
        const errorText = await response.text();
        return {
          success: false,
          metrics: { providerId: this.id, modelUsed: activeModel, durationMs },
          error: {
            code: "PROVIDER_ERROR",
            message: `Gemini API HTTP ${response.status}: ${errorText.slice(0, 300)}`,
          },
        };
      }

      const json: any = await response.json();
      const rawResponseText = json.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawResponseText) {
        const durationMs = Date.now() - startTime;
        return {
          success: false,
          metrics: { providerId: this.id, modelUsed: activeModel, durationMs },
          error: { code: "PROVIDER_ERROR", message: "Gemini returned empty candidate content." },
        };
      }

      const durationMs = Date.now() - startTime;
      const promptTokens = json.usageMetadata?.promptTokenCount || 0;
      const completionTokens = json.usageMetadata?.candidatesTokenCount || 0;
      const totalTokens = json.usageMetadata?.totalTokenCount || promptTokens + completionTokens;

      return {
        success: true,
        rawText: rawResponseText,
        metrics: {
          providerId: this.id,
          modelUsed: activeModel,
          durationMs,
          tokenUsage: { promptTokens, completionTokens, totalTokens },
          costEstimate: 0, // Google AI Studio Developer API free tier
        },
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      return {
        success: false,
        metrics: { providerId: this.id, modelUsed: this.defaultModel, durationMs },
        error: {
          code: isTimeout ? "TIMEOUT" : "PROVIDER_ERROR",
          message: err?.message || String(err),
        },
      };
    }
  }
}
