import { doc, setDoc, collection, writeBatch, deleteDoc, getDocs } from "firebase/firestore";
import { db } from "@/config/firebase";
import { UserProfile, Project, ProjectActivity, ProjectStatus } from "@/types/domain";

const USERS_COLLECTION = "users";
const PROJECTS_COLLECTION = "assignments"; // Must be 'assignments' to respect firestore.rules
const ACTIVITY_SUBCOLLECTION = "activity";  // Must be 'activity' to respect firestore.rules

// Realistic mock writers and proofreaders with academic disciplines
const MOCK_WRITERS: Omit<UserProfile, "createdAt" | "updatedAt">[] = [
  {
    uid: "writer-1",
    email: "elizabeth.b@databoy.ai",
    displayName: "Dr. Elizabeth Blackwell",
    role: "writer",
    status: "active",
    verificationStatus: "approved",
    writerStatus: "active",
    isVerifiedWriter: true,
    availability: "available",
    reputation: 4.8,
    completedCount: 24,
    isOnboarded: true,
    profileCompletion: 100,
    academic: {
      phone: "+1 555-0101",
      university: "stanford_university",
      faculty: "faculty_of_sciences",
      major: "bioinformatics",
      yearOfStudy: "postgraduate",
      bio: "Medical researcher and bioinformatics professional focused on comparative research, data analysis, and technical proposal drafting.",
      specializations: ["researcher", "writer", "proofreader"]
    }
  },
  {
    uid: "writer-2",
    email: "alan.turing@databoy.ai",
    displayName: "Prof. Alan Turing",
    role: "writer",
    status: "active",
    verificationStatus: "approved",
    writerStatus: "active",
    isVerifiedWriter: true,
    availability: "busy",
    reputation: 4.9,
    completedCount: 42,
    isOnboarded: true,
    profileCompletion: 100,
    academic: {
      phone: "+1 555-0102",
      university: "massachusetts_institute_of_technology",
      faculty: "faculty_of_engineering_and_computer_science",
      major: "computer_science_and_engineering",
      yearOfStudy: "postgraduate",
      bio: "Academic statistician and computer scientist specializing in software architectures, cryptography, and complex data analysis algorithms.",
      specializations: ["researcher", "statistician", "writer"]
    }
  },
  {
    uid: "writer-pending",
    email: "pending.writer@databoy.ai",
    displayName: "Jane Goodall",
    role: "writer",
    status: "active",
    verificationStatus: "pending_review",
    writerStatus: "inactive",
    isVerifiedWriter: false,
    availability: "available",
    reputation: 5.0,
    completedCount: 0,
    isOnboarded: true,
    profileCompletion: 100,
    academic: {
      phone: "+1 555-0104",
      university: "harvard_university",
      faculty: "faculty_of_sciences",
      major: "molecular_and_cellular_biology",
      yearOfStudy: "postgraduate",
      bio: "Postgraduate biological researcher seeking credentials to draft biological analysis papers and field data collection support.",
      specializations: ["researcher", "educator"],
      documents: {
        degreeCertificateUrl: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2Fdegree_cert.pdf",
        transcriptUrl: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2Ftranscript.pdf"
      }
    }
  },
  {
    uid: "writer-suspended",
    email: "suspended.writer@databoy.ai",
    displayName: "Compliance Flagged",
    role: "writer",
    status: "suspended",
    verificationStatus: "draft",
    writerStatus: "inactive",
    isVerifiedWriter: false,
    availability: "suspended",
    reputation: 2.1,
    completedCount: 3,
    isOnboarded: true,
    profileCompletion: 100,
    academic: {
      phone: "+1 555-0105",
      university: "imperial_college_london",
      faculty: "faculty_of_engineering_and_computer_science",
      major: "software_engineering",
      yearOfStudy: "year_4",
      bio: "Compliance violation profile.",
      specializations: ["writer"],
      documents: {
        degreeCertificateUrl: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2Fdegree_cert.pdf",
        transcriptUrl: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2Ftranscript.pdf"
      }
    }
  }
];

const MOCK_PROOFREADERS: Omit<UserProfile, "createdAt" | "updatedAt">[] = [
  {
    uid: "proofreader-1",
    email: "marie.curie@databoy.ai",
    displayName: "Dr. Marie Curie",
    role: "proofreader",
    status: "active",
    verificationStatus: "approved",
    writerStatus: "active",
    isVerifiedWriter: true,
    availability: "available",
    reputation: 5.0,
    completedCount: 89,
    isOnboarded: true,
    profileCompletion: 100,
    academic: {
      phone: "+1 555-0103",
      university: "university_of_oxford",
      faculty: "faculty_of_sciences",
      major: "quantum_physics",
      yearOfStudy: "postgraduate",
      bio: "Senior proofreader and physicist reviewing reference structures, mathematical modeling, and research support papers.",
      specializations: ["researcher", "proofreader", "educator"]
    }
  },
  {
    uid: "proofreader-pending",
    email: "pending.reviewer@databoy.ai",
    displayName: "Lois Lane",
    role: "proofreader",
    status: "active",
    verificationStatus: "pending_review",
    writerStatus: "inactive",
    isVerifiedWriter: false,
    availability: "available",
    reputation: 5.0,
    completedCount: 0,
    isOnboarded: true,
    profileCompletion: 100,
    academic: {
      phone: "+1 555-0106",
      university: "imperial_college_london",
      faculty: "faculty_of_humanities_and_social_sciences",
      major: "english_literature",
      yearOfStudy: "postgraduate",
      bio: "Academic reviewer and literature editor auditing reference structures, business proposals, and legal document layouts.",
      specializations: ["writer", "proofreader", "editor"],
      documents: {
        degreeCertificateUrl: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2Fdegree_cert.pdf",
        transcriptUrl: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2Ftranscript.pdf"
      }
    }
  }
];

export const seeder = {
  /**
   * Seeds the database with mock Writers, Proofreaders, and Projects tied to the current customer.
   */
  async seedDatabase(currentCustomerId: string, currentCustomerName: string): Promise<{ success: boolean; count: number }> {
    const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || "").trim().toLowerCase();
    const isLocalHost =
      typeof window !== "undefined" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (appEnv === "staging" || appEnv === "production" || !isLocalHost) {
      throw new Error(
        "Client-side seeding is disabled outside local development. Use backend/scripts/seed_staging.ts with Firebase Admin SDK for staging data."
      );
    }

    const timestamp = new Date().toISOString();
    const batch = writeBatch(db);
    let count = 0;

    try {
      // 1. Seed Writers
      for (const writer of MOCK_WRITERS) {
        const docRef = doc(db, USERS_COLLECTION, writer.uid);
        batch.set(docRef, {
          ...writer,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        count++;
      }

      // 2. Seed Proofreaders / Reviewers
      for (const proof of MOCK_PROOFREADERS) {
        const docRef = doc(db, USERS_COLLECTION, proof.uid);
        batch.set(docRef, {
          ...proof,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        count++;
      }

      // Commit users first
      await batch.commit();

      // 3. Define projects tied to the customer
      const mockProjects: Project[] = [
        {
          id: "PRJ-8001",
          title: "Comparative Study of Transformer Architectures",
          projectType: "research_support",
          deadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 15 days out
          budget: 250.00,
          guidelines: "Draft a 15-page comparative analysis exploring the parameter efficiency and memory footprint differences between standard multi-head self-attention and Grouped-Query Attention (GQA). Enforce LaTeX equation syntax for all formalisms.",
          status: "unassigned",
          payoutStatus: "pending",
          customerId: currentCustomerId,
          writerId: null,
          proofreaderId: null,
          files: [],
          createdAt: timestamp,
          updatedAt: timestamp,
          currency: "USD"
        },
        {
          id: "PRJ-8002",
          title: "Organic Synthesis & Diels-Alder Lab Report",
          projectType: "academic_assignment",
          deadline: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 8 days out
          budget: 150.00, // K150.00 matching 6 pages
          guidelines: "Provide full mechanical steps of Diels-Alder reaction between anthracene and maleic anhydride. Include yield calculations, melting point analysis, and infrared spectroscopy peaks identification.",
          status: "in_progress",
          payoutStatus: "escrowed",
          customerId: currentCustomerId,
          writerId: "writer-1",
          proofreaderId: null,
          files: [],
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: timestamp,
          pageCount: 6,
          referencingStyle: "Harvard",
          ocrText: "ORGANIC CHEMISTRY: Anthracene and Maleic Anhydride Diels-Alder report guidelines...",
          currency: "ZMW",
          customerUniversity: "stanford_university",
          customerMajor: "bioinformatics",
          writerCommission: 75.00,
          proofreaderCommission: 25.01,
          databoyCommission: 49.99
        },
        {
          id: "PRJ-8003",
          title: "CRISPR-Cas9 Off-Target Mitigation Review",
          projectType: "academic_assignment",
          deadline: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 4 days out
          budget: 200.00, // K200.00 matching 10 pages
          guidelines: "An exhaustive literature review of recent techniques used to improve SpCas9 specificity, focusing on engineered variants (e.g. SpCas9-HF1, eSpCas9) and double-nicking protocols.",
          status: "draft_submitted",
          payoutStatus: "escrowed",
          customerId: currentCustomerId,
          writerId: "writer-1",
          proofreaderId: "proofreader-1",
          files: [
            {
              uid: "file-mock-1",
              name: "CRISPR_Review_Draft_v1.pdf",
              url: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2FCRISPR_Review_Draft_v1.pdf?alt=media",
              uploadedBy: "writer-1",
              uploadedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
              sizeBytes: 154209
            }
          ],
          createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: timestamp,
          pageCount: 10,
          referencingStyle: "APA",
          ocrText: "CRISPR Literature Review Instructions: SpCas9 off-target mechanisms...",
          currency: "ZMW",
          customerUniversity: "massachusetts_institute_of_technology",
          customerMajor: "computer_science_and_engineering",
          writerCommission: 100.00,
          proofreaderCommission: 33.34,
          databoyCommission: 66.66
        },
        {
          id: "PRJ-8004",
          title: "Solow Growth Model Endogenous Variable Adaptation",
          projectType: "data_analysis",
          deadline: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // Past
          budget: 180.00,
          guidelines: "Formulate the equations and step-by-step mathematical proofs showing how the standard Solow-Swan model changes when technology growth is modeled endogenously, incorporating human capital parameters.",
          status: "completed",
          payoutStatus: "released",
          customerId: currentCustomerId,
          writerId: "writer-2",
          proofreaderId: "proofreader-1",
          files: [
            {
              uid: "file-mock-2",
              name: "Endogenous_Solow_Proofs_Final.pdf",
              url: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2FEndogenous_Solow_Proofs_Final.pdf?alt=media",
              uploadedBy: "writer-2",
              uploadedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
              sizeBytes: 204561
            }
          ],
          createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          currency: "USD"
        },
        {
          id: "PRJ-8005",
          title: "Shor's Algorithm NISQ Constraints",
          projectType: "academic_assignment",
          deadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          budget: 100.00, // K100.00 matching 3 pages
          guidelines: "Detail quantum circuit structures for modular exponentiation in Shor's algorithm and outline the physical constraints of implementing this on Noisy Intermediate-Scale Quantum devices, emphasizing decoherence times.",
          status: "review_rejected",
          payoutStatus: "escrowed",
          customerId: currentCustomerId,
          writerId: "writer-2",
          proofreaderId: "proofreader-1",
          files: [
            {
              uid: "file-mock-3",
              name: "Shors_NISQ_Draft_v1.pdf",
              url: "https://firebasestorage.googleapis.com/v0/b/databoy-dev.appspot.com/o/mock%2FShors_NISQ_Draft_v1.pdf?alt=media",
              uploadedBy: "writer-2",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
              sizeBytes: 312048
            }
          ],
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          pageCount: 3,
          referencingStyle: "IEEE",
          ocrText: "SHORS NISQ Circuit design: Modular exponentiation constraints...",
          currency: "ZMW",
          customerUniversity: "university_of_oxford",
          customerMajor: "quantum_physics",
          writerCommission: 50.00,
          proofreaderCommission: 16.67,
          databoyCommission: 33.33
        }
      ];

      // 4. Save projects and seed their activity subcollections
      for (const proj of mockProjects) {
        // Write Project Doc
        const projRef = doc(db, PROJECTS_COLLECTION, proj.id);
        await setDoc(projRef, proj);
        count++;

        // Base activities timeline
        const acts: Omit<ProjectActivity, "id">[] = [];

        // Creation event (all)
        acts.push({
          type: "system_alert",
          actorId: currentCustomerId,
          actorName: currentCustomerName,
          actorRole: "customer",
          message: `Created project channel: "${proj.title}" with a budget of $${proj.budget.toFixed(2)}.`,
          createdAt: proj.createdAt
        });

        // Pipeline progression logic matching seeded status
        if (proj.id === "PRJ-8002") {
          // drafting
          acts.push({
            type: "status_change",
            actorId: "writer-1",
            actorName: "Dr. Elizabeth Blackwell",
            actorRole: "writer",
            message: "Status shifted from [unassigned] to [assigned]",
            metadata: { prevStatus: "unassigned", nextStatus: "assigned" },
            createdAt: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString()
          });
          acts.push({
            type: "comment",
            actorId: "writer-1",
            actorName: "Dr. Elizabeth Blackwell",
            actorRole: "writer",
            message: "Hello! I am reviewing your lab guidelines. Diels-Alder yields modeling is well within my chemistry focus. Starting calculations now.",
            createdAt: new Date(Date.now() - 1.2 * 24 * 60 * 60 * 1000).toISOString()
          });
        }

        if (proj.id === "PRJ-8003") {
          // review submitted
          acts.push({
            type: "status_change",
            actorId: "writer-1",
            actorName: "Dr. Elizabeth Blackwell",
            actorRole: "writer",
            message: "Status shifted from [unassigned] to [assigned]",
            metadata: { prevStatus: "unassigned", nextStatus: "assigned" },
            createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
          });
          acts.push({
            type: "file_upload",
            actorId: "writer-1",
            actorName: "Dr. Elizabeth Blackwell",
            actorRole: "writer",
            message: "Uploaded new asset: CRISPR_Review_Draft_v1.pdf",
            metadata: { fileName: "CRISPR_Review_Draft_v1.pdf", fileUrl: proj.files[0].url },
            createdAt: proj.files[0].uploadedAt
          });
          acts.push({
            type: "status_change",
            actorId: "writer-1",
            actorName: "Dr. Elizabeth Blackwell",
            actorRole: "writer",
            message: "Status shifted from [in_progress] to [draft_submitted]",
            metadata: { prevStatus: "in_progress", nextStatus: "draft_submitted" },
            createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
          });
          acts.push({
            type: "status_change",
            actorId: "proofreader-1",
            actorName: "Dr. Marie Curie",
            actorRole: "proofreader",
            message: "Status shifted from [draft_submitted] to [under_review]",
            metadata: { prevStatus: "draft_submitted", nextStatus: "under_review" },
            createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
          });
        }

        if (proj.id === "PRJ-8004") {
          // completed
          acts.push({
            type: "status_change",
            actorId: "writer-2",
            actorName: "Prof. Alan Turing",
            actorRole: "writer",
            message: "Status shifted from [unassigned] to [assigned]",
            metadata: { prevStatus: "unassigned", nextStatus: "assigned" },
            createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString()
          });
          acts.push({
            type: "file_upload",
            actorId: "writer-2",
            actorName: "Prof. Alan Turing",
            actorRole: "writer",
            message: "Uploaded new asset: Endogenous_Solow_Proofs_Final.pdf",
            metadata: { fileName: "Endogenous_Solow_Proofs_Final.pdf", fileUrl: proj.files[0].url },
            createdAt: proj.files[0].uploadedAt
          });
          acts.push({
            type: "status_change",
            actorId: "writer-2",
            actorName: "Prof. Alan Turing",
            actorRole: "writer",
            message: "Status shifted from [in_progress] to [draft_submitted]",
            metadata: { prevStatus: "in_progress", nextStatus: "draft_submitted" },
            createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
          });
          acts.push({
            type: "status_change",
            actorId: "proofreader-1",
            actorName: "Dr. Marie Curie",
            actorRole: "proofreader",
            message: "Status shifted from [draft_submitted] to [under_review]",
            metadata: { prevStatus: "draft_submitted", nextStatus: "under_review" },
            createdAt: new Date(Date.now() - 3.8 * 24 * 60 * 60 * 1000).toISOString()
          });
          acts.push({
            type: "status_change",
            actorId: "proofreader-1",
            actorName: "Dr. Marie Curie",
            actorRole: "proofreader",
            message: "Status shifted from [under_review] to [completed]",
            metadata: { prevStatus: "under_review", nextStatus: "completed" },
            createdAt: proj.updatedAt
          });
          acts.push({
            type: "comment",
            actorId: "proofreader-1",
            actorName: "Dr. Marie Curie",
            actorRole: "proofreader",
            message: "Excellent formalisms and neat proof sequences. The technology function parameter is flawlessly aligned to customer specifications. Payment is released.",
            createdAt: new Date(Date.now() - 2.9 * 24 * 60 * 60 * 1000).toISOString()
          });
        }

        if (proj.id === "PRJ-8005") {
          // review rejected / changes returned
          acts.push({
            type: "status_change",
            actorId: "writer-2",
            actorName: "Prof. Alan Turing",
            actorRole: "writer",
            message: "Status shifted from [unassigned] to [assigned]",
            metadata: { prevStatus: "unassigned", nextStatus: "assigned" },
            createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
          });
          acts.push({
            type: "file_upload",
            actorId: "writer-2",
            actorName: "Prof. Alan Turing",
            actorRole: "writer",
            message: "Uploaded new asset: Shors_NISQ_Draft_v1.pdf",
            metadata: { fileName: "Shors_NISQ_Draft_v1.pdf", fileUrl: proj.files[0].url },
            createdAt: proj.files[0].uploadedAt
          });
          acts.push({
            type: "status_change",
            actorId: "proofreader-1",
            actorName: "Dr. Marie Curie",
            actorRole: "proofreader",
            message: "Status shifted from [draft_submitted] to [under_review]",
            metadata: { prevStatus: "draft_submitted", nextStatus: "under_review" },
            createdAt: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString()
          });
          acts.push({
            type: "status_change",
            actorId: "proofreader-1",
            actorName: "Dr. Marie Curie",
            actorRole: "proofreader",
            message: "Status shifted from [under_review] to [review_rejected]",
            metadata: { prevStatus: "under_review", nextStatus: "review_rejected" },
            createdAt: proj.updatedAt
          });
          acts.push({
            type: "comment",
            actorId: "proofreader-1",
            actorName: "Dr. Marie Curie",
            actorRole: "proofreader",
            message: "The circuit diagram needs additional clarity on standard phase estimation gates. Please review section 3 and re-submit a cleaner structure.",
            createdAt: new Date(Date.now() - 0.9 * 24 * 60 * 60 * 1000).toISOString()
          });
        }

        // Commit all activity subcollection documents
        for (const act of acts) {
          const actRef = doc(collection(db, PROJECTS_COLLECTION, proj.id, ACTIVITY_SUBCOLLECTION));
          await setDoc(actRef, {
            ...act,
            id: actRef.id
          });
          count++;
        }
      }

      return { success: true, count };
    } catch (error) {
      console.error("Error in database seeder:", error);
      throw error;
    }
  },

  /**
   * Resets and cleans seeded mock projects and users from Firestore
   */
  async clearDatabase(currentCustomerId: string): Promise<{ success: boolean; count: number }> {
    const appEnv = (process.env.NEXT_PUBLIC_APP_ENV || "").trim().toLowerCase();
    const isLocalHost =
      typeof window !== "undefined" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (appEnv === "staging" || appEnv === "production" || !isLocalHost) {
      throw new Error("Client-side database clearing is disabled outside local development.");
    }

    let count = 0;
    try {
      // 1. Clear Mock Writers
      for (const writer of MOCK_WRITERS) {
        await deleteDoc(doc(db, USERS_COLLECTION, writer.uid));
        count++;
      }

      // 2. Clear Mock Proofreaders
      for (const proof of MOCK_PROOFREADERS) {
        await deleteDoc(doc(db, USERS_COLLECTION, proof.uid));
        count++;
      }

      // 3. Clear Mock Projects for this customer
      const projIds = ["PRJ-8001", "PRJ-8002", "PRJ-8003", "PRJ-8004", "PRJ-8005"];
      for (const id of projIds) {
        const projRef = doc(db, PROJECTS_COLLECTION, id);
        const docSnap = await getDocs(collection(db, PROJECTS_COLLECTION, id, ACTIVITY_SUBCOLLECTION));
        
        // Delete activities
        for (const actDoc of docSnap.docs) {
          await deleteDoc(actDoc.ref);
          count++;
        }

        // Delete project
        await deleteDoc(projRef);
        count++;
      }

      return { success: true, count };
    } catch (error) {
      console.error("Error clearing seeded data:", error);
      throw error;
    }
  }
};
