import assert from "node:assert";
import { test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";

// Load module components to test
// We can import documentProcessor directly or re-implement / test against its exported members
import {
  DIGITAL_PDF_MAX_PAGES,
  SCANNED_PDF_MAX_PAGES,
  TESSERACT_VERSION,
  PDFJS_VERSION,
  JSZIP_VERSION,
  PREPROCESSING_CONFIG,
  PDF_RENDER_CONFIG,
  computeSha256Hex,
  buildDeterministicCacheKey,
  cleanupCanvas,
  preprocessCanvas,
  calculateStopwordRatio,
  detectGibberishText,
  evaluatePageIsScanned,
} from "../src/services/documentProcessor.ts";

test("Phase 2 Safeguard 1: Configurable Processing Limits are Enforced", () => {
  assert.strictEqual(DIGITAL_PDF_MAX_PAGES, 50, "Digital PDF limit must be 50 pages");
  assert.strictEqual(SCANNED_PDF_MAX_PAGES, 5, "Scanned PDF limit must be 5 pages");
});

test("Phase 2 Safeguard 2: Deterministic Cache Key Generation", async () => {
  const sampleData = Buffer.from("Assignment brief for Economics 101: Evaluate fiscal policy impact.");
  const sha = crypto.createHash("sha256").update(sampleData).digest("hex");

  const calculatedSha = await computeSha256Hex(sampleData);
  assert.strictEqual(calculatedSha, sha, "computeSha256Hex must match canonical Node.js sha256");

  const cacheKey1 = await buildDeterministicCacheKey({
    fileBuffer: sampleData,
    fileType: "pdf",
    engineVersion: `pdfjs@${PDFJS_VERSION}_tesseract@${TESSERACT_VERSION}`,
  });

  const cacheKey2 = await buildDeterministicCacheKey({
    fileBuffer: sampleData,
    fileType: "pdf",
    engineVersion: `pdfjs@${PDFJS_VERSION}_tesseract@${TESSERACT_VERSION}`,
  });

  assert.strictEqual(cacheKey1, cacheKey2, "Identical inputs must yield identical cache keys");
  assert(cacheKey1.startsWith("ocr_pdf_"), "Cache key must carry format prefix");

  // Changing engine version must invalidate cache key
  const cacheKeyDiffEngine = await buildDeterministicCacheKey({
    fileBuffer: sampleData,
    fileType: "pdf",
    engineVersion: "pdfjs@4.0.0_tesseract@6.0.0",
  });
  assert.notStrictEqual(cacheKey1, cacheKeyDiffEngine, "Different engine versions must invalidate cache key");

  // Changing preprocessing params must invalidate cache key
  const cacheKeyDiffPreprocess = await buildDeterministicCacheKey({
    fileBuffer: sampleData,
    fileType: "pdf",
    engineVersion: `pdfjs@${PDFJS_VERSION}_tesseract@${TESSERACT_VERSION}`,
    preprocessing: { contrastBoost: 80, binarizeThreshold: 200 },
  });
  assert.notStrictEqual(cacheKey1, cacheKeyDiffPreprocess, "Different preprocessing configs must invalidate cache key");
});

test("Phase 2 Safeguard 3: Linguistic Stopword Analysis & Gibberish Detection", () => {
  const coherentAcademicText = `
    Assignment Title: Strategic Financial Management
    Module Code: FIN-4001
    Due Date: 2026-12-15
    Instructions:
    Critically evaluate the capital structure of a multinational enterprise.
    Students must discuss the trade-off theory and pecking order hypothesis,
    referencing academic literature using Harvard style.
    Maximum word count is 3000 words.
  `;

  const { ratio: goodRatio, totalWords } = calculateStopwordRatio(coherentAcademicText);
  assert(totalWords > 20, "Should detect substantial words in academic brief");
  assert(goodRatio > 0.50, `Coherent text should have > 50% academic stopword ratio (got ${goodRatio.toFixed(2)})`);
  assert.strictEqual(detectGibberishText(coherentAcademicText), false, "Coherent text must NOT be flagged as gibberish");

  const garbledOcrNoise = "xkqj 99283 zzz%% &&*! ajksdhf qpwoeiru zxncvb 109283 8847";
  assert.strictEqual(detectGibberishText(garbledOcrNoise), true, "Garbled OCR noise MUST be flagged as gibberish");

  const emptyText = "   ";
  assert.strictEqual(detectGibberishText(emptyText), true, "Empty text must be flagged as gibberish");
});

test("Phase 2 Safeguard 4: PDF Digital vs Scanned Discrimination Heuristics", () => {
  // Case 1: Page with zero text layer items (pure image scan)
  assert.strictEqual(
    evaluatePageIsScanned(0, ""),
    true,
    "Page with 0 items must be identified as scanned"
  );

  // Case 2: Page with 1 item that is just a page number or artifact
  assert.strictEqual(
    evaluatePageIsScanned(1, "1"),
    true,
    "Page with < 25 chars must be identified as scanned"
  );

  // Case 3: Page with garbled text items from poor OCR layer
  assert.strictEqual(
    evaluatePageIsScanned(15, "xkqj 99283 zzz%% &&*! ajksdhf qpwoeiru zxncvb 109283 8847"),
    true,
    "Page with garbled OCR text must be identified as scanned"
  );

  // Case 4: True digital PDF page with structured academic text
  const digitalPageText = "Course: Business Analytics. Final Essay Question 1: Analyze quarterly sales trends and present findings.";
  assert.strictEqual(
    evaluatePageIsScanned(20, digitalPageText),
    false,
    "Valid digital page with text items and vocabulary must be identified as digital"
  );
});

test("Phase 2 Safeguard 5: Canvas Preprocessing Configuration Validity", () => {
  assert.strictEqual(PREPROCESSING_CONFIG.minWidth, 800, "Minimum width must be 800px");
  assert.strictEqual(PREPROCESSING_CONFIG.contrastBoost, 35, "Contrast boost factor must be 35");
  assert.strictEqual(PREPROCESSING_CONFIG.binarizeThreshold, 128, "Binarize threshold must be 128");
  assert.strictEqual(PREPROCESSING_CONFIG.grayscale, true, "Grayscale conversion must be active");
  assert.strictEqual(PREPROCESSING_CONFIG.blendAlphaWithWhite, true, "Alpha blending with white must be active");
});

test("Phase 2 Safeguard 6: Memory Cleanup Helper Safety", () => {
  // Should handle null or empty canvases gracefully without throwing
  assert.doesNotThrow(() => cleanupCanvas(null), "cleanupCanvas(null) must not throw");

  const dummyCanvas = {
    width: 1000,
    height: 800,
    getContext: () => ({
      clearRect: () => {},
    }),
  };

  cleanupCanvas(dummyCanvas);
  assert.strictEqual(dummyCanvas.width, 0, "Canvas width must be reset to 0");
  assert.strictEqual(dummyCanvas.height, 0, "Canvas height must be reset to 0");
});

test("Phase 2 Safeguard 7: Firebase Spark Plan & Zero Paid Services Invariant", () => {
  // Verify that frontend package.json does not depend on paid Google Cloud packages
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  assert(!deps["@google-cloud/vertexai"], "Vertex AI package must NOT be installed");
  assert(!deps["@google-cloud/tasks"], "Cloud Tasks must NOT be installed");
  assert(!deps["@google-cloud/run"], "Cloud Run must NOT be installed");

  // Verify that frontend .env.local does not expose Gemini API keys
  if (fs.existsSync(".env.local")) {
    const envLocal = fs.readFileSync(".env.local", "utf-8");
    assert(!envLocal.includes("GEMINI_API_KEY"), ".env.local must NOT expose GEMINI_API_KEY");
  }
});
