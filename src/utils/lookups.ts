export interface LookupOption {
  value: string;
  label: string;
}

export const UNIVERSITIES: LookupOption[] = [
  { value: "university_of_oxford", label: "University of Oxford" },
  { value: "stanford_university", label: "Stanford University" },
  { value: "massachusetts_institute_of_technology", label: "Massachusetts Institute of Technology (MIT)" },
  { value: "harvard_university", label: "Harvard University" },
  { value: "university_of_california_berkeley", label: "University of California, Berkeley" },
  { value: "cambridge_university", label: "University of Cambridge" },
  { value: "yale_university", label: "Yale University" },
  { value: "imperial_college_london", label: "Imperial College London" }
];

export const FACULTIES: LookupOption[] = [
  { value: "faculty_of_engineering_and_computer_science", label: "Faculty of Engineering & Computer Science" },
  { value: "faculty_of_economics_and_finance", label: "Faculty of Economics & Finance" },
  { value: "faculty_of_sciences", label: "Faculty of Sciences" },
  { value: "faculty_of_business_and_law", label: "Faculty of Business & Law" },
  { value: "faculty_of_humanities_and_social_sciences", label: "Faculty of Humanities & Social Sciences" }
];

export const MAJORS: Record<string, LookupOption[]> = {
  faculty_of_engineering_and_computer_science: [
    { value: "computer_science_and_engineering", label: "Computer Science & Engineering" },
    { value: "software_engineering", label: "Software Engineering" },
    { value: "electrical_engineering", label: "Electrical Engineering" },
    { value: "data_science_and_analytics", label: "Data Science & Analytics" }
  ],
  faculty_of_economics_and_finance: [
    { value: "financial_economics", label: "Financial Economics" },
    { value: "econometrics", label: "Econometrics" },
    { value: "actuarial_science", label: "Actuarial Science" },
    { value: "investment_banking", label: "Investment & Banking" }
  ],
  faculty_of_sciences: [
    { value: "molecular_and_cellular_biology", label: "Molecular & Cellular Biology" },
    { value: "bioinformatics", label: "Bioinformatics" },
    { value: "quantum_physics", label: "Quantum Physics" },
    { value: "organic_chemistry", label: "Organic Chemistry" }
  ],
  faculty_of_business_and_law: [
    { value: "business_administration", label: "Business Administration" },
    { value: "corporate_governance_law", label: "Corporate Governance Law" },
    { value: "marketing_strategy", label: "Marketing Strategy" },
    { value: "finance_accounting", label: "Finance & Accounting" }
  ],
  faculty_of_humanities_and_social_sciences: [
    { value: "english_literature", label: "English Literature" },
    { value: "clinical_psychology", label: "Clinical Psychology" },
    { value: "political_philosophy", label: "Political Philosophy" },
    { value: "international_relations", label: "International Relations" }
  ]
};

export const YEARS_OF_STUDY: LookupOption[] = [
  { value: "year_1", label: "Year 1 (Freshman)" },
  { value: "year_2", label: "Year 2 (Sophomore)" },
  { value: "year_3", label: "Year 3 (Junior)" },
  { value: "year_4", label: "Year 4 (Senior)" },
  { value: "postgraduate", label: "Postgraduate (Masters/PhD)" }
];

// Academic Subject Expertise for Writers and Proofreaders
export const SUBJECT_EXPERTISE: LookupOption[] = [
  { value: "computer_science", label: "Computer Science & Programming" },
  { value: "mathematics", label: "Mathematics & Statistics" },
  { value: "engineering", label: "Engineering" },
  { value: "physics_chemistry", label: "Physics & Chemistry" },
  { value: "biological_sciences", label: "Biological & Health Sciences" },
  { value: "business_finance", label: "Business, Economics & Finance" },
  { value: "humanities_arts", label: "Humanities & Arts" },
  { value: "social_sciences", label: "Social Sciences & Psychology" },
  { value: "law", label: "Law & Legal Studies" }
];

// Standard Project Types for DataBoy Knowledge-Services
export const PROJECT_TYPES: LookupOption[] = [
  { value: "assignment", label: "Assignment" },
  { value: "research_proposal", label: "Research Proposal" },
  { value: "dissertation", label: "Dissertation" },
  { value: "thesis", label: "Thesis" },
  { value: "report", label: "Report" },
  { value: "coursework", label: "Coursework" },
  { value: "data_analysis", label: "Data Analysis" },
  { value: "proofreading", label: "Proofreading" },
  { value: "referencing", label: "Referencing" },
  { value: "formatting", label: "Formatting" }
];

// Academic levels for pricing engine
export const ACADEMIC_LEVELS: LookupOption[] = [
  { value: "high_school", label: "High School" },
  { value: "diploma", label: "Diploma / Certificate" },
  { value: "degree", label: "Undergraduate Degree" },
  { value: "masters", label: "Masters / Postgraduate" },
  { value: "phd", label: "PhD / Doctoral" },
];

// REFERENCING_STYLES for convenience
export const REFERENCING_STYLES: LookupOption[] = [
  { value: "APA", label: "APA 7th Edition" },
  { value: "Harvard", label: "Harvard Reference" },
  { value: "MLA", label: "MLA Citation Format" },
  { value: "Chicago", label: "Chicago Style" },
  { value: "IEEE", label: "IEEE (Engineering)" },
  { value: "Vancouver", label: "Vancouver (Medicine)" },
  { value: "Other", label: "Other / Unconstrained" },
];

export interface CompetencyItem {
  value: string;
  label: string;
}

export interface CompetencyCategory {
  categoryName: string;
  items: CompetencyItem[];
}

export const COMPETENCY_CATEGORIES: CompetencyCategory[] = [
  {
    categoryName: "Business & Finance",
    items: [
      { value: "Accounting", label: "Accounting" },
      { value: "Finance", label: "Finance" },
      { value: "Economics", label: "Economics" },
      { value: "Banking", label: "Banking" },
      { value: "Marketing", label: "Marketing" },
      { value: "Procurement", label: "Procurement" }
    ]
  },
  {
    categoryName: "Computer Science & IT",
    items: [
      { value: "Programming", label: "Programming" },
      { value: "Databases", label: "Databases" },
      { value: "Networks", label: "Networks" },
      { value: "Cybersecurity", label: "Cybersecurity" },
      { value: "AI", label: "Artificial Intelligence (AI)" }
    ]
  },
  {
    categoryName: "Engineering",
    items: [
      { value: "Electrical", label: "Electrical Engineering" },
      { value: "Mechanical", label: "Mechanical Engineering" },
      { value: "Civil", label: "Civil Engineering" },
      { value: "Mining", label: "Mining Engineering" },
      { value: "Chemical", label: "Chemical Engineering" }
    ]
  },
  {
    categoryName: "Science",
    items: [
      { value: "Mathematics", label: "Mathematics" },
      { value: "Statistics", label: "Statistics" },
      { value: "Physics", label: "Physics" },
      { value: "Chemistry", label: "Chemistry" },
      { value: "Biology", label: "Biology" }
    ]
  },
  {
    categoryName: "Humanities",
    items: [
      { value: "History", label: "History" },
      { value: "Literature", label: "Literature" },
      { value: "Philosophy", label: "Philosophy" },
      { value: "Theology", label: "Theology" }
    ]
  },
  {
    categoryName: "Social Sciences",
    items: [
      { value: "Psychology", label: "Psychology" },
      { value: "Sociology", label: "Sociology" },
      { value: "Political Science", label: "Political Science" },
      { value: "Development Studies", label: "Development Studies" }
    ]
  },
  {
    categoryName: "Education",
    items: [
      { value: "Primary Education", label: "Primary Education" },
      { value: "Secondary Education", label: "Secondary Education" },
      { value: "Educational Management", label: "Educational Management" }
    ]
  },
  {
    categoryName: "Law",
    items: [
      { value: "Corporate Law", label: "Corporate Law" },
      { value: "Constitutional Law", label: "Constitutional Law" },
      { value: "Commercial Law", label: "Commercial Law" }
    ]
  },
  {
    categoryName: "Medicine & Health",
    items: [
      { value: "Nursing", label: "Nursing" },
      { value: "Public Health", label: "Public Health" },
      { value: "Medicine", label: "Medicine" },
      { value: "Pharmacy", label: "Pharmacy" }
    ]
  }
];

