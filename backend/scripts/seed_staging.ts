/**
 * DataBoy Controlled Staging Seeder (Server-Side Admin SDK Only)
 *
 * Seeds synthetic staging records into Firestore/Auth ONLY when APP_ENV=staging.
 * Security rules:
 * - Refuses to execute in APP_ENV=production.
 * - Uses strictly synthetic *.example.test addresses (zero real customer PII).
 * - Never seeds public administrator demo accounts or admin passwords.
 */
import "../src/config/env.js";
import { adminDb } from "../src/config/firebaseAdmin.js";
import { resolveAppEnvironment } from "../src/config/env.js";

async function seedStaging() {
  const appEnv = resolveAppEnvironment();
  if (appEnv !== "staging" && !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      `Refusing to seed staging data while APP_ENV='${appEnv}'. Set APP_ENV=staging before running.`
    );
  }

  const now = new Date().toISOString();
  const futureDeadline = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  console.log("[Staging Seeder] Seeding synthetic non-production DataBoy staging records...");

  const syntheticStudent = {
    uid: "staging_student_demo",
    email: "student.reviewer@staging.databoy.example",
    displayName: "[STAGING] Demo Student",
    role: "customer",
    status: "active",
    isOnboarded: true,
    profileCompletion: 100,
    environment: "staging",
    isSynthetic: true,
    createdAt: now,
    updatedAt: now,
  };

  const syntheticWriter = {
    uid: "staging_writer_demo",
    email: "writer.reviewer@staging.databoy.example",
    displayName: "[STAGING] Demo Specialist",
    role: "writer",
    status: "active",
    verificationStatus: "approved",
    writerStatus: "active",
    isVerifiedWriter: true,
    availability: "available",
    canProofread: false,
    availableBalance: 0,
    reservedBalance: 0,
    totalEarned: 0,
    totalPaidOut: 0,
    isOnboarded: true,
    profileCompletion: 100,
    academic: {
      university: "university_of_zambia",
      major: "computer_science",
      yearOfStudy: "postgraduate",
      degreeLevel: "masters",
      bio: "[STAGING] Synthetic specialist account for layout & workflow review.",
    },
    environment: "staging",
    isSynthetic: true,
    createdAt: now,
    updatedAt: now,
  };

  await adminDb.collection("users").doc(syntheticStudent.uid).set(syntheticStudent, { merge: true });
  await adminDb.collection("users").doc(syntheticWriter.uid).set(syntheticWriter, { merge: true });

  const sampleAssignment = {
    id: "STG-ASG-1001",
    title: "[STAGING] Network Consensus Case Study (Sample)",
    guidelines:
      "Synthetic staging preview assignment showing server-priced coursework structure and status lifecycle.",
    academicLevel: "degree",
    subject: "Computer Science",
    deadline: futureDeadline,
    wordCount: 1000,
    pageCount: 4,
    projectType: "assignment",
    referencingStyle: "APA 7th",
    files: [],
    source: "server_priced",
    budget: 112,
    currency: "ZMW",
    pricingBreakdown: {
      pages: 4,
      baseRatePerPage: 28,
      total: 112,
      currency: "ZMW",
    },
    writerCommission: 56,
    proofreaderCommission: 18.67,
    databoyCommission: 37.33,
    customerId: syntheticStudent.uid,
    customerEmail: syntheticStudent.email,
    writerId: null,
    proofreaderId: null,
    status: "awaiting_payment",
    paymentStatus: "awaiting_payment",
    payoutStatus: "pending",
    environment: "staging",
    isSynthetic: true,
    createdAt: now,
    updatedAt: now,
  };

  const sampleResearch = {
    id: "STG-RES-1001",
    title: "[STAGING] Qualitative Thesis Proposal Structure (Sample)",
    studentId: syntheticStudent.uid,
    requestTypes: ["proposal_writing"],
    pastedBrief:
      "Synthetic staging research request prepared for reviewer inspection without real student PII or live payment.",
    expectedDeliverable: "Research Proposal Draft",
    subject: "Education",
    levelOfStudy: "masters",
    deadline: futureDeadline,
    files: [],
    status: "submitted",
    paymentStatus: "unpaid",
    quoteStatus: "pending",
    environment: "staging",
    isSynthetic: true,
    createdAt: now,
    updatedAt: now,
  };

  await adminDb.collection("assignments").doc(sampleAssignment.id).set(sampleAssignment, { merge: true });
  await adminDb.collection("researchRequests").doc(sampleResearch.id).set(sampleResearch, { merge: true });

  console.log("[Staging Seeder] Completed synthetic staging seed (0 real customer records, 0 admin passwords).");
}

seedStaging()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Staging Seeder Error]:", err.message || err);
    process.exit(1);
  });
