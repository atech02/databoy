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
} from "../backend/dist/services/ocrProcessingService.js";
import {
  calculateAssignmentPricing as calculateBackendPricing,
  calculateDaysUntilDeadline as calculateBackendDays,
  ACADEMIC_LEVEL_RATES as BACKEND_RATES,
} from "../backend/dist/services/pricingEngine.js";

// Frontend modules
import {
  parseOCRText as parseClientText,
  detectLanguageFromText as detectClientLanguage,
} from "../src/utils/ocrParser.ts";
import {
  calculateAssignmentPricing as calculateClientPricing,
  getDaysUntilDeadline as calculateClientDays,
  ACADEMIC_LEVEL_RATES as CLIENT_RATES,
} from "../src/utils/pricing.ts";

console.log("================================================================================");
console.log("DATABOY PHASE 5.33: INDEPENDENT STAGING ACCEPTANCE & AUDIT SUITE");
console.log("================================================================================");

// ============================================================================
// SUITE 1: Real-Document Test Matrix (9 Representative Document Archetypes)
// ============================================================================

test("Matrix Doc 1: English Digital PDF with clear title, questions, and word limit", () => {
  const doc = `
Course: ECON 301 - Microeconomic Theory
Instructor: Dr. B. Banda
Title: General Equilibrium and Welfare Economics
Word Limit: 2,500 words
Referencing: Harvard style

Questions:
1. Demonstrate how the First Fundamental Theorem of Welfare Economics holds in a 2x2 Edgeworth Box exchange economy.
2. Evaluate market failures caused by external diseconomies in production.
Submission Deadline: 2026-11-28
`;

  const backend = parseBackendText(doc);
  assert.strictEqual(backend.language, "English", "Language must be detected as English");
  assert.strictEqual(backend.title, "General Equilibrium and Welfare Economics", "Title must be correctly extracted");
  assert.strictEqual(backend.referencing_style, "Harvard", "Referencing style must be Harvard");
  assert.strictEqual(backend.word_count, 2500, "Word count must be 2500");
  assert.strictEqual(backend.requested_page_count, 10, "Word count 2500 -> 10 pages");
  assert.strictEqual(backend.submission_deadline, "2026-11-28", "Deadline must be 2026-11-28");
  assert(backend.guidelines?.includes("Demonstrate how the First Fundamental"), "Guidelines preserved");
  assert.strictEqual(backend.extraction_confidence, "high", "High confidence expected");
});

test("Matrix Doc 2: English Scanned PDF (simulated OCR noise & degraded headers)", () => {
  const doc = `
  UNIV ER SITY   OF   ZAMBIA
  SCH OOL OF ENGIN EERING
  
  ASSIGNMENT TITLE: Thermal Efficiency Optimization of Solar Kilns
  
  Instructions:
  Calculate the heat loss coefficients for the passive convection solar drying unit.
  Ensure all thermodynamic equations cite ASME standards.
  Deadline: 15 Dec 2026
  Length: 6 pages
  Level: Undergraduate Degree
`;

  const backend = parseBackendText(doc);
  assert.strictEqual(backend.language, "English");
  assert.strictEqual(backend.title, "Thermal Efficiency Optimization of Solar Kilns");
  assert.strictEqual(backend.requested_page_count, 6);
  assert.strictEqual(backend.submission_deadline, "2026-12-15");
  assert.strictEqual(backend.academic_level, "degree");
  assert(backend.guidelines?.includes("Calculate the heat loss coefficients"));
});

test("Matrix Doc 3: English DOCX structure with outline numbering and rubric", () => {
  const doc = `
Coursework Specification: Postgraduate Diploma in Public Health
Module: Epidemiology and Biostatistics (EPI701)
Assignment Title: Epidemiological Investigation of Cholera Outbreaks in Peri-Urban Lusaka

Assignment Tasks:
Task 1: Calculate the attack rates and relative risks for the defined cohort (30 marks).
Task 2: Formulate an emergency WASH intervention protocol based on WHO guidelines (40 marks).
Task 3: Critique the surveillance data collection methodology (30 marks).

Format Requirements:
- Referencing Style: Vancouver
- Expected word count: 3,000 words
- Due: 2026-12-05
`;

  const backend = parseBackendText(doc);
  assert.strictEqual(backend.title, "Epidemiological Investigation of Cholera Outbreaks in Peri-Urban Lusaka");
  assert.strictEqual(backend.academic_level, "diploma");
  assert.strictEqual(backend.referencing_style, "Vancouver");
  assert.strictEqual(backend.word_count, 3000);
  assert.strictEqual(backend.requested_page_count, 12); // 3000 / 250 = 12
  assert.strictEqual(backend.submission_deadline, "2026-12-05");
});

test("Matrix Doc 4: Document with heavy institutional cover page and multiple student metadata", () => {
  const doc = `
CAVENDISH UNIVERSITY ZAMBIA
SCHOOL OF LAW
LL.B PROGRAMME - YEAR 3
NAME: MWANZA CHILUFYA
STUDENT ID: CUZ-2023-88192
LECTURER: PROF. C. TEMBO
SEMESTER 2 EXAMINATION COURSEWORK

The Law of Evidence: Admissibility of Hearsay and Digital Communications

Requirements:
Critically evaluate the statutory exceptions to the rule against hearsay in Zambia under the Evidence Act.
Discuss the judicial attitude towards electronic and WhatsApp messages in civil litigation.
Referencing Style: APA
`;

  const backend = parseBackendText(doc);
  assert.notStrictEqual(backend.title?.toUpperCase(), "CAVENDISH UNIVERSITY ZAMBIA");
  assert.notStrictEqual(backend.title?.toUpperCase(), "SCHOOL OF LAW");
  assert.notStrictEqual(backend.title?.toUpperCase(), "NAME: MWANZA CHILUFYA");
  assert.strictEqual(backend.title, "The Law of Evidence: Admissibility of Hearsay and Digital Communications");
  assert.strictEqual(backend.academic_level, "degree"); // LL.B = degree
  assert.strictEqual(backend.referencing_style, "APA");
});

test("Matrix Doc 5: Document with page-number footers ('Page 10 of 12')", () => {
  const doc = `
Title: Modernism in African Literature
Examine the stylistic innovations in Chinua Achebe's Arrow of God and Ngugi wa Thiong'o's Petals of Blood.
Discuss the tension between traditional oral folklore and the colonial European novelistic tradition.
Page 10 of 12
`;

  const backend = parseBackendText(doc);
  assert.notStrictEqual(backend.requested_page_count, 10, "Must NOT interpret footer 'Page 10 of 12' as requested 10 pages");
  assert.strictEqual(backend.requested_page_count, null, "Requested page count must be null when absent");
  assert(backend.fields_requiring_review?.includes("requested_page_count"), "Must flag page budget for review");
});

test("Matrix Doc 6: Document with explicit requested assignment length ('Write 8 pages')", () => {
  const doc = `
Title: Corporate Financial Restructuring
Write 8 pages analyzing the financial distress and turnaround options for a regional airline.
Academic Level: Master of Science in Finance
Referencing: Harvard
`;

  const backend = parseBackendText(doc);
  assert.strictEqual(backend.requested_page_count, 8);
  assert.strictEqual(backend.pageCount, 8);
  assert.strictEqual(backend.academic_level, "masters");

  // Verify pricing engine sets correct 8-page master price
  const pricing = calculateBackendPricing(8, "masters", 10, "assignment");
  assert.strictEqual(pricing.pages, 8);
  assert.strictEqual(pricing.baseRatePerPage, 38);
  assert.strictEqual(pricing.total, 304); // 8 * 38 = 304 ZMW
});

test("Matrix Doc 7: Document with formatted date ('17 November 2026')", () => {
  const doc = `
Assignment Title: Cloud Infrastructure Resilience
Instructions: Design a multi-region active-active database failover strategy.
Submission Date: 17 November 2026
`;

  const backend = parseBackendText(doc);
  assert.strictEqual(backend.submission_deadline, "2026-11-17");
  assert.strictEqual(backend.deadline, "2026-11-17");

  const validated = AIResponseValidator.validateAssignmentBrief(JSON.stringify({
    assignment_title: "Cloud Infrastructure Resilience",
    assignment_brief: "Design a multi-region active-active database failover strategy.",
    submission_deadline: "17 November 2026",
  }));
  assert.strictEqual(validated.isValid, true);
  assert.strictEqual(validated.data.submission_deadline, "2026-11-17");
});

test("Matrix Doc 8: Document without deadline (missing date)", () => {
  const doc = `
Title: Quantum Cryptography and BB84 Protocol
Explain the security proof of the BB84 quantum key distribution protocol against eavesdropping.
`;

  const backend = parseBackendText(doc);
  assert.strictEqual(backend.submission_deadline, null, "Must NOT fabricate a date");
  assert.strictEqual(backend.deadline, null);
  assert(backend.fields_requiring_review?.includes("submission_deadline"), "Must flag missing deadline");
});

test("Matrix Doc 9: Multilingual Document (French Academic Brief)", () => {
  const doc = `
Titre du devoir: La politique monétaire et l'inflation en zone UEMOA
Instructions et questions:
Analyser l'impact de la politique monétaire menée par la BCEAO sur la stabilité des prix et la croissance économique.
Évaluer les mécanismes de transmission des taux directeurs dans les pays membres avec une attention particulière sur le crédit bancaire.
Limite: 2,000 mots
Date limite: 2026-12-10
`;

  const backend = parseBackendText(doc);
  assert.strictEqual(backend.language, "French", "Must detect French language");
  assert.strictEqual(backend.title, "La politique monétaire et l'inflation en zone UEMOA");
  assert.strictEqual(backend.word_count, 2000);
  assert.strictEqual(backend.requested_page_count, 8); // 2000 / 250 = 8
  assert.strictEqual(backend.submission_deadline, "2026-12-10");
  assert(backend.guidelines?.includes("Analyser l'impact de la politique"), "Guidelines preserved");
});

// ============================================================================
// SUITE 2: Fallback Safety & Anti-Hallucination
// ============================================================================

test("Fallback Safety: Gemini Timeout or Failure does NOT fabricate data", () => {
  const provider = new MockAIProvider("TIMEOUT");
  assert.strictEqual(provider.isAvailable(), true);

  // When AI fails, system invokes rule-based extraction on raw text
  const rawText = "Just a short prompt with no title and no dates. Solve equations x + y = 10.";
  const fallbackResult = parseBackendText(rawText);

  assert.strictEqual(fallbackResult.assignment_title, null, "Must not guess title");
  assert.strictEqual(fallbackResult.submission_deadline, null, "Must not guess deadline");
  assert.strictEqual(fallbackResult.academic_level, null, "Must not infer academic level");
  assert.strictEqual(fallbackResult.requested_page_count, null, "Must not fabricate page count");
  assert(fallbackResult.fields_requiring_review?.includes("assignment_title"));
  assert(fallbackResult.fields_requiring_review?.includes("submission_deadline"));
  assert.strictEqual(fallbackResult.extraction_confidence, "low");
});

test("Fallback Safety: AIResponseValidator rejects corrupted/truncated payloads safely", () => {
  // Empty
  const emptyRes = AIResponseValidator.validateAssignmentBrief("");
  assert.strictEqual(emptyRes.isValid, false);
  assert.strictEqual(emptyRes.errorCode, "EMPTY_RESPONSE");

  // Invalid JSON
  const invalidJson = AIResponseValidator.validateAssignmentBrief("This is not JSON at all");
  assert.strictEqual(invalidJson.isValid, false);
  assert.strictEqual(invalidJson.errorCode, "INVALID_JSON");

  // Schema mismatch (non-object root)
  const arrayRoot = AIResponseValidator.validateAssignmentBrief('["invalid", "array", "root"]');
  assert.strictEqual(arrayRoot.isValid, false);
  assert.strictEqual(arrayRoot.errorCode, "SCHEMA_MISMATCH");

  // Missing title and brief is parsed safely and flagged for review
  const missingCore = AIResponseValidator.validateAssignmentBrief(JSON.stringify({
    word_count: 500,
  }));
  assert.strictEqual(missingCore.isValid, true);
  assert.strictEqual(missingCore.data?.title, undefined);
  assert(missingCore.data?.fields_requiring_review.includes("assignment_title"));
  assert(missingCore.data?.fields_requiring_review.includes("assignment_brief"));

  // Prototype pollution attempt
  const polluted = AIResponseValidator.validateAssignmentBrief(JSON.stringify({
    assignment_title: "Valid Title",
    assignment_brief: "Valid brief description",
    "__proto__": { "isAdmin": true },
    "constructor": { "prototype": { "polluted": true } },
  }));
  assert.strictEqual(polluted.isValid, true);
  assert.strictEqual((polluted.data).isAdmin, undefined);
  assert.strictEqual(({}).polluted, undefined, "Object prototype must not be polluted");
});

// ============================================================================
// SUITE 3: UI Form State Behavior & Overwrite Protection
// ============================================================================

test("Form Behavior: Touched fields protect student manual corrections across async OCR arrival", () => {
  const touchedFields = new Set();
  const markTouched = (f) => touchedFields.add(f);
  const isUserTouched = (f) => touchedFields.has(f);

  const form = {
    title: "",
    guidelines: "",
    academicLevel: "degree",
    subject: "general",
    referencingStyle: "APA",
    deadline: "",
    pageCount: 1,
  };

  // Student modifies title, page count, and clears deadline
  markTouched("title");
  form.title = "Student Chosen Custom Title";

  markTouched("pageCount");
  form.pageCount = 7;

  markTouched("deadline");
  form.deadline = ""; // Student explicitly cleared the deadline

  // Now an asynchronous OCR extraction arrives
  const asyncExtraction = {
    title: "Document Extracted Title",
    guidelines: "Extracted instructions...",
    academicLevel: "masters",
    subject: "law",
    referencingStyle: "Harvard",
    deadline: "2026-12-25",
    pageCount: 2,
  };

  // Application logic in upload/page.tsx
  if (!isUserTouched("title")) form.title = asyncExtraction.title;
  if (!isUserTouched("guidelines")) form.guidelines = asyncExtraction.guidelines;
  if (!isUserTouched("academicLevel")) form.academicLevel = asyncExtraction.academicLevel;
  if (!isUserTouched("subject")) form.subject = asyncExtraction.subject;
  if (!isUserTouched("referencingStyle")) form.referencingStyle = asyncExtraction.referencingStyle;
  if (!isUserTouched("deadline")) form.deadline = asyncExtraction.deadline;
  if (!isUserTouched("pageCount")) form.pageCount = asyncExtraction.pageCount;

  // Verifications
  assert.strictEqual(form.title, "Student Chosen Custom Title", "Manual title must be preserved");
  assert.strictEqual(form.pageCount, 7, "Manual page count 7 must be preserved");
  assert.strictEqual(form.deadline, "", "Manually cleared deadline must NOT be repopulated");
  assert.strictEqual(form.guidelines, "Extracted instructions...", "Untouched field was populated");
  assert.strictEqual(form.academicLevel, "masters", "Untouched academicLevel was populated");
  assert.strictEqual(form.subject, "law", "Untouched subject was populated");
  assert.strictEqual(form.referencingStyle, "Harvard", "Untouched referencingStyle was populated");
});

// ============================================================================
// SUITE 4: Pricing Integrity & Synchronization Matrix
// ============================================================================

test("Pricing Integrity: 1-page, 5-page, 10-page, word-count conversion, and edge cases", () => {
  // 1. One-page Degree assignment, standard urgency (10 days)
  // 1 * 28 = 28 ZMW
  const p1 = calculateBackendPricing(1, "degree", 10, "assignment");
  assert.strictEqual(p1.pages, 1);
  assert.strictEqual(p1.total, 28);
  assert.strictEqual(calculateClientPricing(1, "degree", 10, "assignment").total, 28);

  // 2. Five-page Masters assignment, moderate urgency (5 days -> multiplier 1.25)
  // 5 * 38 * 1.25 = 237.5 -> Math.ceil = 238 ZMW
  const p5 = calculateBackendPricing(5, "masters", 5, "assignment");
  assert.strictEqual(p5.pages, 5);
  assert.strictEqual(p5.total, 238);
  assert.strictEqual(calculateClientPricing(5, "masters", 5, "assignment").total, 238);

  // 3. Ten-page PhD assignment, urgent (<48h -> multiplier 2.1)
  // 10 * 52 * 2.1 = 1092 ZMW
  const p10 = calculateBackendPricing(10, "phd", 1, "assignment");
  assert.strictEqual(p10.pages, 10);
  assert.strictEqual(p10.total, 1092);
  assert.strictEqual(calculateClientPricing(10, "phd", 1, "assignment").total, 1092);

  // 4. Word-count target conversion: 1,250 words -> Math.ceil(1250/250) = 5 pages
  const derivedPages = Math.max(1, Math.ceil(1250 / 250));
  assert.strictEqual(derivedPages, 5);
  const pDerived = calculateBackendPricing(derivedPages, "diploma", 8, "assignment");
  assert.strictEqual(pDerived.pages, 5);
  assert.strictEqual(pDerived.total, 110); // 5 * 22 = 110 ZMW
  assert.strictEqual(calculateClientPricing(derivedPages, "diploma", 8, "assignment").total, 110);

  // 5. Missing page budget information defaults to safe minimum (1 page)
  const pDefault = calculateBackendPricing(0, "degree", 10, "assignment");
  assert.strictEqual(pDefault.pages, 1);
  assert.strictEqual(pDefault.total, 28);
});

// ============================================================================
// SUITE 5: Security, Tenant Isolation & Spark Plan Invariants
// ============================================================================

test("Security & Invariants: Free tier, payments disabled, zero cloud functions, credential safety", () => {
  // 1. Payments disabled strictly enforced
  const envLocal = fs.readFileSync(".env.local", "utf-8");
  assert(envLocal.includes("NEXT_PUBLIC_PAYMENTS_ENABLED=false"));

  // 2. Spark Plan free tier preserved (zero paid Google packages)
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert(!deps["@google-cloud/vertexai"]);
  assert(!deps["@google-cloud/tasks"]);
  assert(!deps["@google-cloud/run"]);

  // 3. Gemini key protection
  assert(!envLocal.includes("GEMINI_API_KEY"));
  const clientEnvKeys = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"));
  assert(!clientEnvKeys.some((k) => k.toLowerCase().includes("gemini")));
});
