import type { EventType, TicketStatus } from '../generated/prisma/client';

/**
 * Student-facing response models.
 *
 * These are built field by field on purpose. They never spread a database row, so a
 * new column (assignedPocId, level, actor...) cannot leak to a student by accident.
 * A contract test (test/identity-contract.e2e-spec.ts) enforces this on every
 * student-facing endpoint.
 */
export interface StudentAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StudentTimelineEntry {
  type: EventType;
  label: string;
  /** The reply or resolution note, when there is one. Never contains who wrote it. */
  message: string | null;
  at: Date;
}

export interface StudentTicketSummary {
  id: string;
  title: string;
  category: { id: string; name: string; shortName: string };
  subCategory: { id: string; name: string } | null;
  status: TicketStatus;
  statusLabel: string;
  /** The student closed this ticket themselves. */
  closedByYou: boolean;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentFeedback {
  rating: 'SATISFIED' | 'OKAY' | 'NOT_SATISFIED';
  comment: string | null;
  /** Answers can be changed for a week. */
  canChange: boolean;
}

export interface StudentTicketDetail extends StudentTicketSummary {
  description: string;
  resolvedAt: Date | null;
  /** True when the ticket is finished and the student is allowed to reopen it. */
  canReopen: boolean;
  /** True once the ticket is Solved or Closed: the student can share how it went. */
  canGiveFeedback: boolean;
  /** The student's own answer for the latest finish, if they gave one. Nothing about staff. */
  feedback: StudentFeedback | null;
  timeline: StudentTimelineEntry[];
  attachments: StudentAttachment[];
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  CREATED: 'Created',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  ESCALATED: 'Escalated',
  RESOLVED: 'Solved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
};

/** The short label students see ("Hostel"), falling back to the full category name. */
export function displayName(category: { name: string; shortName: string }): string {
  return category.shortName || category.name;
}

export function teamLabel(categoryName: string): string {
  return `${categoryName} team`;
}

/** What a student reads on the timeline. Only generic team labels, never a person or a level. */
export function timelineLabel(type: EventType, categoryName: string, toStatus: TicketStatus | null = null): string {
  const team = teamLabel(categoryName);
  switch (type) {
    case 'CREATED':
      return 'Ticket created';
    case 'ASSIGNED':
      return `Assigned to ${team}`;
    case 'COMMENTED':
      return `${team} replied`;
    case 'STATUS_CHANGED':
      return toStatus ? `Marked ${STATUS_LABELS[toStatus].toLowerCase()}` : 'Status updated';
    case 'ESCALATED':
      return `Escalated to ${team}`;
    case 'CLOSED_BY_STUDENT':
      return 'You closed this ticket';
    case 'RESOLVED':
      return 'Solved';
    case 'CLOSED':
      return 'Closed';
    case 'REOPENED':
      return 'Reopened';
    case 'RENAMED':
      return 'Name updated';
    default:
      return 'Updated';
  }
}

interface SummarySource {
  id: string;
  title: string;
  status: TicketStatus;
  closedByStudent?: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; name: string; shortName: string };
  subCategory: { id: string; name: string } | null;
}

export function toStudentSummary(t: SummarySource): StudentTicketSummary {
  return {
    id: t.id,
    title: t.title,
    category: { id: t.category.id, name: t.category.name, shortName: displayName(t.category) },
    subCategory: t.subCategory ? { id: t.subCategory.id, name: t.subCategory.name } : null,
    status: t.status,
    statusLabel: t.closedByStudent && t.status === 'CLOSED' ? 'Closed by you' : STATUS_LABELS[t.status],
    closedByYou: !!t.closedByStudent && t.status === 'CLOSED',
    // Created but not yet routed means nobody holds it yet.
    assignedTo: t.status === 'CREATED' ? null : teamLabel(displayName(t.category)),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
