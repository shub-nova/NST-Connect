import type { TicketStatus } from '../generated/prisma/client';

/** A finished ticket has left every open queue and has no clock. Everything else is open. */
export const FINISHED_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

/** Open tickets that have an owner and a deadline. (A ticket that is only CREATED has no owner yet.) */
export const OWNED_OPEN_STATUSES: TicketStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED'];
