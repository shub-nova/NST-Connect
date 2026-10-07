-- CreateTable
CREATE TABLE "admin_note" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_note_receipt" (
    "note_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seen_at" TIMESTAMP(3),

    CONSTRAINT "admin_note_receipt_pkey" PRIMARY KEY ("note_id","user_id")
);

-- CreateIndex
CREATE INDEX "admin_note_created_at_idx" ON "admin_note"("created_at");

-- CreateIndex
CREATE INDEX "admin_note_receipt_user_id_seen_at_idx" ON "admin_note_receipt"("user_id", "seen_at");

-- AddForeignKey
ALTER TABLE "admin_note" ADD CONSTRAINT "admin_note_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_note_receipt" ADD CONSTRAINT "admin_note_receipt_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "admin_note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_note_receipt" ADD CONSTRAINT "admin_note_receipt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
