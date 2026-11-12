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

    // --------------------------------------------------------------------------
    // AUDIT-01 TESTS (Scenarios 15–24): Financial Wallet & Authorization Field Protection
    // --------------------------------------------------------------------------

    // SCENARIO 15: Authenticated writer cannot increase own availableBalance
    await executeTest(15, "Writer cannot increase own availableBalance on users/{uid}", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/writer_wallet_1"), {
          uid: "writer_wallet_1",
          role: "writer",
          status: "active",
          availableBalance: 100,
          reservedBalance: 50,
          totalEarned: 150,
          totalPaidOut: 0,
        });
      });

      const writerDb = testEnv.authenticatedContext("writer_wallet_1").firestore();
      await assertFails(
        updateDoc(doc(writerDb, "users/writer_wallet_1"), {
          availableBalance: 50000
        })
      );
    });

    // SCENARIO 16: Authenticated writer cannot decrease own reservedBalance
    await executeTest(16, "Writer cannot decrease or zero out own reservedBalance", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/writer_wallet_2"), {
          uid: "writer_wallet_2",
          role: "writer",
          status: "active",
          availableBalance: 20,
          reservedBalance: 200,
        });
      });

      const writerDb = testEnv.authenticatedContext("writer_wallet_2").firestore();
      await assertFails(
        updateDoc(doc(writerDb, "users/writer_wallet_2"), {
          reservedBalance: 0
        })
      );
    });

    // SCENARIO 17: Authenticated writer cannot modify totalEarned, totalPaidOut, or pendingBalance
    await executeTest(17, "Writer cannot modify totalEarned, totalPaidOut, or pendingBalance", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/writer_wallet_3"), {
          uid: "writer_wallet_3",
          role: "writer",
          status: "active",
          totalEarned: 300,
          totalPaidOut: 100,
          pendingBalance: 50,
        });
      });

      const writerDb = testEnv.authenticatedContext("writer_wallet_3").firestore();
      await assertFails(updateDoc(doc(writerDb, "users/writer_wallet_3"), { totalEarned: 99999 }));
      await assertFails(updateDoc(doc(writerDb, "users/writer_wallet_3"), { totalPaidOut: 0 }));
      await assertFails(updateDoc(doc(writerDb, "users/writer_wallet_3"), { pendingBalance: 999 }));
    });

    // SCENARIO 18: Writer cannot inject financial fields via setDoc(..., { merge: true }) or nested maps
    await executeTest(18, "Writer cannot inject financial fields via merge setDoc or nested wallet maps", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/writer_wallet_4"), {
          uid: "writer_wallet_4",
          role: "writer",
          status: "active",
          availableBalance: 0,
        });
      });

      const writerDb = testEnv.authenticatedContext("writer_wallet_4").firestore();
      await assertFails(
        setDoc(doc(writerDb, "users/writer_wallet_4"), { availableBalance: 10000 }, { merge: true })
      );
      await assertFails(
        setDoc(doc(writerDb, "users/writer_wallet_4"), { wallet: { availableBalance: 10000 } }, { merge: true })
      );
    });

    // SCENARIO 19: Writer cannot update another user's document
    await executeTest(19, "Writer cannot update another user's profile or wallet", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/other_writer_1"), {
          uid: "other_writer_1",
          role: "writer",
          displayName: "Other Writer",
          availableBalance: 500,
        });
      });

      const attackerDb = testEnv.authenticatedContext("writer_wallet_1").firestore();
      await assertFails(
        updateDoc(doc(attackerDb, "users/other_writer_1"), { displayName: "Hacked Name" })
      );
      await assertFails(
        updateDoc(doc(attackerDb, "users/other_writer_1"), { availableBalance: 0 })
      );
    });

    // SCENARIO 20: Customer cannot modify wallet fields or role on own user document
    await executeTest(20, "Customer cannot inject wallet fields or mutate role on own user doc", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/customer_wallet_1"), {
          uid: "customer_wallet_1",
          role: "customer",
          status: "active",
        });
      });

      const custDb = testEnv.authenticatedContext("customer_wallet_1").firestore();
      await assertFails(updateDoc(doc(custDb, "users/customer_wallet_1"), { availableBalance: 250 }));
      await assertFails(updateDoc(doc(custDb, "users/customer_wallet_1"), { role: "writer" }));
      await assertFails(updateDoc(doc(custDb, "users/customer_wallet_1"), { payoutStatus: "released" }));
    });

    // SCENARIO 21: Authenticated user cannot self-promote or self-verify
    await executeTest(21, "User cannot self-promote to admin or self-verify as writer/proofreader", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/applicant_self"), {
          uid: "applicant_self",
          role: "customer",
          status: "active",
          verificationStatus: "pending_review",
        });
      });

      const userDb = testEnv.authenticatedContext("applicant_self").firestore();
      await assertFails(updateDoc(doc(userDb, "users/applicant_self"), { role: "admin" }));
      await assertFails(updateDoc(doc(userDb, "users/applicant_self"), { isVerifiedWriter: true }));
      await assertFails(updateDoc(doc(userDb, "users/applicant_self"), { writerStatus: "active" }));
      await assertFails(updateDoc(doc(userDb, "users/applicant_self"), { verificationStatus: "approved" }));
      await assertFails(updateDoc(doc(userDb, "users/applicant_self"), { canProofread: true }));
    });

    // SCENARIO 22: User cannot forge wallet/metric/commission fields during profile creation
    await executeTest(22, "Self-registration cannot forge wallet balances, commission, or approval fields", async () => {
      const regDb = testEnv.authenticatedContext("new_user_forge").firestore();
      await assertFails(
        setDoc(doc(regDb, "users/new_user_forge"), {
          uid: "new_user_forge",
          role: "customer",
          availableBalance: 9999,
        })
      );
      await assertFails(
        setDoc(doc(regDb, "users/new_user_forge"), {
          uid: "new_user_forge",
          role: "customer",
          totalEarned: 500,
        })
      );
      await assertFails(
        setDoc(doc(regDb, "users/new_user_forge"), {
          uid: "new_user_forge",
          role: "customer",
          writerCommission: 100,
        })
      );
    });

    // SCENARIO 23: Legitimate non-privileged profile edits succeed for owning user
    await executeTest(23, "Owning user can update permitted profile fields (displayName, phone, bio)", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/profile_owner_1"), {
          uid: "profile_owner_1",
          role: "writer",
          status: "active",
          verificationStatus: "approved",
          availableBalance: 100,
          displayName: "Initial Name",
        });
      });

      const ownerDb = testEnv.authenticatedContext("profile_owner_1").firestore();
      await assertSucceeds(
        updateDoc(doc(ownerDb, "users/profile_owner_1"), {
          displayName: "Updated Writer Name",
          phone: "260971234567",
          bio: "Experienced academic writer in STEM.",
        })
      );
    });

    // SCENARIO 24: Direct client writes to backend-only ledger, payoutRequests, payments, and payoutExternalRefs fail
    await executeTest(24, "Client cannot directly read/write backend-only financial collections", async () => {
      const writerDb = testEnv.authenticatedContext("writer_wallet_1").firestore();
      await assertFails(
        setDoc(doc(writerDb, "payoutRequests/forged_payout"), { userId: "writer_wallet_1", amount: 500, status: "completed" })
      );
      await assertFails(
        setDoc(doc(writerDb, "ledger/forged_ledger"), { type: "escrow_release", amount: 500 })
      );
      await assertFails(
        setDoc(doc(writerDb, "payments/forged_payment"), { status: "Successful", amount: 500 })
      );
      await assertFails(
        setDoc(doc(writerDb, "payoutExternalRefs/FAKE-REF"), { payoutId: "forged_payout" })
      );
      await assertFails(
        setDoc(doc(writerDb, "refundExternalRefs/FAKE-REFUND"), { disputeId: "forged_dispute" })
      );
    });

    // SCENARIO 25 (Phase 5.14 C-1 & C-4): Clients cannot directly create assignments, researchRequests, disputes, auditLogs, notifications, or activity
    await executeTest(25, "Client direct creation of assignments (with forged budget/draft), researchRequests, disputes, auditLogs, notifications fails", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "users/student_c1"), {
          uid: "student_c1",
          role: "customer",
          status: "active",
        });
        await setDoc(doc(context.firestore(), "assignments/asg_c4"), {
          id: "asg_c4",
          customerId: "student_c1",
          status: "in_progress",
        });
      });

      const custDb = testEnv.authenticatedContext("student_c1").firestore();
      await assertFails(
        setDoc(doc(custDb, "assignments/forged_asg_1"), {
          id: "forged_asg_1",
          customerId: "student_c1",
          status: "draft",
          budget: 1,
          currency: "ZMW",
        })
      );
      await assertFails(
        setDoc(doc(custDb, "researchRequests/forged_res_1"), {
          id: "forged_res_1",
          studentId: "student_c1",
          status: "submitted",
        })
      );
      await assertFails(
        setDoc(doc(custDb, "disputes/forged_disp_1"), {
          id: "forged_disp_1",
          studentId: "student_c1",
          status: "open",
        })
      );
      await assertFails(
        setDoc(doc(custDb, "auditLogs/forged_audit_1"), {
          actorId: "student_c1",
          action: "fake",
        })
      );
      await assertFails(
        setDoc(doc(custDb, "notifications/forged_notif_1"), {
          userId: "other_user",
          title: "Phishing",
        })
      );
      await assertFails(
        setDoc(doc(custDb, "assignments/asg_c4/activity/act_1"), {
          actorId: "student_c1",
          message: "Bypass",
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
    console.log(`ALL ${testResults.length} SECURITY SCENARIOS PASSED WITH ZERO FAILURES. FIRESTORE RULES ARE SECURE.`);
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Fatal error during test run:", err);
  process.exit(1);
});
