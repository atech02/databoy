import { GoogleGenerativeAI } from "@google/generative-ai";

export class AssignmentUnderstandingProvider {
  /**
   * Processes a document (image/pdf) and extracts assignment details.
   * @param {Buffer} fileBuffer - The file bytes
   * @param {string} mimeType - File mime type
   * @param {string} apiKey - API Key for the provider
   * @returns {Promise<{
   *   rawText: string,
   *   parsedFields: {
   *     title?: string,
   *     questions?: string,
   *     instructions?: string,
   *     wordCount?: number,
   *     referencingStyle?: string,
   *     deadline?: string,
   *     academicLevel?: string
   *   },
   *   metrics: {
   *     modelUsed: string,
   *     tokenUsage: {
   *       promptTokens: number,
   *       completionTokens: number
   *     },
   *     requestCostEstimate: number
   *   }
   * }>}
   */
  async understandAssignment(fileBuffer, mimeType, apiKey) {
    throw new Error("Not implemented");
  }
}

export class GeminiFlashProvider extends AssignmentUnderstandingProvider {
  async understandAssignment(fileBuffer, mimeType, apiKey) {
    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-2.5-flash as the standard, cost-efficient multimodal model
    const modelName = "gemini-2.5-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const base64Data = fileBuffer.toString("base64");

    const prompt = `You are processing a university assignment brief.
Extract:
- Assignment title
- Assignment questions (verbatim, preserve question numbering, bullet points, sub-sections, and line breaks)
- Assignment instructions (verbatim instructions, guidelines, word limit, referencing constraints, preserve line breaks)
- Word count (numerical estimation if stated, e.g., 2000)
- Referencing style (e.g. APA, Harvard, MLA, Chicago, IEEE, Vancouver, or Other)
- Deadline (if stated, parse to YYYY-MM-DD format)
- Academic level (if stated, e.g. undergraduate, postgraduate, phd)

Preserve the complete assignment brief and task structures. Do not summarize or synthesize.
Also transcribe the complete, raw extracted text from the document.
Return structured JSON only.`;

    const responseSchema = {
      type: "object",
      properties: {
        title: { type: "string", description: "The title of the assignment, if present" },
        questions: { type: "string", description: "Verbatim list of assignment questions, tasks, or assignment prompts, preserving all sub-questions and formatting" },
        instructions: { type: "string", description: "Verbatim instructions, requirements, guidelines, grading criteria, and metadata details" },
        wordCount: { type: "integer", description: "Numerical word count limit or target, if stated" },
        referencingStyle: { type: "string", description: "Referencing style, standard naming (e.g. APA, Harvard, MLA, Chicago, IEEE, Vancouver)" },
        deadline: { type: "string", description: "Parsed deadline in YYYY-MM-DD format" },
        academicLevel: { type: "string", description: "Academic level if mentioned" },
        rawText: { type: "string", description: "Verbatim transcription of all readable text in the document" }
      },
      required: ["questions", "instructions", "rawText"]
    };

    const filePart = {
      inlineData: {
        data: base64Data,
        mimeType: mimeType
      }
    };

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            filePart
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema
      }
    });

    const response = await result.response;
    const responseText = response.text();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      console.error("Gemini response is not valid JSON:", responseText);
      throw new Error("Failed to parse Gemini output as structured JSON.");
    }

    const promptTokens = response.usageMetadata?.promptTokenCount || 0;
    const completionTokens = response.usageMetadata?.candidatesTokenCount || 0;

    // Pricing for Gemini 2.5 Flash:
    // Input: $0.075 / 1M tokens ($0.075 * 10^-6 per token)
    // Output: $0.30 / 1M tokens ($0.30 * 10^-6 per token)
    const costEstimate = (promptTokens * 0.075e-6) + (completionTokens * 0.30e-6);

    const { rawText, ...parsedFields } = parsed;

    return {
      rawText: rawText || "",
      parsedFields: parsedFields,
      metrics: {
        modelUsed: modelName,
        tokenUsage: {
          promptTokens,
          completionTokens
        },
        requestCostEstimate: parseFloat(costEstimate.toFixed(9))
      }
    };
  }
}
