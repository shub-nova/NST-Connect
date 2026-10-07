-- AlterTable
ALTER TABLE "ticket_event" ADD COLUMN     "assignee_id" UUID;

-- CreateIndex
CREATE INDEX "ticket_event_created_at_idx" ON "ticket_event"("created_at");

-- AddForeignKey
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Best-effort backfill for tickets that existed before this migration: the event that brought
-- a ticket to its current level went to the current owner. Older hops stay unknown (NULL).
UPDATE "ticket_event" e
   SET "assignee_id" = t."assigned_poc_id"
  FROM "ticket" t
 WHERE e."ticket_id" = t."id"
   AND e."type" IN ('ASSIGNED', 'ESCALATED', 'REOPENED')
   AND e."to_level" = t."current_level"
   AND t."assigned_poc_id" IS NOT NULL;
