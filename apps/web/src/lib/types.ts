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
  tatDeadline: string | null;
  createdAt: string;
  resolvedAt: string | null;
  attachments: Attachment[];
  thread: ThreadItem[];
}

export type CloseOutcome = "SOLVED" | "CLOSED" | "ESCALATED";

/** A ticket in one of these states is finished. */
export const isFinished = (status: TicketStatus) => status === "RESOLVED" || status === "CLOSED";
