export type Role = "STUDENT" | "POC" | "SUPER_ADMIN";

export type TicketStatus =
  | "CREATED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "ESCALATED"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface SubCategory {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  /** Short label for chips and team names, e.g. "Hostel". */
  shortName: string;
  subCategories: SubCategory[];
}

export interface TicketSummary {
  id: string;
  title: string;
  category: { id: string; name: string; shortName: string };
  subCategory: SubCategory | null;
  status: TicketStatus;
  statusLabel: string;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEntry {
  type: string;
  label: string;
  /** A reply or resolution note from the team, when there is one. */
  message: string | null;
  at: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface TicketDetail extends TicketSummary {
  description: string;
  resolvedAt: string | null;
  /** True when the ticket is finished and the student may reopen it. */
  canReopen: boolean;
  timeline: TimelineEntry[];
  attachments: Attachment[];
}

export interface TicketList {
  items: TicketSummary[];
  nextCursor: string | null;
}

export interface UploadTicket {
  attachmentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface PocQueueTicket {
  id: string;
  title: string;
  status: TicketStatus;
  currentLevel: number;
  /** Nobody acted at the top level either. */
  critical: boolean;
  tatDeadline: string | null;
  createdAt: string;
  updatedAt: string;
  category: { name: string; shortName: string };
  subCategory: { name: string } | null;
  student: { name: string };
}

export type ThreadItem =
  | { kind: "comment"; id: string; body: string; visibility: string; author: { name: string; role: string }; at: string }
  | { kind: "event"; id: string; label: string; note: string | null; at: string };

export interface PocTicketDetail {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  statusLabel: string;
  category: { id: string; name: string; shortName: string };
  subCategory: SubCategory | null;
  student: { name: string; email: string; enrollmentId: string | null };
  currentLevel: number;
  critical: boolean;
  tatDeadline: string | null;
  createdAt: string;
  resolvedAt: string | null;
  attachments: Attachment[];
  thread: ThreadItem[];
}

export type CloseOutcome = "SOLVED" | "CLOSED" | "ESCALATED";

/** A ticket in one of these states is finished. */
export const isFinished = (status: TicketStatus) => status === "RESOLVED" || status === "CLOSED";

// ---- Analytics (staff only) ------------------------------------------------------------

export interface AnalyticsHeadline {
  solved: number;
  closed: number;
  escalated: number;
  finished: number;
  avgFinishHours: number | null;
  medianFinishHours: number | null;
  withinTatPct: number | null;
  avgHoursAtMyLevel: number | null;
  actionNeeded: number;
  overdue: number;
  /** Open tickets whose 48h runs out within 24 hours. */
  dueIn24h: number;
  critical: number;
  total: number;
  autoEscalatedFrom: number;
  autoEscalatedTo: number;
  manualEscalations: number;
  reopened: number;
  reopenRatePct: number | null;
}

export interface AnalyticsPerson {
  userId: string;
  name: string;
  level: number;
  category: string;
  headline: AnalyticsHeadline;
}

export interface AnalyticsBreakdownRow {
  id: string;
  name: string;
  level?: number;
  headline: AnalyticsHeadline;
}

export interface AnalyticsData {
  view: "me" | "team" | "overall" | "admin";
  title: string;
  levels?: number[];
  members?: AnalyticsPerson[];
  breakdown?: AnalyticsBreakdownRow[];
  range: { from: string; to: string; days: number; bucket: "day" | "week" };
  headline: AnalyticsHeadline;
  /** Finished tickets by days taken; the last entry means that many days or more. */
  finishTimes: { days: number; count: number }[];
  categories: { id: string; name: string; count: number; previous: number }[];
  subCategories: { id: string; name: string; category: string; count: number; previous: number; avgFinishHours: number | null }[];
  trend: { day: string; created: number; solved: number; closed: number; autoEscalated: number; manualEscalated: number }[];
  words: { term: string; count: number }[];
  phrases: { term: string; count: number }[];
  timeLeft: { overdue: number; within6h: number; within12h: number; within24h: number; later: number };
}

export interface AnalyticsAccess {
  me: boolean;
  team: boolean;
  overall: boolean;
  admin: boolean;
  /** Settings (managing POCs) is for L2, L3 and the admin. */
  manage: boolean;
  unreadNotes: number;
  onLeave: boolean;
  onLeaveUntil: string | null;
}

export interface SentNote {
  id: string;
  body: string;
  audience: string;
  context: string;
  createdAt: string;
  recipients: number;
  seen: number;
}

export interface ReceivedNote {
  id: string;
  body: string;
  context: string;
  createdAt: string;
  seen: boolean;
}

// ---- Settings: managing POCs -------------------------------------------------------------

export interface StaffPerson {
  /** The assignment id: what every action refers to. */
  id: string;
  userId: string;
  name: string;
  email: string;
  level: number;
  category: { id: string; name: string };
  managerId: string | null;
  managerName: string | null;
  status: "active" | "invited" | "on_leave";
  onLeave: boolean;
  onLeaveUntil: string | null;
  openTickets: number;
}

export interface StaffOptions {
  categories: {
    id: string;
    name: string;
    levels: { level: number; managers: { id: string; name: string; level: number }[] }[];
  }[];
}

export interface StaffChange {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
  by: string;
}

export interface HandoffSummary {
  reassigned: number;
  escalated: number;
  stranded: number;
}
