/**
 * DataBoy Firebase Storage Security Rules Test Suite
 * Runs against Firebase Storage + Firestore Emulators via @firebase/rules-unit-testing.
 */
import fs from "fs";
import path from "path";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadString, getBytes } from "firebase/storage";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "databoy-dev";

async function runStorageTests() {
  const firestoreRules = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
  const storageRules = fs.readFileSync(path.resolve(process.cwd(), "storage.rules"), "utf8");

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: firestoreRules,
      host: "127.0.0.1",
      port: 8080,
    },
    storage: {
      rules: storageRules,
      host: "127.0.0.1",
      port: 9199,
    },
  });

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/student_s1"), { uid: "student_s1", role: "customer", status: "active" });
      await setDoc(doc(db, "users/writer_s1"), { uid: "writer_s1", role: "writer", status: "active" });
      await setDoc(doc(db, "users/stranger_s1"), { uid: "stranger_s1", role: "customer", status: "active" });
      await setDoc(doc(db, "assignments/asg_st_1"), {
        id: "asg_st_1",
        customerId: "student_s1",
        writerId: "writer_s1",
        status: "in_progress",
      });
    });

    await test("S-01: Unauthenticated user cannot read or upload files", async () => {
      const unauthStorage = testEnv.unauthenticatedContext().storage();
      await assertFails(
        uploadString(ref(unauthStorage, "pending/student_s1/brief.pdf"), "test", "raw", {
          contentType: "application/pdf",
        })
      );
      await assertFails(getBytes(ref(unauthStorage, "assignments/asg_st_1/file.pdf")));
    });

    await test("S-02: Owning user can upload & read in private pending/{uid}/ workspace; other users denied", async () => {
      const ownerStorage = testEnv.authenticatedContext("student_s1").storage();
      const strangerStorage = testEnv.authenticatedContext("stranger_s1").storage();

      await assertSucceeds(
        uploadString(ref(ownerStorage, "pending/student_s1/1_brief.pdf"), "%PDF-1.4 sample", "raw", {
          contentType: "application/pdf",
        })
      );
      await assertSucceeds(getBytes(ref(ownerStorage, "pending/student_s1/1_brief.pdf")));

      await assertFails(getBytes(ref(strangerStorage, "pending/student_s1/1_brief.pdf")));
      await assertFails(
        uploadString(ref(strangerStorage, "pending/student_s1/hack.pdf"), "evil", "raw", {
          contentType: "application/pdf",
        })
      );
    });

    await test("S-03: Assignment files readable/writable by participants only; unsupported MIME & strangers rejected", async () => {
      const studentStorage = testEnv.authenticatedContext("student_s1").storage();
      const writerStorage = testEnv.authenticatedContext("writer_s1").storage();
      const strangerStorage = testEnv.authenticatedContext("stranger_s1").storage();

      await assertSucceeds(
        uploadString(ref(studentStorage, "assignments/asg_st_1/spec.pdf"), "%PDF-spec", "raw", {
          contentType: "application/pdf",
        })
      );
      await assertSucceeds(getBytes(ref(writerStorage, "assignments/asg_st_1/spec.pdf")));
      await assertFails(getBytes(ref(strangerStorage, "assignments/asg_st_1/spec.pdf")));
      await assertFails(
        uploadString(ref(studentStorage, "assignments/asg_st_1/payload.exe"), "MZ", "raw", {
          contentType: "application/x-msdownload",
        })
      );
    });
  } finally {
    await testEnv.cleanup();
  }

  console.log(`\nSTORAGE RULES SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  if (failed > 0) process.exit(1);
}

runStorageTests().catch((err) => {
  console.error("Fatal Storage rules error:", err);
  process.exit(1);
});
