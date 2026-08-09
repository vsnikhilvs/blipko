-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "costUsd" DECIMAL(10,6),
ADD COLUMN     "entityRefs" JSONB,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "intent" TEXT,
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "toolCalls" JSONB;
