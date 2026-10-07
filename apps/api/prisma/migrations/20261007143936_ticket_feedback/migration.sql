-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('SATISFIED', 'OKAY', 'NOT_SATISFIED');

-- CreateTable
CREATE TABLE "ticket_feedback" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "finish_event_id" UUID NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "comment" TEXT,
    "finished_by_id" UUID,
    "finished_level" INTEGER,
    "category_id" UUID NOT NULL,
    "sub_category_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_feedback_finish_event_id_key" ON "ticket_feedback"("finish_event_id");

-- CreateIndex
CREATE INDEX "ticket_feedback_category_id_created_at_idx" ON "ticket_feedback"("category_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_feedback_finished_by_id_created_at_idx" ON "ticket_feedback"("finished_by_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_feedback_ticket_id_idx" ON "ticket_feedback"("ticket_id");

-- AddForeignKey
ALTER TABLE "ticket_feedback" ADD CONSTRAINT "ticket_feedback_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_feedback" ADD CONSTRAINT "ticket_feedback_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_feedback" ADD CONSTRAINT "ticket_feedback_finish_event_id_fkey" FOREIGN KEY ("finish_event_id") REFERENCES "ticket_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_feedback" ADD CONSTRAINT "ticket_feedback_finished_by_id_fkey" FOREIGN KEY ("finished_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
