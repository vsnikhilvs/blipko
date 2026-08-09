import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock is lifted above the file, so a plain top-level const
// would not exist yet when the factory runs.
const { createMany, findMany } = vi.hoisted(() => ({
  createMany: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../prisma/client", () => ({
  prisma: { conversationMessage: { createMany, findMany } },
}));

import { PrismaConversationRepository } from "./PrismaConversationRepository";

describe("PrismaConversationRepository", () => {
  let repo: PrismaConversationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaConversationRepository();
  });

  describe("appendExchange", () => {
    it("writes both halves in one statement, user turn first", async () => {
      await repo.appendExchange("u1", "chai 30", "✅ ₹30 → Wants");

      // One createMany, not two creates: a single INSERT makes Postgres assign
      // `seq` in array order, which is what getRecent sorts by. Two independent
      // creates could land in either order.
      expect(createMany).toHaveBeenCalledTimes(1);
      const [userTurn, modelTurn] = createMany.mock.calls[0]![0].data;
      expect(userTurn.role).toBe("user");
      expect(modelTurn.role).toBe("model");
    });

    it("does not set createdAt, which is unsafe to order by", async () => {
      await repo.appendExchange("u1", "q", "a");
      for (const row of createMany.mock.calls[0]![0].data) {
        expect(row.createdAt).toBeUndefined();
      }
    });

    it("attaches AI metadata to the model turn only", async () => {
      await repo.appendExchange("u1", "how much on food?", "₹1,200", {
        intent: "QUERY",
        model: "gpt-4o-mini",
        latencyMs: 1830,
        inputTokens: 900,
        outputTokens: 40,
      });

      const [userTurn, modelTurn] = createMany.mock.calls[0]![0].data;
      expect(userTurn.intent).toBeUndefined();
      expect(modelTurn).toMatchObject({
        intent: "QUERY",
        model: "gpt-4o-mini",
        latencyMs: 1830,
      });
    });

    it("stores JsonNull rather than undefined for absent json columns", async () => {
      await repo.appendExchange("u1", "hi", "hello");
      const [, modelTurn] = createMany.mock.calls[0]![0].data;

      // Prisma rejects `undefined` on a Json column at runtime; JsonNull is the
      // documented way to write SQL NULL.
      expect(modelTurn.entityRefs).not.toBeUndefined();
      expect(modelTurn.toolCalls).not.toBeUndefined();
    });
  });

  it("reads newest-first by seq and returns them oldest-first", async () => {
    findMany.mockResolvedValue([
      {
        role: "model",
        content: "b",
        createdAt: new Date(2),
        intent: "EXPENSE",
        entityRefs: { expenseId: "e1" },
      },
      {
        role: "user",
        content: "a",
        createdAt: new Date(1),
        intent: null,
        entityRefs: null,
      },
    ]);

    const turns = await repo.getRecent("u1", 6);
    expect(findMany.mock.calls[0]![0].orderBy).toEqual({ seq: "desc" });
    expect(turns.map((t) => t.content)).toEqual(["a", "b"]);
    expect(turns[1]!.entityRefs).toEqual({ expenseId: "e1" });
  });
});
