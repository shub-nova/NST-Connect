-- AlterEnum
ALTER TYPE "EscalationReason" ADD VALUE 'ON_LEAVE';

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'REASSIGNED';

-- AlterTable
ALTER TABLE "poc_assignment" ADD COLUMN     "on_leave_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "deactivated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "staff_audit" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_user_id" UUID,
    "category_id" UUID,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_audit_category_id_created_at_idx" ON "staff_audit"("category_id", "created_at");

-- AddForeignKey
ALTER TABLE "staff_audit" ADD CONSTRAINT "staff_audit_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_audit" ADD CONSTRAINT "staff_audit_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
