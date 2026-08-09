import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client";
import {
  IConversationRepository,
  ConversationTurn,
  TurnEntityRefs,
  TurnMeta,
} from "../../domain/repositories/IConversationRepository";

export class PrismaConversationRepository implements IConversationRepository {
  async getRecent(userId: string, limit: number): Promise<ConversationTurn[]> {
    const rows = await prisma.conversationMessage.findMany({
      where: { userId },
      orderBy: { seq: "desc" },
      take: limit,
      select: {
        role: true,
        content: true,
        createdAt: true,
        intent: true,
        entityRefs: true,
      },
    });
    return rows.reverse().map((r) => ({
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
      intent: r.intent,
      entityRefs: (r.entityRefs as TurnEntityRefs | null) ?? null,
    }));
  }

  async appendExchange(
    userId: string,
    userText: string,
    modelText: string,
    meta: TurnMeta = {},
  ): Promise<void> {
    // One statement, so Postgres assigns `seq` in array order and the user turn
    // can never be read back after its own reply. (Two exchanges written truly
    // concurrently may still interleave — nextval is per row, so another session
    // can slip between these two. That is honest chronology; an inverted pair
    // was not.)
    await prisma.conversationMessage.createMany({
      data: [
        {
          userId,
          role: "user",
          content: userText,
        },
        {
          userId,
          role: "model",
          content: modelText,
          intent: meta.intent ?? null,
          entityRefs: toJson(meta.entityRefs),
          toolCalls: toJson(meta.toolCalls),
          provider: meta.provider ?? null,
          model: meta.model ?? null,
          latencyMs: meta.latencyMs ?? null,
          inputTokens: meta.inputTokens ?? null,
          outputTokens: meta.outputTokens ?? null,
          costUsd: meta.costUsd ?? null,
        },
      ],
    });
  }
}

function toJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined || value === null
    ? Prisma.JsonNull
    : (value as Prisma.InputJsonValue);
}
