/**
 * DataBoy Server-Side Pricing Engine
 *
 * Authoritative, rule-based, deterministic pricing for standard academic assignments.
 * Research pricing remains manually quoted by admin.
 *
 * Formula:
 *   total = pages * baseRate * urgencyMultiplier * serviceMultiplier
 */
export const ACADEMIC_LEVEL_RATES = {
    high_school: 18,
    diploma: 22,
    degree: 28,
    masters: 38,
    phd: 52,
};
export const URGENCY_TIERS = [
    { minDays: 7, multiplier: 1.0, label: "Standard (7+ days)" },
    { minDays: 4, multiplier: 1.25, label: "Moderate (4–6 days)" },
    { minDays: 2, multiplier: 1.55, label: "Rush (2–3 days)" },
    { minDays: 0, multiplier: 2.1, label: "Urgent (<48 hours)" },
];
export const SERVICE_TYPE_MULTIPLIERS = {
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
export const wordsToPages = (wordCount) => Math.max(1, Math.ceil(wordCount / 250));
export const getUrgencyTier = (daysUntilDeadline) => {
    for (const tier of URGENCY_TIERS) {
        if (daysUntilDeadline >= tier.minDays) {
            return { multiplier: tier.multiplier, label: tier.label };
        }
    }
    return { multiplier: 2.1, label: "Urgent (<48 hours)" };
};
export const calculateDaysUntilDeadline = (deadlineStr) => {
    if (!deadlineStr)
        return 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(deadlineStr);
    const diffMs = deadline.getTime() - today.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};
export const calculateAssignmentPricing = (pages, academicLevel, daysUntilDeadline, serviceType = "assignment") => {
    const safePages = Math.max(1, Math.floor(pages || 1));
    const baseRate = ACADEMIC_LEVEL_RATES[academicLevel] ?? ACADEMIC_LEVEL_RATES["degree"];
    const { multiplier: urgencyMultiplier, label: urgencyBand } = getUrgencyTier(daysUntilDeadline);
    const serviceMultiplier = SERVICE_TYPE_MULTIPLIERS[serviceType] ?? SERVICE_TYPE_MULTIPLIERS["default"];
    const subtotal = safePages * baseRate;
    const total = Math.ceil(subtotal * urgencyMultiplier * serviceMultiplier);
    return {
        pages: safePages,
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
export const calculateCommissionBreakdown = (budget) => {
    const writer = parseFloat((budget * 0.50).toFixed(2));
    const proofreader = parseFloat((budget * 0.1667).toFixed(2));
    const databoy = parseFloat((budget - writer - proofreader).toFixed(2));
    return { writer, proofreader, databoy };
};
