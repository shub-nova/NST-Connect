// The category taxonomy. Edit here and re-run the seed to change what students can pick.
// `slug` only drives the seeded POC email addresses (e.g. hostel.l1.1@newtonschool.co).

export interface CategorySeed {
  name: string;
  shortName: string;
  slug: string;
  subCategories: string[];
}

export const CATEGORIES: CategorySeed[] = [
  {
    name: 'Hostel & Accommodation',
    shortName: 'Hostel',
    slug: 'hostel',
    subCategories: [
      'Room Allocation, Change & Retention Requests',
      'Maintenance, Repairs & Complaint Responsiveness',
      'Hostel Safety & Night-Time Security',
      'Hostel Wi-Fi & Power Reliability',
      'Laundry Services',
      'Hostel Stay Policy Concerns',
      'Belongings & Luggage Issues',
    ],
  },
  {
    name: 'Food, Mess & Canteen',
    shortName: 'Mess & Food',
    slug: 'mess',
    subCategories: [
      'Mess Food Quality, Hygiene & Nutrition',
      'Food Safety Incident (contamination / health emergency)',
      'Meal Coupon / Meal Access Friction',
    ],
  },
  {
    name: 'Academics - Teaching, Curriculum & Faculty',
    shortName: 'Academics',
    slug: 'academics',
    subCategories: [
      'Faculty Teaching Quality, Clarity & Engagement',
      'Lab Session Quality & Effectiveness',
      'Revision & Practice Gaps',
      'Curriculum Pace & Deadline Density (workload overload)',
      'Course Sequencing & Track Suggestions',
      "Contest/Assessment Weightage vs. What's Taught",
    ],
  },
  {
    name: 'Examinations, Evaluation & Grading',
    shortName: 'Exams & Grading',
    slug: 'exams',
    subCategories: [
      'Exam Eligibility, Passing Criteria & Scheduling Queries',
      'Re-evaluation & Marks Discrepancy Requests',
      'Academic Integrity / Unfair Means Concerns',
      'Medical/Emergency Exam Rescheduling',
      'Contest Reschedule & Marks Requests',
      'Backlog & Summer-Term Exam Registration',
      'Exam Platform Technical Reliability',
    ],
  },
  {
    name: 'Attendance & Leave',
    shortName: 'Attendance & Leave',
    slug: 'attendance',
    subCategories: [
      'Attendance Deduction / Discrepancy Disputes',
      'Attendance System / Face-Recognition Technical Failures',
      'Medical Leave & Health-Related Absence',
      'Emergency / Personal Leave Requests',
      'Extended Leave / Travel-Home Permission',
    ],
  },
  {
    name: 'Fees, Scholarships & Financial Matters',
    shortName: 'Fees & Finance',
    slug: 'fees',
    subCategories: [
      'Fee Structure, Payment & Breakdown Queries',
      'Fee Receipt & Invoice Issues',
      'Scholarship Application, Eligibility & Reconsideration',
      'Education Loan / Bank Verification Support',
    ],
  },
  {
    name: 'Post Admission Document Requirements',
    shortName: 'Documents',
    slug: 'documents',
    subCategories: [
      'Bonafide, Transfer & Migration Certificate Requests',
      'Gap Certificate & Other Document Requests',
      'Admission Document Submission Issues',
    ],
  },
  {
    name: 'Internship, Placement & Progression Mentoring',
    shortName: 'Internship & Placement',
    slug: 'placements',
    subCategories: [
      'Internship Offer, Confirmation & Mandatory-Requirement Queries',
      'Monthly Internship Report Verification',
      'Internship Discontinuation / Change of Plan',
      'Placement Interview Scheduling',
      'Project / Assignment Grading Discrepancy',
      'Progression Manager/Mentor (PM/PI) Continuity Gaps',
      'Mentoring Cadence & Quality',
      'Career / Profile Review Requests',
    ],
  },
  {
    name: 'Campus Infrastructure, IT & Facilities',
    shortName: 'Campus & IT',
    slug: 'campus',
    subCategories: [
      'Campus Wi-Fi & IT Connectivity',
      'Newton Portal / LMS / Email / ADYPU ERP Account Access',
      'Sports / Robotics Lab',
      'College Transport / Bus Reliability',
      'Timetable & Room-Change Communication',
      'MacBook / Device (ADLD) Issues',
    ],
  },
  {
    name: 'Student Activities & Campus Life',
    shortName: 'Student Life',
    slug: 'activities',
    subCategories: [
      'Club Functioning & Regularity',
      'Club-Academic Timing Clashes',
      'Shared Lab/Equipment Access for Clubs',
      'Activity Awareness & Communication',
      'Opportunity/Internship Information Fragmentation',
      'Teammate / Collaborator Discovery for Projects & Hackathons',
      'Extracurricular Balance',
    ],
  },
  {
    // For anything the other categories do not cover. The student describes it in the title
    // and description, so there is just one sub-category and the form does not ask for it.
    name: 'Other',
    shortName: 'Other',
    slug: 'other',
    subCategories: ['Other (please describe)'],
  },
];
