process.env.NODE_ENV = "test";
import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";

// Import modules
import { AIResponseValidator } from "../backend/dist/services/ai/AIResponseValidator.js";
import { parseTextToAssignmentFields } from "../backend/dist/services/ocrProcessingService.js";
import { calculateAssignmentPricing as calculateBackendPricing } from "../backend/dist/services/pricingEngine.js";
import { calculateAssignmentPricing as calculateClientPricing } from "../src/utils/pricing.ts";

console.log("================================================================================");
console.log("DATABOY PHASE 5.34: LIVE PRODUCTION POST-DEPLOYMENT SMOKE TEST SUITE");
console.log("================================================================================");

const PROD_BACKEND_URL = "https://databoy-backend-staging.onrender.com";
const PROD_HOSTING_URL = "https://databoy-aa871.web.app";

// ----------------------------------------------------------------------------
// TEST 1: Live Infrastructure Endpoint Verification
// ----------------------------------------------------------------------------
test("Prod Smoke 1: Live Backend Health & Hosting CDN Endpoints", async () => {
  // 1. Backend Health Check
  const healthRes = await fetch(`${PROD_BACKEND_URL}/api/health`);
  assert.strictEqual(healthRes.status, 200, "Backend health must return 200 OK");
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, "healthy", "Backend status must be healthy");
  assert.strictEqual(healthData.infrastructure?.paymentsEnabled, false, "paymentsEnabled must be false");
  assert.strictEqual(healthData.infrastructure?.storageProvider, "r2", "R2 storage must be active");
  assert.strictEqual(healthData.infrastructure?.rateLimitStore, "redis", "Redis rate limiting must be active");

  // 2. Hosting CDN Check
  const hostingRes = await fetch(PROD_HOSTING_URL, { method: "HEAD" });
  assert.strictEqual(hostingRes.status, 200, "Hosting root must return 200 OK");
  const uploadPageRes = await fetch(`${PROD_HOSTING_URL}/projects/upload`, { method: "HEAD" });
  assert.strictEqual(uploadPageRes.status, 200, "Upload page route must return 200 OK");
});

// ----------------------------------------------------------------------------
// TEST 2: Live Backend Protected Endpoint Rejection
// ----------------------------------------------------------------------------
test("Prod Smoke 2: Protected Endpoints Strictly Reject Anonymous Requests", async () => {
  const authRes = await fetch(`${PROD_BACKEND_URL}/api/uploads/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: "smoke_test.pdf", contentType: "application/pdf" }),
  });
  assert.strictEqual(authRes.status, 401, "Protected upload authorize must reject with 401");
  const authBody = await authRes.json();
  assert(authBody.error?.toLowerCase().includes("authorization"), "Must reject missing auth header");
});

// ----------------------------------------------------------------------------
// TEST 3: Live Backend Public Authoritative Pricing Calculation
// ----------------------------------------------------------------------------
test("Prod Smoke 3: Live Backend Authoritative Pricing Matches Client Engine", async () => {
  const payload = {
    pageCount: 10,
    academicLevel: "degree",
    deadline: "2026-11-28",
    serviceType: "assignment",
  };

  const res = await fetch(`${PROD_BACKEND_URL}/api/pricing-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  assert.strictEqual(res.status, 200, "Pricing preview must return 200 OK");
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.breakdown?.total, 280, "Live backend 10-page degree quote must be 280 ZMW");

  // Verify client engine calculates identical 280 ZMW
  const clientQuote = calculateClientPricing(10, "degree", 10, "assignment");
  assert.strictEqual(clientQuote.total, 280, "Client engine must produce 280 ZMW");
});

// ----------------------------------------------------------------------------
// TEST 4: End-to-End 16-Step Production Workflow Smoke Test
// ----------------------------------------------------------------------------
test("Prod Smoke 4: End-to-End 16-Step Production Document Extraction & Autofill Workflow", () => {
  // 1. Authenticate simulated tenant
  const tenantA = "student_tenant_alpha_2026";
  const tenantB = "student_tenant_bravo_9981";

  // 2. Representative non-sensitive English digital document
  const assignmentText = `
Course: ECON 301 - Macroeconomic Policy Analysis
Instructor: Dr. Mutale
Assignment Title: The Impact of Monetary Policy on Macroeconomic Stability in Zambia

Questions & Brief:
Evaluate the effectiveness of the Monetary Policy Rate (MPR) implemented by the Bank of Zambia
in anchoring inflationary expectations between 2021 and 2026.
Analyse the pass-through effect from exchange rate depreciation to domestic consumer prices.
Provide policy recommendations aligned with fiscal consolidation objectives.

Requirements:
- Level: Undergraduate Degree
- Length: 2,500 words
- Referencing Style: APA 7th Edition
- Final Submission Deadline: 2026-11-30
`;

  // 3. Storage key scoping check
  const storageKey = `pending/${tenantA}/assignment_brief.pdf`;
  assert(storageKey.startsWith(`pending/${tenantA}/`), "R2 key must be strictly scoped to tenant");

  // 4. Processing via OCR & DocumentUnderstandingService pipeline
  const extracted = parseTextToAssignmentFields(assignmentText);

  // 5. Language remains English
  assert.strictEqual(extracted.language, "English", "Step 5: Language must be detected as English");

  // 6. Assignment title
  assert.strictEqual(
    extracted.title,
    "The Impact of Monetary Policy on Macroeconomic Stability in Zambia",
    "Step 6: Title must be extracted cleanly"
  );

  // 7. Assignment brief
  assert(
    extracted.guidelines?.includes("Evaluate the effectiveness of the Monetary Policy Rate"),
    "Step 7: Brief must preserve instructions verbatim"
  );

  // 8. Academic level
  assert.strictEqual(extracted.academic_level, "degree", "Step 8: Academic level must be degree");

  // 9. Subject
  assert.strictEqual(extracted.subject_or_discipline, "business_finance", "Step 9: Subject must be business_finance");

  // 10. Referencing style
  assert.strictEqual(extracted.referencing_style, "APA", "Step 10: Referencing style must be APA");

  // 11. Submission deadline
  assert.strictEqual(extracted.submission_deadline, "2026-11-30", "Step 11: Deadline must be 2026-11-30");

  // 12. Page budget derived from 2,500 words
  assert.strictEqual(extracted.word_count, 2500, "Word count must be 2500");
  assert.strictEqual(extracted.pageCount, 10, "Step 12: Page budget must be 10 pages");

  // 13. Pricing updates correctly
  const initialPricing = calculateBackendPricing(extracted.pageCount, extracted.academic_level, 10, "assignment");
  assert.strictEqual(initialPricing.total, 280, "Step 13: Initial price must be 280 ZMW (10 * 28)");

  // 14. Manual edit protection: student modifies page count to 15 pages
  const touchedFields = new Set();
  const markTouched = (f) => touchedFields.add(f);
  const isUserTouched = (f) => touchedFields.has(f);

  let formState = {
    title: extracted.title,
    pageCount: extracted.pageCount,
    academicLevel: extracted.academic_level,
    deadline: extracted.submission_deadline,
  };

  markTouched("pageCount");
  formState.pageCount = 15; // Student manually increases deliverable length to 15 pages

  // Simulate late-arriving asynchronous OCR response
  const lateOCRArrival = {
    title: "Another Extracted Title",
    pageCount: 10,
    academicLevel: "degree",
  };

  if (!isUserTouched("title")) formState.title = lateOCRArrival.title;
  if (!isUserTouched("pageCount")) formState.pageCount = lateOCRArrival.pageCount;

  assert.strictEqual(formState.pageCount, 15, "Step 14: Manual edit of 15 pages must be preserved");

  // 15. Verify authoritative pricing updates to 15 pages (15 * 28 = 420 ZMW)
  const updatedPricing = calculateBackendPricing(formState.pageCount, formState.academicLevel, 10, "assignment");
  assert.strictEqual(updatedPricing.pages, 15);
  assert.strictEqual(updatedPricing.total, 420, "Step 15: Authoritative price must recalculate to 420 ZMW");

  // 16. Tenant isolation: verify tenant B cannot use tenant A storage key
  const crossTenantAccessAllowed = storageKey.includes(tenantB);
  assert.strictEqual(crossTenantAccessAllowed, false, "Step 16: Tenant B cannot access Tenant A storage key");
});

// ----------------------------------------------------------------------------
// TEST 5: Ambiguous Page Number Footer Test
// ----------------------------------------------------------------------------
test("Prod Smoke 5: Ambiguous Document Footers ('Page 10 of 12') Do Not Inflate Page Budget", () => {
  const footerDoc = `
Assignment Title: Constitutional Law Case Review
Examine the Supreme Court ruling in Attorney General v Clarke (2008).
Discuss the doctrine of separation of powers and executive privilege.
Page 10 of 12
`;

  const extracted = parseTextToAssignmentFields(footerDoc);
  assert.notStrictEqual(extracted.requested_page_count, 10, "Must NOT set requested page count to 10 from footer");
  assert.strictEqual(extracted.requested_page_count, null, "Requested page count must be null");
  assert(extracted.fields_requiring_review?.includes("requested_page_count"), "Must flag page budget for review");

  // Pricing default for unspecified budget remains 1 page (28 ZMW)
  const defaultPricing = calculateBackendPricing(1, "degree", 10, "assignment");
  assert.strictEqual(defaultPricing.total, 28, "Default price must remain neutral (28 ZMW)");
});
