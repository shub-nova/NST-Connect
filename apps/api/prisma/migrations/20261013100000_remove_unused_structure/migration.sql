-- Removes structure the application never used. Every piece below was checked to be empty or default in
-- the code (nothing reads or writes it). This guard repeats that check against the real data and STOPS the
-- migration, changing nothing, if anything turns out to hold information.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "comment_mention") THEN
    RAISE EXCEPTION 'Migration stopped: comment_mention is not empty, so it was not dropped.';
  END IF;
  IF EXISTS (SELECT 1 FROM "comment" WHERE "parent_comment_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Migration stopped: some comments have a parent_comment_id, so the column was not dropped.';
  END IF;
  IF EXISTS (SELECT 1 FROM "ticket" WHERE "parent_ticket_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Migration stopped: some tickets have a parent_ticket_id, so the column was not dropped.';
  END IF;
  IF EXISTS (SELECT 1 FROM "ticket" WHERE "priority" <> 'MEDIUM') THEN
    RAISE EXCEPTION 'Migration stopped: some tickets have a priority other than the default, so the column was not dropped.';
  END IF;
  IF EXISTS (SELECT 1 FROM "ticket_event" WHERE "type" IN ('LINKED', 'UNLINKED')) THEN
    RAISE EXCEPTION 'Migration stopped: ticket events of the removed types LINKED or UNLINKED exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM "notification" WHERE "type" IN ('MENTION', 'NUDGE')) THEN
    RAISE EXCEPTION 'Migration stopped: notifications of the removed types MENTION or NUDGE exist.';
  END IF;
END $$;

-- AlterEnum
BEGIN;
CREATE TYPE "EventType_new" AS ENUM ('CREATED', 'ASSIGNED', 'COMMENTED', 'STATUS_CHANGED', 'ESCALATED', 'TAT_BREACHED', 'NUDGED', 'RESOLVED', 'CLOSED', 'REOPENED', 'REASSIGNED', 'CLOSED_BY_STUDENT', 'RENAMED');
ALTER TABLE "ticket_event" ALTER COLUMN "type" TYPE "EventType_new" USING ("type"::text::"EventType_new");
ALTER TYPE "EventType" RENAME TO "EventType_old";
ALTER TYPE "EventType_new" RENAME TO "EventType";
DROP TYPE "public"."EventType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('STATUS_CHANGE', 'COMMENT', 'ESCALATION', 'RESOLVED', 'NEW_TICKET', 'TAT_WARNING', 'TAT_MISSED', 'CRITICAL');
ALTER TABLE "notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "comment" DROP CONSTRAINT "comment_parent_comment_id_fkey";

-- DropForeignKey
ALTER TABLE "comment_mention" DROP CONSTRAINT "comment_mention_comment_id_fkey";

-- DropForeignKey
ALTER TABLE "comment_mention" DROP CONSTRAINT "comment_mention_mentioned_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ticket" DROP CONSTRAINT "ticket_parent_ticket_id_fkey";

-- AlterTable
ALTER TABLE "comment" DROP COLUMN "parent_comment_id";

-- AlterTable
ALTER TABLE "ticket" DROP COLUMN "parent_ticket_id",
DROP COLUMN "priority";

-- DropTable
DROP TABLE "comment_mention";

-- DropEnum
DROP TYPE "Priority";

-- CreateIndex
CREATE INDEX "ticket_assigned_poc_id_status_idx" ON "ticket"("assigned_poc_id", "status");
