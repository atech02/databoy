/**
 * DataBoy Assignment Pricing Engine — V1
 *
 * Rule-based, deterministic pricing for standard academic assignments.
 * Research pricing is NOT handled here — research remains manually quoted by admin.
 *
 * Formula:
 *   total = pages × baseRate × urgencyMultiplier × serviceMultiplier
 */

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

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

export interface CommissionBreakdown {
  writer: number;
  proofreader: number;
  databoy: number;
}

// ---------------------------------------------------------------------------
// RATE TABLES  (all figures in ZMW)
// ---------------------------------------------------------------------------

/** Base price per page by academic level */
export const ACADEMIC_LEVEL_RATES: Record<string, number> = {
  high_school: 18,
  diploma: 22,
  degree: 28,
  masters: 38,
  phd: 52,
};

/** Urgency multipliers keyed by minimum days until deadline */
const URGENCY_TIERS = [
  { minDays: 7, multiplier: 1.0, label: "Standard (7+ days)" },
  { minDays: 4, multiplier: 1.25, label: "Moderate (4–6 days)" },
  { minDays: 2, multiplier: 1.55, label: "Rush (2–3 days)" },
  { minDays: 0, multiplier: 2.1, label: "Urgent (<48 hours)" },
];

/** Service type multipliers */
export const SERVICE_TYPE_MULTIPLIERS: Record<string, number> = {
  assignment: 1.0,
  essay: 1.0,
  coursework: 1.0,
  report: 1.1,
  case_study: 1.15,
  research_proposal: 1.2,
  literature_review: 1.2,
  dissertation: 1.35,
  thesis: 1.35,
  data_analysis: 1.25,
  proofreading: 0.55,
  referencing: 0.4,
  formatting: 0.35,
  default: 1.0,
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Convert word count to pages (1 page ≈ 250 words) */
export const wordsToPages = (wordCount: number): number =>
  Math.max(1, Math.ceil(wordCount / 250));

/** Get urgency multiplier + label from days until deadline */
export const getUrgencyTier = (
  daysUntilDeadline: number
): { multiplier: number; label: string } => {
  for (const tier of URGENCY_TIERS) {
    if (daysUntilDeadline >= tier.minDays) {
      return { multiplier: tier.multiplier, label: tier.label };
    }
  }
  // Fallback: treat as urgent
  return { multiplier: 2.1, label: "Urgent (<48 hours)" };
};

/** Calculate days from today to a deadline date string (YYYY-MM-DD) */
export const getDaysUntilDeadline = (deadlineStr: string): number => {
  if (!deadlineStr) return 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(deadlineStr);
  const diffMs = deadline.getTime() - today.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

// ---------------------------------------------------------------------------
// MAIN PRICING FUNCTION
// ---------------------------------------------------------------------------

/**
 * Calculates assignment pricing with full breakdown.
 * @param pages        Number of pages required
 * @param academicLevel  Level key (diploma | degree | masters | phd | high_school)
 * @param daysUntilDeadline  Days from today to deadline (0 = due today)
 * @param serviceType  projectType string from PROJECT_TYPES
 * @returns PricingBreakdown with all multipliers and totals
 */
export const calculateAssignmentPricing = (
  pages: number,
  academicLevel: string,
  daysUntilDeadline: number,
  serviceType: string = "assignment"
): PricingBreakdown => {
  const baseRate = ACADEMIC_LEVEL_RATES[academicLevel] ?? ACADEMIC_LEVEL_RATES["degree"];
  const { multiplier: urgencyMultiplier, label: urgencyBand } = getUrgencyTier(daysUntilDeadline);
  const serviceMultiplier = SERVICE_TYPE_MULTIPLIERS[serviceType] ?? SERVICE_TYPE_MULTIPLIERS["default"];

  const subtotal = pages * baseRate;
  const total = Math.ceil(subtotal * urgencyMultiplier * serviceMultiplier);

  return {
    pages,
    academicLevel,
    baseRatePerPage: baseRate,
    urgencyBand,
    urgencyMultiplier,
    serviceType,
    serviceMultiplier,
    subtotal,
    total,
    currency: "ZMW",
  };
};

// ---------------------------------------------------------------------------
// LEGACY COMPAT (preserved for any existing usages — delegates to new engine)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use calculateAssignmentPricing() instead for full breakdown.
 * Preserved for backward compat with existing code referencing calculateAcademicPricing.
 */
export const calculateAcademicPricing = (pages: number): number => {
  if (pages >= 1 && pages <= 4) return 100;
  if (pages >= 5 && pages <= 7) return 150;
  if (pages >= 8 && pages <= 11) return 200;
  if (pages >= 12 && pages <= 15) return 250;
  return 100;
};

// ---------------------------------------------------------------------------
// COMMISSION BREAKDOWN
// ---------------------------------------------------------------------------

/**
 * Calculates platform commission distribution:
 * - Writer = 50%
 * - Proofreader = 16.67%
 * - DataBoy = 33.33%
 */
export const calculateCommissionBreakdown = (budget: number): CommissionBreakdown => ({
  writer: parseFloat((budget * 0.50).toFixed(2)),
  proofreader: parseFloat((budget * 0.1667).toFixed(2)),
  databoy: parseFloat((budget * 0.3333).toFixed(2)),
});
