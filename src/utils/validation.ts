import { 
  UserProfile, 
  Project, 
  ProjectActivity, 
  UserRole, 
  UserStatus, 
  ProjectStatus,
  PayoutStatus,
  ActivityType
} from "@/types/domain";
import { calculateAssignmentPricing, getDaysUntilDeadline } from "@/utils/pricing";

// Basic regex for standard email validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateUserProfile = (data: Partial<UserProfile>): string[] => {
  const errors: string[] = [];

  if (!data.uid || typeof data.uid !== "string" || data.uid.trim() === "") {
    errors.push("Invalid User ID (uid) is required.");
  }
  if (!data.email || !EMAIL_REGEX.test(data.email)) {
    errors.push("Invalid email format.");
  }
  if (!data.displayName || data.displayName.trim().length < 2) {
    errors.push("Display name must be at least 2 characters.");
  }

  const validRoles: UserRole[] = ["customer", "writer", "proofreader", "admin"];
  if (!data.role || !validRoles.includes(data.role)) {
    errors.push(`Invalid role. Must be one of: ${validRoles.join(", ")}`);
  }

  const validStatuses: UserStatus[] = ["active", "suspended"];
  if (!data.status || !validStatuses.includes(data.status)) {
    errors.push(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  if (data.reputation !== undefined && data.reputation !== null) {
    if (typeof data.reputation !== "number" || Number.isNaN(data.reputation) || !Number.isFinite(data.reputation)) {
      errors.push("Reputation score must be a valid number.");
    } else if (data.reputation !== 0 && (data.reputation < 1.0 || data.reputation > 5.0)) {
      errors.push("Reputation score must be between 1.0 and 5.0 (or 0 for unrated users).");
    }
  }

  // Validate academic onboarding attributes if onboarded
  if (data.isOnboarded) {
    if (!data.academic) {
      errors.push("Academic profile details are required upon onboarding completion.");
    } else {
      const acad = data.academic;
      
      // Common check: major and yearOfStudy are required for both Student (customer) and Writer roles
      if (!acad.major || acad.major.trim().length === 0) {
        errors.push("Major or Program of Study is required.");
      }
      if (!acad.yearOfStudy || acad.yearOfStudy.trim().length === 0) {
        errors.push("Education Level or Qualification is required.");
      }

      // Writer specific checks
      if (data.role === "writer") {
        if (!acad.specializations || acad.specializations.length === 0) {
          errors.push("At least one Field of Expertise must be selected.");
        }
        if (acad.bio && acad.bio.trim().length > 300) {
          errors.push("Short biography must not exceed 300 characters.");
        }
      }
    }
  }

  return errors;
};

export const validateProject = (data: Partial<Project>): string[] => {
  const errors: string[] = [];

  if (!data.title || data.title.trim().length < 5) {
    errors.push("Project title must be at least 5 characters.");
  }
  if (!data.projectType || data.projectType.trim().length === 0) {
    errors.push("Project type category is required.");
  }
  if (!data.deadline || isNaN(Date.parse(data.deadline))) {
    errors.push("Invalid or missing deadline date.");
  }
  if (data.budget === undefined || typeof data.budget !== "number" || data.budget <= 0) {
    errors.push("Budget must be a positive number.");
  }
  if (!data.guidelines || data.guidelines.trim().length < 10) {
    errors.push("Guidelines must provide at least 10 characters of instructions.");
  }
  if (!data.customerId || typeof data.customerId !== "string") {
    errors.push("Customer ID link is required.");
  }

  const validStatuses: ProjectStatus[] = [
    "draft", "priced", "awaiting_payment", "funded", "awaiting_assignment", "unassigned", "assigned", "in_progress", 
    "draft_submitted", "under_review", "review_rejected", 
    "completed", "disputed", "cancelled"
  ];
  if (data.status && !validStatuses.includes(data.status)) {
    errors.push("Invalid project pipeline status.");
  }

  const validPayouts: PayoutStatus[] = ["pending", "escrowed", "released", "refunded"];
  if (data.payoutStatus && !validPayouts.includes(data.payoutStatus)) {
    errors.push("Invalid escrow payout status.");
  }

  // Academic Assignment Engine (Engine One) Constraints
  if (data.projectType === "academic_assignment") {
    if (data.pageCount === undefined || data.pageCount < 1 || data.pageCount > 15) {
      errors.push("Academic assignments must specify a page count between 1 and 15 pages.");
    } else {
      const level = data.academicLevel || "degree";
      const deadline = data.deadline || "";
      const daysUntilDeadline = getDaysUntilDeadline(deadline);
      const serviceType = data.projectType || "assignment";
      const pricing = calculateAssignmentPricing(data.pageCount, level, daysUntilDeadline, serviceType);
      const expectedPrice = pricing.total;
      if (data.budget !== expectedPrice) {
        errors.push(`Budget of K${data.budget} does not match expected page count pricing of K${expectedPrice}.`);
      }
    }

    if (!data.referencingStyle || data.referencingStyle.trim() === "") {
      errors.push("Referencing style is required for academic assignments.");
    }

    if (!data.ocrText || data.ocrText.trim() === "") {
      errors.push("Simulated OCR text transcription is required for automated processing.");
    }

    if (data.currency !== "ZMW") {
      errors.push("Academic assignments pricing currency must be ZMW.");
    }
  }

  return errors;
};

export const validateActivity = (data: Partial<ProjectActivity>): string[] => {
  const errors: string[] = [];

  const validTypes: ActivityType[] = ["comment", "status_change", "file_upload", "system_alert"];
  if (!data.type || !validTypes.includes(data.type)) {
    errors.push("Invalid activity log type.");
  }
  if (!data.actorId || typeof data.actorId !== "string") {
    errors.push("Actor ID link is required.");
  }
  if (!data.actorName || data.actorName.trim().length === 0) {
    errors.push("Actor name is required.");
  }
  if (!data.message || data.message.trim().length === 0) {
    errors.push("Activity message cannot be left blank.");
  }

  return errors;
};
