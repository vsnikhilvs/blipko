-- DropIndex
DROP INDEX "ConversationMessage_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "ConversationMessage_userId_seq_idx" ON "ConversationMessage"("userId", "seq");
