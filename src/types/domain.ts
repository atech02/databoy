export type UserRole = "customer" | "writer" | "proofreader" | "admin";
export type UserStatus = "active" | "suspended";
export type VerificationStatus = 
  | "draft" 
  | "incomplete" 
  | "pending_review" 
  | "clarification_required" 
  | "approved" 
  | "rejected";

export type UserAvailability = "available" | "busy" | "away" | "suspended";

export interface UserStatusHistoryEntry {
  status: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  timestamp: string;
  note?: string;
}

export interface VerificationDocuments {
  degreeCertificateUrl?: string;
  transcriptUrl?: string;
  cvUrl?: string;
  certificationsUrl?: string;
  publicationsUrl?: string;
  supportingDocsUrl?: string;
}

export interface AcademicProfile {
  phone: string;
  university: string;
  faculty: string;
  major: string; // degree program
  yearOfStudy: string; // graduation year or current year
  bio?: string;
  specializations?: string[]; // subject expertise
  documents?: VerificationDocuments;
}

export interface WriterProfileDetails {
  verificationStatus: VerificationStatus;
  rating: number;
  reputation: number;
  specialties: string[];
  educationLevel?: string;
  programOfStudy?: string;
  activeTaskMode?: "drafting" | "proofreading" | "idle";
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  verificationStatus?: VerificationStatus; // Default "unverified" / "draft" for writers
  writerStatus?: "active" | "inactive";     // Revision 1
  isVerifiedWriter?: boolean;               // Revision 1
  verifiedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  statusHistory?: UserStatusHistoryEntry[];  // Revision 7
  
  availability?: UserAvailability;          // Default "available" for writers/proofreaders
  reputation: number;        // Average rating (1-5) or 0 (Revision 5)
  completedCount: number;    // Total completed projects
  isOnboarded: boolean;
  profileCompletion: number; // 0 to 100
  academic?: AcademicProfile;
  
  // Future matching readiness fields (Revision 11)
  competencies?: string[];
  subjectExpertise?: string[];
  degreeLevel?: string;
  yearsOfExperience?: number;
  preferredWorkload?: number;
  averageRating?: number;
  completedAssignments?: number;

  // Review stats & logs (Revision 6)
  lastLoginDate?: string;
  submissionDate?: string;
  previousRejectionsCount?: number;
  previousClarificationsCount?: number;
  disputeCount?: number;
  revisionCount?: number;
  activeTaskCount?: number;

  // Extended fields for V1 profile consolidation (Revision 1)
  educationLevel?: string;   // For student/customer
  programOfStudy?: string;   // For student/customer
  writerProfile?: WriterProfileDetails; // Consolidated writer details
  preferences?: {
    emailNotifications?: boolean;
    smsNotifications?: boolean;
  };

  // Authoritative Ledger Financial Balances (Phase 4)
  availableBalance?: number;
  pendingBalance?: number;
  totalEarned?: number;
  totalPaidOut?: number;
  canProofread?: boolean;

  createdAt: string;
  updatedAt: string;
  metadata?: {
    specializations?: string[]; // For writers/proofreaders
    billingAddress?: string;    // For customers
  };
}

export type ProjectStatus =
  | "draft"              // Guidelines are being set up
  | "priced"             // Price calculated
  | "awaiting_payment"   // Priced, awaiting student funding
  | "funded"             // Payment secured in escrow
  | "awaiting_assignment" // Ready for matching/claiming
  | "unassigned"         // Looking for a writer
  | "assigned"           // Claimed by writer
  | "in_progress"        // Work in progress
  | "draft_submitted"    // Draft submitted for review
  | "under_review"       // Under proofreader review
  | "review_rejected"    // Rejected, returned to writer
  | "completed"          // Approved and payout released
  | "disputed"           // Dispute active
  | "cancelled";         // Project cancelled

export type PayoutStatus = "pending" | "escrowed" | "released" | "refunded";

export interface ProjectFile {
  uid: string;
  name: string;
  url: string;
  uploadedBy: string;
  uploadedAt: string;
  sizeBytes: number;
  fileId?: string;
  storageKey?: string;
  storagePath?: string;
  storageProvider?: "r2" | "firebase_legacy";
  contentType?: string;
}

export interface StatusHistoryEntry {
  status: ProjectStatus;
  actorId: string;
  actorName: string;
  actorRole: string;
  timestamp: string;
  note?: string;
}

export interface PricingBreakdown {
  pages: number;
  academicLevel: string;
  baseRatePerPage: number;
  urgencyBand: string;
  urgencyMultiplier: number;
  serviceType: string;
  serviceMultiplier: number;
  subtotal: number;
  total: number;
  currency: "ZMW";
}

export interface Project {
  id: string;
  title: string;
  projectType: string; // Type of academic task (Assignment, Essay, etc.)
  deadline: string;
  budget: number;
  guidelines: string;
  status: ProjectStatus;
  payoutStatus: PayoutStatus;
  customerId: string;
  writerId: string | null; // Keep writerId internally for compat with firestore.rules
  proofreaderId: string | null; // Keep proofreaderId internally for compat with firestore.rules
  files: ProjectFile[];
  createdAt: string;
  updatedAt: string;
  pageCount?: number;
  wordCount?: number;
  referencingStyle?: string;
  ocrText?: string;
  ocrParsedFields?: any;
  ocrMetrics?: any;
  extractionMethod?: "docx_direct" | "pdf_direct" | "gemini_image" | "gemini_scanned_pdf";
  confidenceLevel?: "high" | "medium" | "low";
  specialInstructions?: string;
  currency?: "ZMW" | "USD";
  writerCommission?: number;
  proofreaderCommission?: number;
  databoyCommission?: number;
  customerUniversity?: string;
  customerMajor?: string;
  // V2 assignment operations fields
  academicLevel?: string;              // diploma | degree | masters | phd | high_school
  subject?: string;                    // Subject area key from SUBJECT_EXPERTISE
  escrowMode?: "simulated" | "live";   // V1 = simulated always
  escrowStatus?: "pending_funding" | "funded" | "held" | "released" | "refunded";
  allocationStatus?: "pending" | "offered" | "accepted" | "timed_out" | "pool";
  allocationAttempts?: number;          // How many writers were offered
  currentOfferWriterId?: string | null; // Writer currently being offered
  offerExpiresAt?: string | null;       // ISO timestamp when offer expires
  statusHistory?: StatusHistoryEntry[]; // Full status audit trail
  pricingBreakdown?: PricingBreakdown;  // Full pricing breakdown for transparency
  paymentMode?: "test" | "real";
  paymentStatus?: "awaiting_payment" | "funded" | "refunded";
  fundedAt?: string;
  releasedAt?: string;
  refundedAt?: string;
  paymentReference?: string;
  paymentNetwork?: string;
  simulatedPaymentHistory?: any[];
}

export type ActivityType = "comment" | "status_change" | "file_upload" | "system_alert";

export interface ProjectActivity {
  id: string;
  type: ActivityType;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  message: string;
  metadata?: {
    prevStatus?: ProjectStatus;
    nextStatus?: ProjectStatus;
    fileName?: string;
    fileUrl?: string;
  };
  createdAt: string;
}

export type TransactionType = "escrow_load" | "payout_release" | "refund_return" | "platform_fee";
export type TransactionStatus = "pending" | "completed" | "failed";

export interface WalletTransaction {
  id: string;
  projectId: string; // Refactored from assignmentId
  userId: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  createdAt: string;
}

export interface Review {
  id: string;
  projectId: string; // Refactored from assignmentId
  reviewerId: string;
  revieweeId: string;
  rating: number; // 1-5
  comment: string;
  createdAt: string;
}

// Research Request Status Trail (Simplified - Status Refinement)
export type ResearchRequestStatus =
  | "submitted"
  | "under_review"
  | "needs_clarification"
  | "quote_ready"
  | "awaiting_payment"
  | "funded"
  | "assigned"
  | "in_progress"
  | "submitted_for_review" // (e.g. writer uploaded draft, awaiting admin/student review)
  | "revision_requested"
  | "completed"
  | "disputed"
  | "cancelled";

export interface ClarificationMessage {
  senderId: string;
  senderRole: UserRole;
  senderName: string;
  message: string;
  createdAt: string;
  attachmentUrl?: string;
  attachmentName?: string;
}

export interface ResearchRequest {
  id: string;
  studentId: string;
  title: string;
  requestTypes: string[]; // topic_generation, proposal_writing, etc.
  otherDetails?: string;  // For "Other Research Support" selection details
  pastedBrief: string;
  expectedDeliverable: string; // Revision 6
  subject: string;
  levelOfStudy: string;
  deadline: string;
  status: ResearchRequestStatus;
  
  // Quote fields stored directly inside the request (Revision 3)
  quoteAmount?: number;
  quoteNotes?: string;
  quoteStatus?: "pending_acceptance" | "accepted" | "rejected" | "paid";

  assignedWriterId?: string | null;
  adminReviewedBy?: string | null;
  clarificationNeeded?: boolean;
  clarificationThread?: ClarificationMessage[]; // Revision 7 (array-based threads)
  
  files?: ProjectFile[];
  createdAt: string;
  updatedAt: string;
}

export interface DisputeTimelineEntry {
  actorId: string;
  actorName: string;
  actorRole: UserRole | "system";
  action: string;
  details: string;
  createdAt: string;
}

export interface Dispute {
  disputeId: string;
  relatedType: "assignment" | "research";
  relatedId: string;
  studentId: string;
  writerId: string;
  reason: string;
  status: "open" | "resolved";
  resolution?: string;
  adminNotes?: string;
  evidence?: string[];         // Download URLs for uploaded evidence files
  timeline?: DisputeTimelineEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  logId: string;
  actorId: string;
  actorRole: UserRole | "system";
  action: string;
  targetId: string;
  targetType: "user" | "assignment" | "research" | "dispute" | "system";
  details: string;
  createdAt: string;
}

export interface PlatformAuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole | "system";
  action: string;
  targetId: string;
  targetType: "user" | "assignment" | "research" | "dispute" | "system";
  details: string;
  createdAt: string;
}

export type NotificationType =
  | "assignment_created"
  | "assignment_funded"
  | "assignment_offered"
  | "assignment_claimed"
  | "writer_timeout"
  | "pool_opened"
  | "draft_submitted"
  | "revision_requested"
  | "assignment_completed"
  | "dispute_opened"
  | "system";

export interface Notification {
  id: string;
  userId: string;          // Target recipient UID
  type: NotificationType;
  title: string;
  message: string;
  relatedId?: string;      // projectId | researchRequestId | disputeId
  relatedType?: "assignment" | "research" | "dispute" | "system";
  relatedUrl?: string;     // Direct navigation path
  read: boolean;
  createdAt: string;
}


