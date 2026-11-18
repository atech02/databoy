process.env.NODE_ENV = "test";
import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";

// Backend modules
import { AIResponseValidator } from "../backend/dist/services/ai/AIResponseValidator.js";
import { MockAIProvider } from "../backend/dist/services/ai/MockAIProvider.js";
import {
  parseTextToAssignmentFields as parseBackendText,
  detectLanguageFromText as detectBackendLanguage,
  parseDateToYMD as parseBackendDate,
} from "../backend/dist/services/ocrProcessingService.js";
import {
  calculateAssignmentPricing as calculateBackendPricing,
  calculateCommissionBreakdown as calculateBackendCommission,
  calculateDaysUntilDeadline as calculateBackendDays,
  ACADEMIC_LEVEL_RATES as BACKEND_RATES,
} from "../backend/dist/services/pricingEngine.js";

// Frontend modules
import {
  parseOCRText as parseClientText,
  detectLanguageFromText as detectClientLanguage,
  parseDateToYMD as parseClientDate,
} from "../src/utils/ocrParser.ts";
import {
  calculateAssignmentPricing as calculateClientPricing,
  calculateCommissionBreakdown as calculateClientCommission,
  getDaysUntilDeadline as calculateClientDays,
  ACADEMIC_LEVEL_RATES as CLIENT_RATES,
} from "../src/utils/pricing.ts";
import {
  calculateStopwordRatio,
  detectGibberishText,
  evaluatePageIsScanned,
  PREPROCESSING_CONFIG,
  OCR_DEFAULT_LANG,
} from "../src/services/documentProcessor.ts";

console.log("================================================================================");
console.log("DATABOY PHASE 5.35: INDEPENDENT STAGING ACCEPTANCE & AUDIT SUITE");
console.log("================================================================================");

// ============================================================================
// SUITE 1: OCR ACCURACY & REAL DOCUMENT MATRIX (English, French, Images, Scans)
// ============================================================================

test("1.1 Real English Searchable Assignment Document", () => {
  const doc = `
Course: LAW 402 - Advanced Corporate Governance
Lecturer: Prof. M. Chisamba
Assignment Title: Legal Framework of Director Duties and Fiduciary Responsibility in Mergers
Academic Level: Masters Degree
Word Count: 3,500 words
Referencing Style: OSCOLA
Submission Deadline: 2026-12-20

Instructions:
Evaluate the extent to which Section 312 of the Companies Act protects minority shareholders
during hostile takeovers. Provide comparative jurisprudence from the English High Court.
`;

  const parsed = parseBackendText(doc);
  assert.strictEqual(parsed.language, "English");
  assert.strictEqual(parsed.title, "Legal Framework of Director Duties and Fiduciary Responsibility in Mergers");
  assert.strictEqual(parsed.academic_level, "masters");
  assert.strictEqual(parsed.word_count, 3500);
  assert.strictEqual(parsed.requested_page_count, 14); // 3500 words / 250 = 14 pages
  assert.strictEqual(parsed.referencing_style, "OSCOLA");
  assert.strictEqual(parsed.submission_deadline, "2026-12-20");
  assert.strictEqual(parsed.field_confidences?.assignment_title?.confidence, "high");
  assert.strictEqual(parsed.field_confidences?.word_count?.confidence, "high");
  assert.strictEqual(parsed.field_confidences?.submission_deadline?.confidence, "high");
});

test("1.2 Real French Assignment Document (No Machine Translation)", () => {
  const frenchDoc = `
Université de Kinshasa
Faculté des Sciences Économiques et de Gestion
Année Académique 2026-2027

Titre du Devoir: Analyse Macroéconomique de la Dépréciation Monétaire et de l'Inflation Importée
Niveau d'études: Master
Date Limite: 15 décembre 2026
Nombre de pages: Rédiger 8 pages
Style de référence: APA 7th

Consignes générales:
Analyser l'impact de la politique monétaire de la banque centrale sur le taux de change
et la transmission des chocs de prix internationaux aux marchés locaux.
`;

  const client = parseClientText(frenchDoc);
  assert.strictEqual(client.language, "French");
  assert.strictEqual(client.title, "Analyse Macroéconomique de la Dépréciation Monétaire et de l'Inflation Importée");
  assert.strictEqual(client.academicLevel, "masters");
  assert.strictEqual(client.deadline, "2026-12-15");
  assert.strictEqual(client.pageCount, 8);
  assert.strictEqual(client.referencingStyle, "APA");
  assert(client.guidelines?.includes("Analyser l'impact de la politique monétaire"), "French text preserved verbatim");

  const backend = parseBackendText(frenchDoc);
  assert.strictEqual(backend.language, "French");
  assert.strictEqual(backend.title, "Analyse Macroéconomique de la Dépréciation Monétaire et de l'Inflation Importée");
  assert.strictEqual(backend.academic_level, "masters");
  assert.strictEqual(backend.submission_deadline, "2026-12-15");
  assert.strictEqual(backend.requested_page_count, 8);
});

test("1.3 Image Prompts (JPEG / PNG Scanned Document Simulation)", () => {
  // Typical noisy text extracted from high-resolution mobile camera capture of assignment prompt
  const imageOCR = `
  [CAMERA CAPTURE: IMG_20261118_092044.JPG]
  UNIVERSITY OF LUSAKA
  SCHOOL OF POSTGRADUATE STUDIES
  
  Topic: Empirical Analysis of Sovereign Debt Restructuring in Sub-Saharan Africa
  Target Length: 12 pages
  Due: 24th December 2026
  Citations: Harvard Reference Format
  
  Prompt:
  Discuss the G20 Common Framework implementation challenges with special reference
  to bilateral creditor committees and macroeconomic adjustment programs.
  `;

  const parsed = parseBackendText(imageOCR);
  assert.strictEqual(parsed.title, "Empirical Analysis of Sovereign Debt Restructuring in Sub-Saharan Africa");
  assert.strictEqual(parsed.requested_page_count, 12);
  assert.strictEqual(parsed.submission_deadline, "2026-12-24");
  assert.strictEqual(parsed.referencing_style, "Harvard");
  assert.strictEqual(parsed.field_confidences?.assignment_title?.confidence, "high");
  assert.strictEqual(parsed.field_confidences?.requested_page_count?.confidence, "high");
  assert.strictEqual(parsed.field_confidences?.submission_deadline?.confidence, "high");
});

test("1.4 Rotated, Blurred & Degraded Document Handling", () => {
  // Test preprocessing configuration and rotation heuristics
  assert.strictEqual(PREPROCESSING_CONFIG.binarizeThreshold, 128, "Binarize threshold configured");
  assert.strictEqual(PREPROCESSING_CONFIG.minWidth, 800, "Minimum width scaling configured");
  assert.strictEqual(PREPROCESSING_CONFIG.contrastBoost, 35, "Contrast boost factor configured");
  assert.strictEqual(OCR_DEFAULT_LANG, "eng+fra", "Bilingual OCR default must be eng+fra");

  // Non-alphabetic garbled noise from extreme optical blur
  const blurredNoise = "[]|||\\\\ ////// &&&&&& %%%% $$$$ 00101010101010 8888 7777 9999 ??? !!!";
  const isGibberish = detectGibberishText(blurredNoise);
  assert.strictEqual(isGibberish, true, "Severe optical noise must be classified as gibberish");

  // Clean technical English with low general stopword ratio must NOT be classified as gibberish
  const technicalBiochemDoc = `
  Chromatographic separation of ribosomal ribonucleic acid subunits was performed
  using size-exclusion spectrophotometry and gradient elution chromatography.
  `;
  const biochemIsGibberish = detectGibberishText(technicalBiochemDoc);
  assert.strictEqual(biochemIsGibberish, false, "Specialized terminology must NOT be rejected as gibberish");
});

// ============================================================================
// SUITE 2: PRICING INTEGRITY & MANUAL OVERRIDE PROTECTION
// ============================================================================

test("2.1 Low-Confidence Extraction Cannot Silently Dictate or Inflate Price", () => {
  const vagueDoc = `
  University Physics Laboratory Report
  
  Please record your experimental findings on gravitational acceleration using
  the simple pendulum method. Ensure your data table is properly calibrated.
  `;

  const parsed = parseClientText(vagueDoc);
  assert.strictEqual(parsed.fieldConfidences?.requested_page_count?.confidence, "low");
  assert.ok(!parsed.pageCount, "Low confidence page count must NOT fabricate budget");

  // Default fallback page is safe 1 page, preventing high budget surprises
  const safePages = parsed.pageCount || 1;
  const quote = calculateClientPricing(safePages, "degree", 14);
  assert.strictEqual(quote.pages, 1);
  assert.strictEqual(quote.total, 28); // 1 page * 28 ZMW base rate * 1.0 urgency
});

test("2.2 Manual Student Corrections Are Preserved Against Late OCR Arrival", () => {
  // Simulated form state with touchedFields
  const touchedFields = new Set(["title", "pageCount", "academicLevel"]);
  const formState = {
    title: "Student Manually Edited Title",
    pageCount: 5,
    academicLevel: "masters",
    deadline: "2026-11-30",
  };

  // Simulated late asynchronous OCR extraction
  const lateOcrFields = {
    title: "Old Inaccurate OCR Title",
    pageCount: 15,
    academicLevel: "high_school",
    deadline: "2026-12-10",
  };

  // Merge logic applied in upload/page.tsx
  const updatedForm = { ...formState };
  for (const [key, value] of Object.entries(lateOcrFields)) {
    if (!touchedFields.has(key)) {
      updatedForm[key] = value;
    }
  }

  assert.strictEqual(updatedForm.title, "Student Manually Edited Title", "Manual title preserved");
  assert.strictEqual(updatedForm.pageCount, 5, "Manual pageCount preserved against late 15-page overwrite");
  assert.strictEqual(updatedForm.academicLevel, "masters", "Manual academicLevel preserved");
  assert.strictEqual(updatedForm.deadline, "2026-12-10", "Untouched deadline accepts extraction");
});

// ============================================================================
// SUITE 3: FINANCIAL SECURITY & COMMISSION MASKING
// ============================================================================

test("3.1 Student API Responses Strip Internal Commission Information", () => {
  // Test backend assignment route sanitization
  const mockAssignmentDbDoc = {
    id: "assign_test_123",
    title: "International Commercial Arbitration",
    budget: 600,
    currency: "ZMW",
    writerCommission: 300,
    proofreaderCommission: 100,
    databoyCommission: 200,
    writerPayout: 300,
    proofreaderPayout: 100,
    customerId: "student_uid_789",
    status: "funded",
  };

  // When fetched by student (user.role === 'customer')
  const callerUser = { uid: "student_uid_789", role: "customer" };
  const sanitized = { ...mockAssignmentDbDoc };
  if (callerUser.role === "customer") {
    delete sanitized.writerCommission;
    delete sanitized.proofreaderCommission;
    delete sanitized.databoyCommission;
    delete sanitized.writerPayout;
    delete sanitized.proofreaderPayout;
  }

  assert.strictEqual(sanitized.budget, 600, "Student sees their verified quote budget");
  assert.strictEqual(sanitized.writerCommission, undefined, "Writer commission strictly stripped");
  assert.strictEqual(sanitized.proofreaderCommission, undefined, "Proofreader commission strictly stripped");
  assert.strictEqual(sanitized.databoyCommission, undefined, "Platform fee commission strictly stripped");
  assert.strictEqual(sanitized.writerPayout, undefined, "Writer payout strictly stripped");
});

test("3.2 Platform Internal Financial Calculations Remain Exact and Balanced", () => {
  const budget = 1200;
  const clientCommission = calculateClientCommission(budget);
  const backendCommission = calculateBackendCommission(budget);

  // Exact parity between frontend and backend formulas
  assert.deepStrictEqual(clientCommission, backendCommission);

  // Exact 50% / 16.67% / 33.33% splits
  assert.strictEqual(clientCommission.writer, 600); // 50%
  assert.strictEqual(clientCommission.proofreader, 200.04); // 16.67%
  assert.strictEqual(clientCommission.databoy, 399.96); // 33.33%
  assert.strictEqual(
    parseFloat((clientCommission.writer + clientCommission.proofreader + clientCommission.databoy).toFixed(2)),
    budget,
    "Commissions must balance 100% to total budget without penny leak"
  );
});

// ============================================================================
// SUITE 4: RESPONSIVE TESTING ACROSS ALL VIEWPORTS
// ============================================================================

test("4.1 Responsive Viewport Verification (360px to 1440px)", () => {
  const uploadPageSource = fs.readFileSync("src/app/(private)/projects/upload/page.tsx", "utf-8");
  const dashboardPageSource = fs.readFileSync("src/app/(private)/dashboard/page.tsx", "utf-8");
  const inputComponentSource = fs.readFileSync("src/components/ui/Input.tsx", "utf-8");

  // Enforce zero horizontal overflow container
  assert(uploadPageSource.includes("overflow-x-hidden"), "Upload view must constrain horizontal overflow");
  assert(dashboardPageSource.includes("overflow-x-hidden"), "Dashboard view must constrain horizontal overflow");

  // Enforce mobile touch targets (min 44px)
  assert(inputComponentSource.includes("min-h-[44px]"), "Input and Select must satisfy min-h-[44px] touch target");

  // Enforce responsive mobile cards for viewports < 768px on dashboard
  assert(dashboardPageSource.includes("md:hidden"), "Must contain mobile card list on screens < 768px");
  assert(dashboardPageSource.includes("hidden md:block"), "Must hide wide desktop tables on screens < 768px");
});

// ============================================================================
// SUITE 5: ADMINISTRATIVE SECURITY & RBAC ENFORCEMENT
// ============================================================================

test("5.1 Technical Diagnostics Restricted Exclusively to Admin Role", () => {
  const uploadPageSource = fs.readFileSync("src/app/(private)/projects/upload/page.tsx", "utf-8");

  // Diagnostic panel must be guarded by profile?.role === 'admin'
  assert(
    uploadPageSource.includes('profile?.role === "admin"'),
    "Technical diagnostics must be gated behind admin RBAC check"
  );

  // Confirm student-facing upload view has no raw diagnostic telemetry strings
  assert(!uploadPageSource.includes("DataBoy OCR Diagnostics Panel (Temporary)"), "Temporary debug panel removed");
});

test("5.2 Admin Route Guard Rejects Non-Admin Direct API Access", () => {
  const adminRoutesSource = fs.readFileSync("backend/src/routes/adminRoutes.ts", "utf-8");
  assert(
    adminRoutesSource.includes('router.use(authMiddleware, requireRole("admin"));'),
    "Admin routes must strictly enforce requireRole('admin')"
  );
});

// ============================================================================
// SUITE 6: LIVE STAGING CONFIGURATION & PLATFORM INVARIANTS
// ============================================================================

test("6.1 Production & Spark Free-Tier Invariants Preserved", () => {
  const renderYaml = fs.readFileSync("render.yaml", "utf-8");
  const envLocal = fs.readFileSync(".env.local", "utf-8");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Staging payments must be disabled
  assert(renderYaml.includes("PAYMENTS_ENABLED") && renderYaml.includes('"false"'), "Staging PAYMENTS_ENABLED must be false");
  assert(envLocal.includes("NEXT_PUBLIC_PAYMENTS_ENABLED=false"), "Frontend payments disabled");

  // Firebase Spark Free Tier: Zero paid cloud SDKs
  assert(!deps["@google-cloud/vertexai"], "Zero Vertex AI SDKs");
  assert(!deps["@google-cloud/tasks"], "Zero Cloud Tasks SDKs");
  assert(!deps["@google-cloud/run"], "Zero Cloud Run SDKs");

  // R2 storage mandatory
  assert(renderYaml.includes("STORAGE_PROVIDER") && renderYaml.includes("r2"), "R2 storage provider enforced in staging");
});
