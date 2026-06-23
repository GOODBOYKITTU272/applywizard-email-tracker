export interface CA {
  id: string;
  name: string;
  email: string;
  totalClients: number;
  connectedMailboxes: number;
  applications: number;
  interviews: number;
  assessments: number;
  rejections: number;
  reviewRequired: number;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  mailbox: string;
  mailboxStatus: "healthy" | "needs_reconnect";
  caId: string;
  caName: string;
  emailsToday: number;
  pendingClassification: number;
  reviewRequired: number;
  applicationsCount: number;
  interviewsCount: number;
  assessmentsCount: number;
  rejectionsCount: number;
}

export interface Application {
  id: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  mailbox: string;
  caId: string;
  caName: string;
  companyName: string;
  jobTitle: string;
  sender: string;
  subject: string;
  receivedDate: string;
  folderName: string;
  category:
    | "application_received"
    | "assessment"
    | "interview_invite"
    | "rejection"
    | "job_offer"
    | "recruiter_reply"
    | "follow_up_needed"
    | "otp_verification"
    | "email_verification"
    | "account_created"
    | "system_notification"
    | "spam_or_irrelevant"
    | "unknown";
  confidence: number;
  status: "pending" | "classified" | "failed";
  needsHumanReview: boolean;
  actionRequired: string | null;
  deadline: string | null;
  body: string;
}

// ── Mock CAs ──────────────────────────────────────────────────────────────────
export const mockCAs: CA[] = [
  {
    id: "ca1",
    name: "Amit Sharma",
    email: "amit@applywizard.ai",
    totalClients: 3,
    connectedMailboxes: 3,
    applications: 14,
    interviews: 4,
    assessments: 3,
    rejections: 5,
    reviewRequired: 2,
  },
  {
    id: "ca2",
    name: "Priya Patel",
    email: "priya@applywizard.ai",
    totalClients: 3,
    connectedMailboxes: 2, // One mailbox needs reconnect
    applications: 18,
    interviews: 6,
    assessments: 5,
    rejections: 7,
    reviewRequired: 3,
  },
  {
    id: "ca3",
    name: "Rahul Verma",
    email: "rahul@applywizard.ai",
    totalClients: 2,
    connectedMailboxes: 2,
    applications: 8,
    interviews: 2,
    assessments: 1,
    rejections: 4,
    reviewRequired: 1,
  },
  {
    id: "ca4",
    name: "Anjali Gupta",
    email: "anjali@applywizard.ai",
    totalClients: 2,
    connectedMailboxes: 2,
    applications: 10,
    interviews: 3,
    assessments: 2,
    rejections: 3,
    reviewRequired: 0,
  },
];

// ── Mock Clients ──────────────────────────────────────────────────────────────
export const mockClients: Client[] = [
  {
    id: "client1",
    name: "Rohan Mehta",
    email: "rohan.mehta@gmail.com",
    mailbox: "rohan.m@zohomail.in",
    mailboxStatus: "healthy",
    caId: "ca1",
    caName: "Amit Sharma",
    emailsToday: 4,
    pendingClassification: 0,
    reviewRequired: 1,
    applicationsCount: 6,
    interviewsCount: 2,
    assessmentsCount: 1,
    rejectionsCount: 2,
  },
  {
    id: "client2",
    name: "Sneha Rao",
    email: "sneha.rao@yahoo.com",
    mailbox: "sneha.r@zohomail.in",
    mailboxStatus: "healthy",
    caId: "ca1",
    caName: "Amit Sharma",
    emailsToday: 6,
    pendingClassification: 1,
    reviewRequired: 0,
    applicationsCount: 5,
    interviewsCount: 1,
    assessmentsCount: 1,
    rejectionsCount: 1,
  },
  {
    id: "client3",
    name: "Vikram Singh",
    email: "vikram.singh@outlook.com",
    mailbox: "vikram.s@zohomail.in",
    mailboxStatus: "needs_reconnect", // Zoho token expired
    caId: "ca2",
    caName: "Priya Patel",
    emailsToday: 0,
    pendingClassification: 0,
    reviewRequired: 2,
    applicationsCount: 8,
    interviewsCount: 3,
    assessmentsCount: 2,
    rejectionsCount: 3,
  },
  {
    id: "client4",
    name: "Meera Nair",
    email: "meera.nair@gmail.com",
    mailbox: "meera.n@zohomail.in",
    mailboxStatus: "healthy",
    caId: "ca2",
    caName: "Priya Patel",
    emailsToday: 8,
    pendingClassification: 2,
    reviewRequired: 1,
    applicationsCount: 7,
    interviewsCount: 2,
    assessmentsCount: 2,
    rejectionsCount: 3,
  },
  {
    id: "client5",
    name: "Karan Johar",
    email: "karan.johar@gmail.com",
    mailbox: "karan.j@zohomail.in",
    mailboxStatus: "healthy",
    caId: "ca3",
    caName: "Rahul Verma",
    emailsToday: 3,
    pendingClassification: 0,
    reviewRequired: 1,
    applicationsCount: 4,
    interviewsCount: 1,
    assessmentsCount: 0,
    rejectionsCount: 2,
  },
  {
    id: "client6",
    name: "Deepika Padukone",
    email: "deepika.p@outlook.com",
    mailbox: "deepika.p@zohomail.in",
    mailboxStatus: "healthy",
    caId: "ca4",
    caName: "Anjali Gupta",
    emailsToday: 5,
    pendingClassification: 0,
    reviewRequired: 0,
    applicationsCount: 6,
    interviewsCount: 2,
    assessmentsCount: 1,
    rejectionsCount: 2,
  },
];

// ── Mock Applications (Emails) ────────────────────────────────────────────────
export const mockApplications: Application[] = [
  {
    id: "app1",
    clientId: "client1",
    clientName: "Rohan Mehta",
    clientEmail: "rohan.mehta@gmail.com",
    mailbox: "rohan.m@zohomail.in",
    caId: "ca1",
    caName: "Amit Sharma",
    companyName: "Google",
    jobTitle: "Software Engineer",
    sender: "Google Careers <noreply@google.com>",
    subject: "Interview Invite: Google Software Engineer role",
    receivedDate: "2026-06-23T10:15:00Z",
    folderName: "Inbox",
    category: "interview_invite",
    confidence: 0.98,
    status: "classified",
    needsHumanReview: true,
    actionRequired: "Schedule coding interview on Google portal.",
    deadline: "2026-06-26",
    body: "Hi Rohan,\n\nWe would like to invite you for a 45-minute technical interview for the Software Engineer role at Google. Please use the link below to select a convenient date and time in the next 3 days.\n\nBest regards,\nGoogle recruiting team",
  },
  {
    id: "app2",
    clientId: "client3",
    clientName: "Vikram Singh",
    clientEmail: "vikram.singh@outlook.com",
    mailbox: "vikram.s@zohomail.in",
    caId: "ca2",
    caName: "Priya Patel",
    companyName: "Meta",
    jobTitle: "Frontend Engineer",
    sender: "Meta Recruiting <careers@meta.com>",
    subject: "Meta Coding Assessment request",
    receivedDate: "2026-06-23T09:30:00Z",
    folderName: "Inbox",
    category: "assessment",
    confidence: 0.95,
    status: "classified",
    needsHumanReview: true,
    actionRequired: "Complete the technical coding assessment on CodeSignal.",
    deadline: "2026-06-25",
    body: "Hello Vikram,\n\nAs the next step in our recruiting pipeline, please complete the Meta Coding Assessment on CodeSignal. You will have 70 minutes to finish 4 tasks. The link expires in 48 hours.\n\nLink: https://codesignal.com/assessment/meta/1a2b3c\n\nThanks,\nMeta Recruitment",
  },
  {
    id: "app3",
    clientId: "client4",
    clientName: "Meera Nair",
    clientEmail: "meera.nair@gmail.com",
    mailbox: "meera.n@zohomail.in",
    caId: "ca2",
    caName: "Priya Patel",
    companyName: "Amazon",
    jobTitle: "Cloud Architect",
    sender: "Amazon Recruiting <jobs@amazon.com>",
    subject: "Update on your application: Amazon Cloud Architect",
    receivedDate: "2026-06-22T15:20:00Z",
    folderName: "Inbox",
    category: "rejection",
    confidence: 0.99,
    status: "classified",
    needsHumanReview: false,
    actionRequired: null,
    deadline: null,
    body: "Dear Meera,\n\nThank you for applying to the Cloud Architect position at Amazon. While we were impressed by your background, we have decided to move forward with other candidates whose experience more closely aligns with the role requirements.\n\nWe wish you all the best in your job search.\n\nSincerely,\nAmazon Careers",
  },
  {
    id: "app4",
    clientId: "client1",
    clientName: "Rohan Mehta",
    clientEmail: "rohan.mehta@gmail.com",
    mailbox: "rohan.m@zohomail.in",
    caId: "ca1",
    caName: "Amit Sharma",
    companyName: "Microsoft",
    jobTitle: "Senior DevOps Dev",
    sender: "Microsoft Jobs <msjobs@microsoft.com>",
    subject: "Application Received: Senior DevOps Dev",
    receivedDate: "2026-06-22T08:45:00Z",
    folderName: "Archive",
    category: "application_received",
    confidence: 0.97,
    status: "classified",
    needsHumanReview: false,
    actionRequired: null,
    deadline: null,
    body: "Hi Rohan,\n\nWe have received your application for the Senior DevOps Dev role at Microsoft. We are currently reviewing your qualifications and will reach out if your background matches our needs.\n\nRegards,\nMicrosoft Careers Team",
  },
  {
    id: "app5",
    clientId: "client5",
    clientName: "Karan Johar",
    clientEmail: "karan.johar@gmail.com",
    mailbox: "karan.j@zohomail.in",
    caId: "ca3",
    caName: "Rahul Verma",
    companyName: "Uber",
    jobTitle: "Product Manager",
    sender: "Uber Recruitment <recruiter@uber.com>",
    subject: "Response required: Uber Product Manager interview follow-up",
    receivedDate: "2026-06-23T11:10:00Z",
    folderName: "Inbox",
    category: "recruiter_reply",
    confidence: 0.92,
    status: "classified",
    needsHumanReview: true,
    actionRequired: "Reply to recruiter with updated availability.",
    deadline: "2026-06-24",
    body: "Hi Karan,\n\nI hope you are doing well. I reviewed your round-1 interview notes and the hiring manager wants to set up a follow-up. Do you have 30 minutes tomorrow between 2 PM and 5 PM IST?\n\nLet me know,\nPranav, Uber Recruiting",
  },
  {
    id: "app6",
    clientId: "client2",
    clientName: "Sneha Rao",
    clientEmail: "sneha.rao@yahoo.com",
    mailbox: "sneha.r@zohomail.in",
    caId: "ca1",
    caName: "Amit Sharma",
    companyName: "Netflix",
    jobTitle: "Software Engineer",
    sender: "Netflix Careers <jobs@netflix.com>",
    subject: "Netflix Account Verification",
    receivedDate: "2026-06-23T13:05:00Z",
    folderName: "Spam",
    category: "email_verification",
    confidence: 1.0,
    status: "classified",
    needsHumanReview: false,
    actionRequired: null,
    deadline: null,
    body: "Hi Sneha,\n\nPlease verify your email address to complete your Netflix job application profile: https://netflix.com/careers/verify?token=7f8g9h\n\nThanks,\nNetflix Recruiting",
  },
  {
    id: "app7",
    clientId: "client3",
    clientName: "Vikram Singh",
    clientEmail: "vikram.singh@outlook.com",
    mailbox: "vikram.s@zohomail.in",
    caId: "ca2",
    caName: "Priya Patel",
    companyName: "Apple",
    jobTitle: "iOS Specialist",
    sender: "Apple Careers <noreply@apple.com>",
    subject: "iOS Specialist application review status",
    receivedDate: "2026-06-23T06:00:00Z",
    folderName: "Inbox",
    category: "follow_up_needed",
    confidence: 0.88,
    status: "classified",
    needsHumanReview: true,
    actionRequired: "Submit iOS project references to Apple.",
    deadline: "2026-06-27",
    body: "Hi Vikram,\n\nWe are currently reviewing candidates for the iOS Specialist position. To proceed, please send over links to any public GitHub repositories or App Store listings for iOS apps you have published.\n\nBest,\nApple HR Team",
  },
  {
    id: "app8",
    clientId: "client4",
    clientName: "Meera Nair",
    clientEmail: "meera.nair@gmail.com",
    mailbox: "meera.n@zohomail.in",
    caId: "ca2",
    caName: "Priya Patel",
    companyName: "Stripe",
    jobTitle: "Support Engineer",
    sender: "Stripe Talent <noreply@stripe.com>",
    subject: "Job Offer: Support Engineer at Stripe",
    receivedDate: "2026-06-22T18:00:00Z",
    folderName: "Inbox",
    category: "job_offer",
    confidence: 0.99,
    status: "classified",
    needsHumanReview: true,
    actionRequired: "Review and sign the formal Stripe offer letter.",
    deadline: "2026-06-29",
    body: "Dear Meera,\n\nWe are thrilled to offer you the position of Support Engineer at Stripe! We were incredibly impressed by your technical expertise and client-focused approach. The offer details are in the attached letter. Please sign and return it by next Monday.\n\nWelcome to Stripe,\nStripe Recruiting",
  },
  {
    id: "app9",
    clientId: "client2",
    clientName: "Sneha Rao",
    clientEmail: "sneha.rao@yahoo.com",
    mailbox: "sneha.r@zohomail.in",
    caId: "ca1",
    caName: "Amit Sharma",
    companyName: "Airbnb",
    jobTitle: "Backend dev",
    sender: "Airbnb recruiting <jobs@airbnb.com>",
    subject: "Security login code",
    receivedDate: "2026-06-23T14:15:00Z",
    folderName: "Inbox",
    category: "otp_verification",
    confidence: 1.0,
    status: "classified",
    needsHumanReview: false,
    actionRequired: null,
    deadline: null,
    body: "Your Airbnb security login code is 884729. It is valid for 10 minutes.",
  },
  {
    id: "app10",
    clientId: "client6",
    clientName: "Deepika Padukone",
    clientEmail: "deepika.p@outlook.com",
    mailbox: "deepika.p@zohomail.in",
    caId: "ca4",
    caName: "Anjali Gupta",
    companyName: "Oracle",
    jobTitle: "Database Lead",
    sender: "Oracle Careers <oracle@oracle.com>",
    subject: "Action required: Complete profile registration",
    receivedDate: "2026-06-21T10:00:00Z",
    folderName: "Inbox",
    category: "account_created",
    confidence: 0.95,
    status: "classified",
    needsHumanReview: false,
    actionRequired: null,
    deadline: null,
    body: "Welcome to Oracle Careers. Your candidate profile has been successfully set up. Log in at jobs.oracle.com using your email address to complete your registration.",
  },
  {
    id: "app11",
    clientId: "client4",
    clientName: "Meera Nair",
    clientEmail: "meera.nair@gmail.com",
    mailbox: "meera.n@zohomail.in",
    caId: "ca2",
    caName: "Priya Patel",
    companyName: "Salesforce",
    jobTitle: "Systems Integrator",
    sender: "Salesforce Jobs <recruit@salesforce.com>",
    subject: "Salesforce application question",
    receivedDate: "2026-06-23T13:40:00Z",
    folderName: "Inbox",
    category: "unknown",
    confidence: 0.35,
    status: "failed",
    needsHumanReview: true,
    actionRequired: "Manually classify and review email content.",
    deadline: null,
    body: "Hello Meera, quick question regarding your resume: are you willing to relocate to Bangalore, or are you only looking for remote positions?",
  },
];
