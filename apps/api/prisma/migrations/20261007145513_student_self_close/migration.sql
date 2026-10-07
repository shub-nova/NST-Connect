-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'CLOSED_BY_STUDENT';

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "closed_by_student" BOOLEAN NOT NULL DEFAULT false;
