process.env.NODE_ENV = "test";
import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";

// Frontend modules
import {
  parseOCRText as parseClientText,
  detectLanguageFromText as detectClientLanguage,
  parseDateToYMD,
} from "../src/utils/ocrParser.ts";
import {
  calculateAssignmentPricing as calculateClientPricing,
  getDaysUntilDeadline as calculateClientDays,
  calculateCommissionBreakdown,
  ACADEMIC_LEVEL_RATES,
} from "../src/utils/pricing.ts";
import {
  calculateStopwordRatio,
  detectGibberishText,
  evaluatePageIsScanned,
  PREPROCESSING_CONFIG,
  OCR_DEFAULT_LANG,
} from "../src/services/documentProcessor.ts";

// Backend modules
import {
  parseTextToAssignmentFields as parseBackendText,
  detectLanguageFromText as detectBackendLanguage,
} from "../backend/dist/services/ocrProcessingService.js";

// ============================================================================
// ARCHETYPE 1: English Digital PDF (Selectable text layer priority)
// ============================================================================
test("Archetype 1: English Digital Assignment with Selectable Text Prioritization", () => {
  const docText = `
Assignment Title: Strategic Marketing and Consumer Behavior Analysis
Course Code: MKT-301
Instructor: Prof. Angela Mwape

Instructions:
Evaluate the role of social proof and neuromarketing in digital subscription businesses.
Students must conduct a critical appraisal of cognitive biases in purchasing decisions.
Referencing Style: Harvard
Word Count: 3,000 words
Submission Deadline: 2026-12-10
`;

  // Verify that linguistic detection correctly identifies digital English academic text
  assert.strictEqual(detectGibberishText(docText), false, "Must NOT be classified as gibberish");
  assert.strictEqual(evaluatePageIsScanned(25, docText), false, "Must prioritize digital text over scanned OCR");

  // Client parsing
  const clientParsed = parseClientText(docText);
  assert.strictEqual(clientParsed.language, "English", "Must detect English language");
  assert.strictEqual(clientParsed.title, "Strategic Marketing and Consumer Behavior Analysis");
  assert.strictEqual(clientParsed.referencingStyle, "Harvard");
  assert.strictEqual(clientParsed.wordCount, 3000);
  assert.strictEqual(clientParsed.deadline, "2026-12-10");
  assert.strictEqual(clientParsed.pageCount, 12, "3000 words must calculate to 12 pages");

  // Field confidence check
  assert(clientParsed.field_confidences, "Field confidences object must exist");
  assert.strictEqual(clientParsed.field_confidences.assignment_title?.confidence, "high");
  assert.strictEqual(clientParsed.field_confidences.referencing_style?.confidence, "high");
  assert.strictEqual(clientParsed.field_confidences.submission_deadline?.confidence, "high");
  assert.strictEqual(clientParsed.field_confidences.word_count?.confidence, "high");

  // Backend parity
  const backendParsed = parseBackendText(docText);
  assert.strictEqual(backendParsed.language, "English");
  assert.strictEqual(backendParsed.title, "Strategic Marketing and Consumer Behavior Analysis");
  assert.strictEqual(backendParsed.pageCount, 12);
});

// ============================================================================
// ARCHETYPE 2: Scanned OCR Noise & Garbled Document Discrimination
// ============================================================================
test("Archetype 2: Degraded OCR noise & Garbled Scan Discrimination", () => {
  const garbledNoise = "xkqj 99283 zzz%% &&*! ajksdhf qpwoeiru zxncvb 109283 8847";
  assert.strictEqual(detectGibberishText(garbledNoise), true, "Garbled text must be flagged as gibberish");
  assert.strictEqual(evaluatePageIsScanned(15, garbledNoise), true, "Garbled text must trigger scanned OCR flow");

  // Multi-language OCR default includes French
  assert(OCR_DEFAULT_LANG.includes("eng"), "OCR must support English");
  assert(OCR_DEFAULT_LANG.includes("fra"), "OCR must support French without translation");
});

// ============================================================================
// ARCHETYPE 3: Multilingual Document (French Academic Brief)
// ============================================================================
test("Archetype 3: French Academic Assignment Document (No Auto-Translation)", () => {
  const frenchDoc = `
Université de Kinshasa
Faculté des Sciences Économiques et de Gestion
Année Académique 2026-2027

Titre du Devoir: Analyse Macroéconomique de l'Inflation et de la Politique Monétaire
Niveau: Licence
Date Limite: 15 décembre 2026

Consignes et Questions:
Analyser l'impact de la politique monétaire de la banque centrale sur le taux de change
et la stabilité des prix dans les économies en développement.
Veuillez rédiger 6 pages au format académique standard.
`;

  const detectedLang = detectClientLanguage(frenchDoc);
  assert.strictEqual(detectedLang, "French", "Must accurately identify French language");

  // Client parsing
  const parsed = parseClientText(frenchDoc);
  assert.strictEqual(parsed.language, "French");
  assert.strictEqual(parsed.title, "Analyse Macroéconomique de l'Inflation et de la Politique Monétaire");
  assert.strictEqual(parsed.academicLevel, "degree", "Licence maps to degree level");
  assert.strictEqual(parsed.deadline, "2026-12-15", "French month décembre parsed to ISO 2026-12-15");
  assert.strictEqual(parsed.pageCount, 6, "Must extract 6 pages directly from French prompt");
  assert(parsed.guidelines?.includes("Analyser l'impact de la politique monétaire"), "Must preserve original French text verbatim");

  // Backend parity
  const backendParsed = parseBackendText(frenchDoc);
  assert.strictEqual(backendParsed.language, "French");
  assert.strictEqual(backendParsed.title, "Analyse Macroéconomique de l'Inflation et de la Politique Monétaire");
  assert.strictEqual(backendParsed.pageCount, 6);
  assert.strictEqual(backendParsed.deadline, "2026-12-15");
});

// ============================================================================
// ARCHETYPE 4: Heavy Institutional Cover Page & Page Footers
// ============================================================================
test("Archetype 4: Document with Institutional Headers & Page Footers ('Page 10 of 12')", () => {
  const multiPageDoc = `
COPPERBELT UNIVERSITY
SCHOOL OF MINES AND MINERAL SCIENCES
DEPARTMENT OF METALLURGICAL ENGINEERING
STUDENT NAME: MWANSA CHAMA
STUDENT ID: CBU-2023-4412
COURSE: MET 420 - HYDROMETALLURGICAL PROCESSES

Leaching Kinetics of Low-Grade Copper Oxide Ores in Sulfuric Acid Media

Instructions:
Evaluate the shrinking core model for chemical and diffusion control.
Compare agitation leaching against heap leaching recovery rates.

Page 10 of 12
`;

  const parsed = parseClientText(multiPageDoc);
  assert.notStrictEqual(parsed.title?.toUpperCase(), "COPPERBELT UNIVERSITY", "Must not select University header");
  assert.notStrictEqual(parsed.title?.toUpperCase(), "SCHOOL OF MINES AND MINERAL SCIENCES", "Must not select School header");
  assert.notStrictEqual(parsed.title?.toUpperCase(), "STUDENT NAME: MWANSA CHAMA", "Must not select student metadata");
  assert.strictEqual(
    parsed.title,
    "Leaching Kinetics of Low-Grade Copper Oxide Ores in Sulfuric Acid Media",
    "Must select actual research title"
  );

  // Crucial pricing safeguard: 'Page 10 of 12' footer must NOT inflate requested page count to 10
  assert.notStrictEqual(parsed.requested_page_count, 10, "Page footer must NOT dictate assignment page budget");
  assert.strictEqual(parsed.field_confidences?.requested_page_count?.confidence, "low", "Ambiguous page budget must have low confidence");
});

// ============================================================================
// ARCHETYPE 5: Missing Deadline and Referencing Style (Strict Null + Review)
// ============================================================================
test("Archetype 5: Incomplete Document leaves missing fields blank and flags review", () => {
  const briefWithMissingFields = `
Assignment Title: Software Architecture Patterns in Distributed Microservices
Instructions:
Compare event-driven choreography with centralized orchestration.
Discuss saga pattern implementations for distributed transactional consistency.
`;

  const parsed = parseClientText(briefWithMissingFields);
  assert.strictEqual(parsed.title, "Software Architecture Patterns in Distributed Microservices");
  assert.strictEqual(parsed.submission_deadline, null, "Missing deadline must be strictly null");
  assert.strictEqual(parsed.referencing_style, null, "Missing referencing style must be strictly null");
  assert.strictEqual(parsed.requested_page_count, null, "Missing page count must be strictly null");

  assert(parsed.fields_requiring_review?.includes("submission_deadline"), "Must flag deadline for review");
  assert(parsed.fields_requiring_review?.includes("referencing_style"), "Must flag referencing style for review");
  assert(parsed.fields_requiring_review?.includes("requested_page_count"), "Must flag page count for review");

  assert.strictEqual(parsed.field_confidences?.submission_deadline?.confidence, "low");
  assert.strictEqual(parsed.field_confidences?.referencing_style?.confidence, "low");
  assert.strictEqual(parsed.field_confidences?.requested_page_count?.confidence, "low");
});

// ============================================================================
// PHASE 2 & 4 AUDIT: Customer Interface Cleanup & Commission Protection
// ============================================================================
test("Phase 2 & 4: Customer views contain zero technical diagnostics and zero commission percentages", () => {
  const uploadPageContent = fs.readFileSync("src/app/(private)/projects/upload/page.tsx", "utf-8");

  // 1. Commission percentage leakage check (Phase 4 requirement)
  // Must NOT show writer/proofreader percentage splits in customer views
  assert(!uploadPageContent.includes("Writer Allocation Share (50%)"), "Must NOT show writer percentage in customer view");
  assert(!uploadPageContent.includes("Proofreader Reviewer Allocation (16.67%)"), "Must NOT show proofreader percentage in customer view");
  assert(!uploadPageContent.includes("DataBoy Platform Escrow Fee (33.33%)"), "Must NOT show platform percentage in customer view");
  assert(!uploadPageContent.includes("60% writer"), "Must not expose internal writer split");
  assert(!uploadPageContent.includes("15% proofreader"), "Must not expose internal proofreader split");
  assert(!uploadPageContent.includes("25% DataBoy"), "Must not expose internal platform split");

  // 2. Technical diagnostics console must NOT be in customer flow (Phase 2 requirement)
  assert(!uploadPageContent.includes("🛠️ OCR Diagnostics Console (Temporary)"), "Temporary OCR diagnostics console must be removed from customer flow");
  assert(!uploadPageContent.includes("Cost & Engine"), "Engine cost stats must not be visible to students");
  assert(!uploadPageContent.includes("0.00 USD (Local Free)"), "Internal cost estimates must not be shown to students");

  // 3. User-friendly states verification
  assert(uploadPageContent.includes("Uploading your document securely..."), "Must include friendly uploading state");
  assert(uploadPageContent.includes("Extracting assignment information..."), "Must include friendly extraction state");
  assert(uploadPageContent.includes("Processing document layout and text..."), "Must include friendly processing state");

  // 4. Milestone Escrow reassurance card
  assert(uploadPageContent.includes("DataBoy Milestone Escrow"), "Must feature transparent customer milestone escrow notice");
  assert(uploadPageContent.includes("AI-Free & Protected"), "Must reassure student of quality guarantees");

  // 5. 7-Step Workflow Step Tracker check (Phase 3 requirement)
  assert(uploadPageContent.includes("Assignment Workflow"), "Must feature visual 7-step workflow tracker");
  assert(uploadPageContent.includes("Step "), "Must display current step indicator");
});

// ============================================================================
// PHASE 4 INVARIANT: Internal Commission Math Remains Intact
// ============================================================================
test("Phase 4: Platform internal commission formulas remain intact and accurate", () => {
  const totalBudget = 300;
  const breakdown = calculateCommissionBreakdown(totalBudget);

  // Writer 50% (K150), Proofreader 16.67% (K50), DataBoy 33.33% (K100)
  assert.strictEqual(breakdown.writer, 150, "Writer allocation must be exactly 50%");
  assert.strictEqual(Math.round(breakdown.proofreader), 50, "Proofreader allocation must be approx 16.67%");
  assert.strictEqual(Math.round(breakdown.databoy), 100, "Platform escrow fee must be approx 33.33%");
  assert.strictEqual(breakdown.writer + breakdown.proofreader + breakdown.databoy, totalBudget, "Allocations must sum exactly to total");
});

// ============================================================================
// PHASE 5: Mobile Responsiveness & Tap Targets
// ============================================================================
test("Phase 5: Mobile inputs satisfy touch target guidelines and zero overflow", () => {
  const inputComponentContent = fs.readFileSync("src/components/ui/Input.tsx", "utf-8");
  assert(inputComponentContent.includes("min-h-[44px]"), "Form inputs must enforce minimum 44px touch targets");

  const uploadPageContent = fs.readFileSync("src/app/(private)/projects/upload/page.tsx", "utf-8");
  assert(uploadPageContent.includes("overflow-x-hidden"), "Page container must prevent horizontal overflow");
  assert(uploadPageContent.includes("w-full"), "Full width responsive layout enforced");
});
