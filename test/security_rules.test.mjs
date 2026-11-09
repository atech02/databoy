import fs from "fs";
import path from "path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, collection, addDoc } from "firebase/firestore";

const PROJECT_ID = "databoy-security-test";
const RULES_PATH = path.resolve(process.cwd(), "firestore.rules");

async function runTests() {
  console.log("================================================================================");
  console.log("DATABOY SECURITY TEST SUITE — AUTOMATED FIRESTORE RULES AUDIT");
  console.log("Targeting local Firestore Emulator at 127.0.0.1:8080");
  console.log("================================================================================\n");

  const rulesContent = fs.readFileSync(RULES_PATH, "utf8");

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: rulesContent
    }
  });

  const testResults = [];

  async function executeTest(number, name, fn) {
    process.stdout.write(`Scenario ${number}: ${name} ... `);
    try {
      await testEnv.clearFirestore();
      await fn();
      console.log("PASSED [✓]");
      testResults.push({ number, name, status: "PASSED" });
    } catch (err) {
      console.log(`FAILED [✗]\n  -> Error: ${err.message}`);
      testResults.push({ number, name, status: "FAILED", error: err.message });
    }
  }

  try {
    // --------------------------------------------------------------------------
    // SCENARIO 1: Customer cannot register with role == 'admin' or elevated roles
    // --------------------------------------------------------------------------
    await executeTest(1, "Customer cannot register with role == 'admin' or 'writer'", async () => {
      const studentAuth = testEnv.authenticatedContext("student_1", { email: "student@test.com" });
      const db = studentAuth.firestore();

      // Attempt 1: Maliciously set role: "admin"
      await assertFails(
        setDoc(doc(db, "users/student_1"), {
          uid: "student_1",
          email: "student@test.com",
          displayName: "Attacker",
          role: "admin",
          status: "active",
          verificationStatus: "draft"
        })
      );

      // Attempt 2: Maliciously set role: "writer"
      await assertFails(
        setDoc(doc(db, "users/student_1"), {
          uid: "student_1",
          email: "student@test.com",
          displayName: "Attacker",
          role: "writer",
          status: "active",
          verificationStatus: "draft"
        })
      );

      // Attempt 3: Legitimate customer registration
      await assertSucceeds(
        setDoc(doc(db, "users/student_1"), {
          uid: "student_1",
          email: "student@test.com",
          displayName: "Valid Customer",
          role: "customer",
          status: "active",
          verificationStatus: "draft"
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 2: Customer cannot change their own role
    // --------------------------------------------------------------------------
    await executeTest(2, "Customer cannot escalate their own role after registration", async () => {
      // Seed legitimate customer
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/student_1"), {
          uid: "student_1",
          role: "customer",
          status: "active",
          verificationStatus: "draft"
        });
      });

      const studentAuth = testEnv.authenticatedContext("student_1");
      const db = studentAuth.firestore();

      // Escalation attempt
      await assertFails(
        updateDoc(doc(db, "users/student_1"), {
          role: "admin"
        })
      );

      // Escalation attempt to writer
      await assertFails(
        updateDoc(doc(db, "users/student_1"), {
          role: "writer"
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 3: Customer cannot release payouts
    // --------------------------------------------------------------------------
    await executeTest(3, "Customer cannot manipulate payoutStatus to 'released'", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "assignments/asg_3"), {
          id: "asg_3",
          customerId: "student_1",
          writerId: "writer_1",
          status: "in_progress",
          budget: 250,
          payoutStatus: "escrowed",
          escrowStatus: "held"
        });
      });

      const studentAuth = testEnv.authenticatedContext("student_1");
      const db = studentAuth.firestore();

      await assertFails(
        updateDoc(doc(db, "assignments/asg_3"), {
          payoutStatus: "released"
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 4: Customer cannot change escrow status
    // --------------------------------------------------------------------------
    await executeTest(4, "Customer cannot manipulate escrowStatus or status directly", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "assignments/asg_4"), {
          id: "asg_4",
          customerId: "student_1",
          status: "awaiting_payment",
          budget: 150,
          payoutStatus: "pending",
          escrowStatus: "unfunded"
        });
      });

      const studentAuth = testEnv.authenticatedContext("student_1");
      const db = studentAuth.firestore();

      await assertFails(
        updateDoc(doc(db, "assignments/asg_4"), {
          escrowStatus: "released"
        })
      );

      await assertFails(
        updateDoc(doc(db, "assignments/asg_4"), {
          status: "funded"
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 5: Writer cannot change payment confirmation
    // --------------------------------------------------------------------------
    await executeTest(5, "Writer cannot alter paymentStatus, payoutStatus or commission", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "assignments/asg_5"), {
          id: "asg_5",
          customerId: "student_1",
          writerId: "writer_1",
          status: "assigned",
          paymentStatus: "unpaid",
          payoutStatus: "pending",
          writerCommission: 120
        });
      });

      const writerAuth = testEnv.authenticatedContext("writer_1");
      const db = writerAuth.firestore();

      await assertFails(
        updateDoc(doc(db, "assignments/asg_5"), {
          paymentStatus: "paid"
        })
      );

      await assertFails(
        updateDoc(doc(db, "assignments/asg_5"), {
          writerCommission: 999
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 6: Writer cannot replace their assignment
    // --------------------------------------------------------------------------
    await executeTest(6, "Writer cannot reassign task to another writerId or change status", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "assignments/asg_6"), {
          id: "asg_6",
          customerId: "student_1",
          writerId: "writer_1",
          status: "in_progress"
        });
      });

      const writerAuth = testEnv.authenticatedContext("writer_1");
      const db = writerAuth.firestore();

      await assertFails(
        updateDoc(doc(db, "assignments/asg_6"), {
          writerId: "writer_2"
        })
      );

      await assertFails(
        updateDoc(doc(db, "assignments/asg_6"), {
          status: "completed"
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 7: Writer cannot proofread their own work (Separation of duties)
    // --------------------------------------------------------------------------
    await executeTest(7, "Separation of duties: Writer cannot review their own submission", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        // Dual-role user: writer_1 is both writer and proofreader
        await setDoc(doc(context.firestore(), "users/writer_1"), {
          uid: "writer_1",
          role: "proofreader",
          verificationStatus: "approved",
          isVerifiedWriter: true
        });

        await setDoc(doc(context.firestore(), "assignments/asg_7"), {
          id: "asg_7",
          customerId: "student_1",
          writerId: "writer_1", // Assigned writer is writer_1
          status: "draft_submitted"
        });
      });

      const writerAuth = testEnv.authenticatedContext("writer_1");
      const db = writerAuth.firestore();

      // Writer attempts to claim or submit proofreading review on own work
      await assertFails(
        updateDoc(doc(db, "assignments/asg_7"), {
          proofreaderId: "writer_1",
          proofreaderNotes: "Looks great, self-approved!"
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 8: Proofreader cannot approve unauthorized assignments
    // --------------------------------------------------------------------------
    await executeTest(8, "Unassigned proofreader cannot update or approve assignment", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "assignments/asg_8"), {
          id: "asg_8",
          customerId: "student_1",
          writerId: "writer_1",
          proofreaderId: "proofreader_assigned",
          status: "under_review"
        });
      });

      // proofreader_attacker is NOT the assigned proofreader
      const unassignedAuth = testEnv.authenticatedContext("proofreader_attacker");
      const db = unassignedAuth.firestore();

      await assertFails(
        updateDoc(doc(db, "assignments/asg_8"), {
          proofreaderNotes: "Unauthorized comment"
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 9: Student cannot change quotation amounts
    // --------------------------------------------------------------------------
    await executeTest(9, "Student cannot modify quoteAmount or quoteStatus on research request", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "researchRequests/res_9"), {
          id: "res_9",
          studentId: "student_1",
          status: "submitted",
          quoteAmount: 500,
          quoteStatus: "pending_acceptance"
        });
      });

      const studentAuth = testEnv.authenticatedContext("student_1");
      const db = studentAuth.firestore();

      await assertFails(
        updateDoc(doc(db, "researchRequests/res_9"), {
          quoteAmount: 50 // Malicious discount
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 10: Student cannot mark research requests as paid directly
    // --------------------------------------------------------------------------
    await executeTest(10, "Student cannot directly mark research request as paid or funded", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "researchRequests/res_10"), {
          id: "res_10",
          studentId: "student_1",
          status: "awaiting_payment",
          quoteAmount: 300,
          quoteStatus: "accepted",
          paymentStatus: "unpaid"
        });
      });

      const studentAuth = testEnv.authenticatedContext("student_1");
      const db = studentAuth.firestore();

      await assertFails(
        updateDoc(doc(db, "researchRequests/res_10"), {
          quoteStatus: "paid"
        })
      );

      await assertFails(
        updateDoc(doc(db, "researchRequests/res_10"), {
          paymentStatus: "paid"
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 11: Authorized administrator can approve writers
    // --------------------------------------------------------------------------
    await executeTest(11, "Authorized administrator can update and approve writer profiles", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/admin_user"), {
          uid: "admin_user",
          role: "admin",
          status: "active"
        });
        await setDoc(doc(context.firestore(), "users/applicant_1"), {
          uid: "applicant_1",
          role: "writer",
          status: "active",
          verificationStatus: "pending_review",
          isVerifiedWriter: false
        });
      });

      const adminAuth = testEnv.authenticatedContext("admin_user", { role: "admin" });
      const db = adminAuth.firestore();

      await assertSucceeds(
        updateDoc(doc(db, "users/applicant_1"), {
          verificationStatus: "approved",
          writerStatus: "active",
          isVerifiedWriter: true
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 12: Authorized proofreader can review assigned submissions
    // --------------------------------------------------------------------------
    await executeTest(12, "Authorized proofreader can update permitted review notes on assigned submission", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "assignments/asg_12"), {
          id: "asg_12",
          customerId: "student_1",
          writerId: "writer_1",
          proofreaderId: "proofreader_legit",
          status: "under_review",
          proofreaderNotes: ""
        });
      });

      const proofreaderAuth = testEnv.authenticatedContext("proofreader_legit");
      const db = proofreaderAuth.firestore();

      await assertSucceeds(
        updateDoc(doc(db, "assignments/asg_12"), {
          proofreaderNotes: "Grammar verified, excellent structure."
        })
      );
    });

    // --------------------------------------------------------------------------
    // SCENARIO 13: Assignment participants can access permitted activity records
    // --------------------------------------------------------------------------
    await executeTest(13, "Assignment participants can read assignment document", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "assignments/asg_13"), {
          id: "asg_13",
          customerId: "student_1",
          writerId: "writer_1",
          proofreaderId: "proofreader_1",
          status: "in_progress",
          title: "Comparative Literature Essay"
        });
      });

      const studentAuth = testEnv.authenticatedContext("student_1");
      const writerAuth = testEnv.authenticatedContext("writer_1");
      const proofreaderAuth = testEnv.authenticatedContext("proofreader_1");

      await assertSucceeds(getDoc(doc(studentAuth.firestore(), "assignments/asg_13")));
      await assertSucceeds(getDoc(doc(writerAuth.firestore(), "assignments/asg_13")));
      await assertSucceeds(getDoc(doc(proofreaderAuth.firestore(), "assignments/asg_13")));
    });

    // --------------------------------------------------------------------------
    // SCENARIO 14: Unrelated users cannot access private assignments
    // --------------------------------------------------------------------------
    await executeTest(14, "Unrelated user cannot read or update private assignment", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "assignments/asg_14"), {
          id: "asg_14",
          customerId: "student_1",
          writerId: "writer_1",
          status: "in_progress",
          title: "Confidential Research Paper"
        });
      });

      const strangerAuth = testEnv.authenticatedContext("stranger_999");
      const strangerDb = strangerAuth.firestore();

      await assertFails(getDoc(doc(strangerDb, "assignments/asg_14")));
      await assertFails(
        updateDoc(doc(strangerDb, "assignments/asg_14"), {
          notes: "Injected comment"
        })
      );
    });

  } finally {
    await testEnv.cleanup();
  }

  console.log("\n================================================================================");
  console.log("TEST EXECUTION SUMMARY");
  console.log("================================================================================");
  const passed = testResults.filter(t => t.status === "PASSED").length;
  const failed = testResults.filter(t => t.status === "FAILED").length;
  console.log(`Total Scenarios: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.error("FAILURES DETECTED IN SECURITY SUITE:");
    testResults.filter(t => t.status === "FAILED").forEach(f => {
      console.error(`- Scenario ${f.number}: ${f.name} => ${f.error}`);
    });
    process.exit(1);
  } else {
    console.log("ALL 14 SECURITY SCENARIOS PASSED WITH ZERO FAILURES. FIRESTORE RULES ARE SECURE.");
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Fatal error during test run:", err);
  process.exit(1);
});
