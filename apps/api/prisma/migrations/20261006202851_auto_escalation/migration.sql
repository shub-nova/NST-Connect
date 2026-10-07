-- CreateEnum
CREATE TYPE "EscalationReason" AS ENUM ('MANUAL', 'TAT_BREACH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TAT_WARNING';
ALTER TYPE "NotificationType" ADD VALUE 'TAT_MISSED';
ALTER TYPE "NotificationType" ADD VALUE 'CRITICAL';

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "tat_warned_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ticket_event" ADD COLUMN     "reason" "EscalationReason";

-- Every escalation recorded before this migration was done by a person.
UPDATE "ticket_event" SET "reason" = 'MANUAL' WHERE "type" = 'ESCALATED';
