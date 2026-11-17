process.env.NODE_ENV = "test";
import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";

// Backend modules
import { AIResponseValidator } from "../backend/dist/services/ai/AIResponseValidator.js";
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

// ============================================================================
// TEST A: Clearly written assignment (English)
// Language detected as English, title extracted, instructions preserved verbatim
// ============================================================================
test("Scenario A: Clearly written English assignment extracts cleanly", () => {
  const sampleDoc = `
Assignment Title: Corporate Governance & Business Ethics Case Study
Course: BUS 402 - Business Law & Corporate Governance
Instructor: Dr. Michael Mwanza

Instructions and Questions:
Discuss the principal-agent dilemma in the context of state-owned enterprises in Zambia.
Analyse how board composition, transparency mandates, and audit committee oversight
affect shareholder wealth maximization. Provide recommendations based on the King IV Report.
Word Limit: 2,500 words
Due Date: 2026-11-25
`;

  // 1. Backend extraction
  const backendResult = parseBackendText(sampleDoc);
  assert.strictEqual(backendResult.language, "English", "Backend must detect English language");
  assert.strictEqual(
    backendResult.title,
    "Corporate Governance & Business Ethics Case Study",
    "Backend must extract exact assignment title"
  );
  assert(
    backendResult.guidelines?.includes("Discuss the principal-agent dilemma"),
    "Backend must preserve assignment instructions verbatim"
  );
  assert(
    backendResult.guidelines?.includes("King IV Report"),
    "Backend must preserve full question context"
  );

  // 2. Client extraction
  const clientResult = parseClientText(sampleDoc);
  assert.strictEqual(clientResult.language, "English", "Client must detect English language");
  assert.strictEqual(
    clientResult.title,
    "Corporate Governance & Business Ethics Case Study",
    "Client must extract exact assignment title"
  );
  assert(
    clientResult.guidelines?.includes("Discuss the principal-agent dilemma"),
    "Client must preserve assignment instructions verbatim"
  );

  // 3. AI Schema Validator check
  const validated = AIResponseValidator.validateAssignmentBrief(JSON.stringify({
    assignment_title: "Corporate Governance & Business Ethics Case Study",
    assignment_brief: "Discuss the principal-agent dilemma in the context of state-owned enterprises in Zambia.",
    academic_level: "degree",
    subject_or_discipline: "business_finance",
    language: "English",
    word_count: 2500,
  }));

  assert.strictEqual(validated.isValid, true);
  assert(validated.data, "Validated data must exist");
  assert.strictEqual(validated.data.title, "Corporate Governance & Business Ethics Case Study");
  assert.strictEqual(validated.data.language, "English");
  assert.strictEqual(validated.data.word_count, 2500);
});

// ============================================================================
// TEST B: Repeated institutional header rejection
// University/School/Student headers must NOT be hallucinated as title
// ============================================================================
test("Scenario B: Repeated institutional headers are rejected; true title identified", () => {
  const docWithHeavyHeaders = `
UNIVERSITY OF LUSAKA
SCHOOL OF LAW
DEPARTMENT OF PRIVATE LAW
ACADEMIC YEAR 2026/2027 - SEMESTER 1
STUDENT NAME: KONDWANI TEMBO
STUDENT ID NUMBER: 2024-998812
COURSE CODE: L301

The Doctrine of Consideration and Promissory Estoppel in Zambian Contract Law

Instructions:
Evaluate the extent to which the rule in Pinnel's Case (1602) and Foakes v Beer (1884)
remains sound law in common law jurisdictions. Address the exceptions created by promissory estoppel
with reference to Central London Property Trust Ltd v High Trees House Ltd [1947].
`;

  // Backend parser check
  const backendParsed = parseBackendText(docWithHeavyHeaders);
  assert.notStrictEqual(
    backendParsed.title?.toUpperCase(),
    "UNIVERSITY OF LUSAKA",
    "Must not select University name as title"
  );
  assert.notStrictEqual(
    backendParsed.title?.toUpperCase(),
    "SCHOOL OF LAW",
    "Must not select School of Law as title"
  );
  assert.notStrictEqual(
    backendParsed.title?.toUpperCase(),
    "STUDENT NAME: KONDWANI TEMBO",
    "Must not select Student Name as title"
  );
  assert.strictEqual(
    backendParsed.title,
    "The Doctrine of Consideration and Promissory Estoppel in Zambian Contract Law",
    "Must identify the actual substantive assignment title"
  );

  // Client parser check
  const clientParsed = parseClientText(docWithHeavyHeaders);
  assert.strictEqual(
    clientParsed.title,
    "The Doctrine of Consideration and Promissory Estoppel in Zambian Contract Law",
    "Client parser must identify the actual substantive assignment title"
  );
});

// ============================================================================
// TEST C: Explicit page count specification
// "Write 10 pages" auto-sets page budget to 10; pricing updates
// ============================================================================
test("Scenario C: Explicit requested page count sets budget and recalculates price", () => {
  const docWithExplicitPages = `
Assignment Title: Environmental Law and Mining Regulations in the Copperbelt
Level: Degree
Write 10 pages on the environmental impact assessment requirements under the Environmental Management Act.
Deadline: 2026-11-30
`;

  const backendParsed = parseBackendText(docWithExplicitPages);
  assert.strictEqual(backendParsed.requested_page_count, 10, "Requested page count must be 10");
  assert.strictEqual(backendParsed.pageCount, 10, "pageCount alias must match 10");

  const clientParsed = parseClientText(docWithExplicitPages);
  assert.strictEqual(clientParsed.requested_page_count, 10, "Client requested page count must be 10");
  assert.strictEqual(clientParsed.pageCount, 10, "Client pageCount alias must match 10");

  // Price for 10 degree pages with >7 days deadline (standard multiplier 1.0)
  // Degree rate = 28 ZMW / page. 10 * 28 = 280 ZMW
  const pricing = calculateBackendPricing(10, "degree", 10, "assignment");
  assert.strictEqual(pricing.pages, 10);
  assert.strictEqual(pricing.baseRatePerPage, 28);
  assert.strictEqual(pricing.total, 280);
});

// ============================================================================
// TEST D: Ambiguous page number ("Page 10" in text/footer)
// Must NOT set page budget to 10; remains neutral or derived from word count
// ============================================================================
test("Scenario D: Ambiguous page numbers ('Page 10') do NOT inflate page budget", () => {
  const docWithPageNumber = `
Assignment Title: Clinical Pharmacokinetics Analysis
Review the dosage regimen for patient X described on Page 10 of the clinical handbook.
Explain the clearance rate and steady-state concentration.
Word count: 500 words
Page 10 of 12
`;

  const backendParsed = parseBackendText(docWithPageNumber);
  // Word count 500 words -> 500 / 250 = 2 pages. NOT 10 pages from "Page 10"!
  assert.notStrictEqual(
    backendParsed.pageCount,
    10,
    "Must NOT set pageCount to 10 based on 'Page 10' phrase or footer"
  );
  assert.strictEqual(
    backendParsed.pageCount,
    2,
    "Page budget must derive cleanly from 500 words (2 pages)"
  );

  const clientParsed = parseClientText(docWithPageNumber);
  assert.notStrictEqual(clientParsed.pageCount, 10);
  assert.strictEqual(clientParsed.pageCount, 2);

  // Document with no word count and just "Page 10"
  const docOnlyPage10 = `
Assignment Title: Philosophy of Mind
Read the passage on Page 10 and contrast Cartesian dualism with physicalism.
`;
  const backendNoWordCount = parseBackendText(docOnlyPage10);
  assert.strictEqual(
    backendNoWordCount.requested_page_count,
    null,
    "requested_page_count must remain null when only page references appear"
  );
  assert(
    backendNoWordCount.fields_requiring_review?.includes("requested_page_count"),
    "Must flag requested_page_count for student review"
  );
});

// ============================================================================
// TEST E: Submission deadline normalization
// "17 November 2026" converts to ISO "2026-11-17"
// ============================================================================
test("Scenario E: Submission deadline normalized to ISO YYYY-MM-DD", () => {
  const docWithFormattedDate = `
Assignment Title: Strategic Marketing Plan
Submission Deadline: 17 November 2026
Instructions: Formulate a 3-year market penetration strategy.
`;

  const backendParsed = parseBackendText(docWithFormattedDate);
  assert.strictEqual(
    backendParsed.submission_deadline,
    "2026-11-17",
    "Must parse '17 November 2026' into normalized '2026-11-17'"
  );
  assert.strictEqual(backendParsed.deadline, "2026-11-17");

  const clientParsed = parseClientText(docWithFormattedDate);
  assert.strictEqual(
    clientParsed.submission_deadline,
    "2026-11-17",
    "Client must parse '17 November 2026' into normalized '2026-11-17'"
  );

  // AI Validator normalization
  const aiResult = AIResponseValidator.validateAssignmentBrief(JSON.stringify({
    assignment_title: "Strategic Marketing Plan",
    assignment_brief: "Instructions: Formulate a 3-year market penetration strategy.",
    submission_deadline: "17 November 2026",
  }));
  assert.strictEqual(aiResult.isValid, true);
  assert(aiResult.data);
  assert.strictEqual(aiResult.data.submission_deadline, "2026-11-17");
});

// ============================================================================
// TEST F: Missing deadline or referencing style
// Returns null, does NOT fabricate APA or fake dates, flags for review
// ============================================================================
test("Scenario F: Missing deadline or referencing style returns null and flags review", () => {
  const minimalDoc = `
Assignment Title: Differential Equations and Boundary Value Problems
Solve the second-order partial differential equation using separation of variables.
`;

  const backendParsed = parseBackendText(minimalDoc);
  assert.strictEqual(backendParsed.submission_deadline, null, "Must not fabricate deadline");
  assert.strictEqual(backendParsed.deadline, null);
  assert.strictEqual(backendParsed.referencing_style, null, "Must not fabricate referencing style");
  assert.strictEqual(backendParsed.referencingStyle, null);

  assert(
    backendParsed.fields_requiring_review?.includes("submission_deadline"),
    "Must flag missing deadline for review"
  );
  assert(
    backendParsed.fields_requiring_review?.includes("referencing_style"),
    "Must flag missing referencing style for review"
  );

  // AI Response Validator check
  const validated = AIResponseValidator.validateAssignmentBrief(JSON.stringify({
    assignment_title: "Differential Equations and Boundary Value Problems",
    assignment_brief: "Solve the second-order partial differential equation using separation of variables.",
    submission_deadline: null,
    referencing_style: null,
  }));
  assert.strictEqual(validated.isValid, true);
  assert(validated.data);
  assert.strictEqual(validated.data.submission_deadline, null);
  assert.strictEqual(validated.data.referencing_style, null);
  assert(validated.data.fields_requiring_review.includes("submission_deadline"));
  assert(validated.data.fields_requiring_review.includes("referencing_style"));
});

// ============================================================================
// TEST G: Academic level and discipline mapping
// Maps to valid dropdown options or flags for review
// ============================================================================
test("Scenario G: Academic level and discipline map cleanly to platform options", () => {
  const mastersDoc = `
Assignment Title: Advanced Macroeconometric Modeling
Master of Science in Economics - Graduate Seminar
Instructions: Estimate a VAR model for inflation dynamics using quarterly central bank data.
`;
  const backendMasters = parseBackendText(mastersDoc);
  assert.strictEqual(backendMasters.academic_level, "masters");
  assert.strictEqual(backendMasters.subject_or_discipline, "business_finance");

  const csDoc = `
Assignment Title: Distributed Key-Value Store Implementation
BSc Computer Science and Software Engineering
Instructions: Design and implement Raft consensus algorithm in Go or Rust.
`;
  const backendCS = parseBackendText(csDoc);
  assert.strictEqual(backendCS.academic_level, "degree");
  assert.strictEqual(backendCS.subject_or_discipline, "computer_science");

  // Unclear discipline flags for review
  const ambiguousDoc = `
Assignment Title: General Project Overview
Overview of interdisciplinary team collaboration.
`;
  const backendAmbiguous = parseBackendText(ambiguousDoc);
  assert.strictEqual(backendAmbiguous.subject_or_discipline, null);
  assert(backendAmbiguous.fields_requiring_review?.includes("subject_or_discipline"));
});

// ============================================================================
// TEST H: Manual student correction preservation and pricing update
// User overrides are preserved and price recalculates immediately
// ============================================================================
test("Scenario H: Student manual overrides are preserved and pricing updates", () => {
  // Simulating the page state & touch tracker from upload/page.tsx
  const touchedFields = new Set();
  const markTouched = (field) => touchedFields.add(field);
  const isUserTouched = (field) => touchedFields.has(field);

  let formState = {
    title: "Initial Title",
    academicLevel: "degree",
    pageCount: 2,
    deadline: "2026-11-25",
  };

  // Student edits pageCount to 5 and academicLevel to "masters"
  markTouched("pageCount");
  formState.pageCount = 5;
  markTouched("academicLevel");
  formState.academicLevel = "masters";

  // Simulate an async OCR autofill event arriving later
  const incomingExtraction = {
    title: "New Extracted Title",
    academicLevel: "diploma",
    pageCount: 1, // OCR thinks it's 1 page
    deadline: "2026-11-30",
  };

  // Safe autofill logic (mirroring upload/page.tsx)
  if (!isUserTouched("title")) formState.title = incomingExtraction.title;
  if (!isUserTouched("academicLevel")) formState.academicLevel = incomingExtraction.academicLevel;
  if (!isUserTouched("pageCount")) formState.pageCount = incomingExtraction.pageCount;
  if (!isUserTouched("deadline")) formState.deadline = incomingExtraction.deadline;

  // Assertions: touched fields were NOT overridden!
  assert.strictEqual(formState.title, "New Extracted Title", "Untouched field was populated");
  assert.strictEqual(formState.academicLevel, "masters", "Touched academicLevel was preserved");
  assert.strictEqual(formState.pageCount, 5, "Touched pageCount was preserved");
  assert.strictEqual(formState.deadline, "2026-11-30", "Untouched deadline was populated");

  // Price recalculates immediately reflecting the student's manual changes
  // Masters = 38 ZMW / page. 5 pages * 38 = 190 ZMW
  const updatedPricing = calculateClientPricing(formState.pageCount, formState.academicLevel, 8, "assignment");
  assert.strictEqual(updatedPricing.pages, 5);
  assert.strictEqual(updatedPricing.baseRatePerPage, 38);
  assert.strictEqual(updatedPricing.total, 190);
});

// ============================================================================
// TEST I: Authoritative pricing calculation consistency
// Frontend and backend calculate identically across permutations
// ============================================================================
test("Scenario I: Frontend and Backend pricing engines calculate identically", () => {
  const testMatrix = [
    { pages: 1, level: "high_school", days: 10, service: "assignment" },
    { pages: 3, level: "diploma", days: 5, service: "report" },
    { pages: 7, level: "degree", days: 1, service: "case_study" },
    { pages: 15, level: "masters", days: 3, service: "literature_review" },
    { pages: 30, level: "phd", days: 8, service: "dissertation" },
  ];

  for (const item of testMatrix) {
    const backendResult = calculateBackendPricing(item.pages, item.level, item.days, item.service);
    const clientResult = calculateClientPricing(item.pages, item.level, item.days, item.service);

    assert.strictEqual(
      clientResult.total,
      backendResult.total,
      `Pricing total mismatch for ${JSON.stringify(item)}: Client=${clientResult.total}, Backend=${backendResult.total}`
    );
    assert.strictEqual(
      clientResult.baseRatePerPage,
      backendResult.baseRatePerPage,
      `Base rate mismatch for ${item.level}`
    );
    assert.strictEqual(
      clientResult.urgencyMultiplier,
      backendResult.urgencyMultiplier,
      `Urgency multiplier mismatch for ${item.days} days`
    );
    assert.strictEqual(
      clientResult.serviceMultiplier,
      backendResult.serviceMultiplier,
      `Service multiplier mismatch for ${item.service}`
    );
  }
});

// ============================================================================
// TEST J: Existing security controls, tenant isolation, and Spark preservation
// ============================================================================
test("Scenario J: Existing security controls, tenant isolation, and Spark plan preserved", () => {
  // 1. Payments disabled invariant
  const envFile = fs.readFileSync(".env.local", "utf-8");
  assert(
    envFile.includes("NEXT_PUBLIC_PAYMENTS_ENABLED=false") ||
    envFile.includes("PAYMENTS_ENABLED=false"),
    "paymentsEnabled must default to false"
  );

  // 2. Firebase Spark plan invariant: frontend package.json does not depend on paid Google Cloud packages
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert(!deps["@google-cloud/vertexai"], "Vertex AI package must NOT be installed");
  assert(!deps["@google-cloud/tasks"], "Cloud Tasks must NOT be installed");
  assert(!deps["@google-cloud/run"], "Cloud Run must NOT be installed");

  // 3. Gemini API key is NOT exposed to client bundles
  const envLocal = fs.readFileSync(".env.local", "utf-8");
  assert(!envLocal.includes("GEMINI_API_KEY"), ".env.local must NOT expose GEMINI_API_KEY");

  const clientEnvKeys = Object.keys(process.env).filter((k) =>
    k.startsWith("NEXT_PUBLIC_")
  );
  assert(
    !clientEnvKeys.some((k) => k.toLowerCase().includes("gemini") || k.toLowerCase().includes("ai_key")),
    "Gemini API key must never be exposed via NEXT_PUBLIC_ variables"
  );
});
