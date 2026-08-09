import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssistantProcessor } from "./AssistantProcessor";

const user: any = {
  id: "u1",
  payday: 1,
  currency: "INR",
  timezone: "Asia/Kolkata",
  monthlyIncome: 50000,
};

const answer = {
  text: "You spent *₹1,200* on Food.",
  toolCalls: [{ name: "get_spend_by_category", args: {}, result: {} }],
  model: "claude-sonnet-5",
  provider: "anthropic",
  latencyMs: 1830,
  inputTokens: 900,
  outputTokens: 40,
  ungroundedAmounts: [],
};

function ctx(overrides: object = {}): any {
  return {
    user,
    platformUserId: "123",
    textMessage: "how much on food?",
    parsed: { intent: "QUERY", confidence: 0.9 },
    ...overrides,
  };
}

describe("AssistantProcessor", () => {
  let agent: any;
  let messageService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = { answer: vi.fn().mockResolvedValue(answer) };
    messageService = {
      sendMessage: vi.fn().mockResolvedValue("m1"),
      sendInteractiveMessage: vi.fn().mockResolvedValue("m2"),
      sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("gating", () => {
    it("handles QUERY when an agent is configured", () => {
      const p = new AssistantProcessor(agent, messageService);
      expect(p.canHandle(ctx())).toBe(true);
    });

    it("yields when no agent is configured, leaving QueryProcessor to answer", () => {
      const p = new AssistantProcessor(null, messageService);
      expect(p.canHandle(ctx())).toBe(false);
    });

    it("ignores non-QUERY intents", () => {
      const p = new AssistantProcessor(agent, messageService);
      expect(
        p.canHandle(ctx({ parsed: { intent: "EXPENSE", confidence: 1 } })),
      ).toBe(false);
    });
  });

  it("sends the answer and returns the tool trace for the turn log", async () => {
    const p = new AssistantProcessor(agent, messageService);
    const out = await p.process(ctx());

    expect(messageService.sendMessage).toHaveBeenCalledWith({
      to: "123",
      body: answer.text,
    });
    expect(out.turnMeta).toMatchObject({
      intent: "QUERY",
      provider: "anthropic",
      model: "claude-sonnet-5",
      latencyMs: 1830,
      inputTokens: 900,
      outputTokens: 40,
      toolCalls: answer.toolCalls,
    });
  });

  describe("proposed writes", () => {
    const proposal = {
      ...answer,
      text: "Ready to add ₹2,000 to your Goa trip box — tap confirm.",
      pendingAction: { id: "p1", summary: "Add ₹2,000 to Goa trip" },
    };

    it("shows the server-verified summary, not just the model's prose", async () => {
      // The summary is built from the rows the write will actually touch. The
      // prose is not. Confirming a button whose payload was never shown is a
      // rubber stamp, not a confirmation.
      agent.answer.mockResolvedValue(proposal);
      const p = new AssistantProcessor(agent, messageService);
      await p.process(ctx());

      const [, body] = messageService.sendInteractiveMessage.mock.calls[0]!;
      expect(body).toContain("Add ₹2,000 to Goa trip");
    });

    it("renders confirm/cancel buttons bound to the proposal id", async () => {
      agent.answer.mockResolvedValue(proposal);
      const p = new AssistantProcessor(agent, messageService);
      await p.process(ctx());

      const [, , rows] = messageService.sendInteractiveMessage.mock.calls[0]!;
      expect(rows[0].map((b: any) => b.id)).toEqual(["act:p1:y", "act:p1:n"]);
    });

    it("strips Markdown control chars from the summary", async () => {
      // The summary embeds a user-authored expense note, and the send path uses
      // legacy Markdown — a stray underscore would break the whole message.
      agent.answer.mockResolvedValue({
        ...proposal,
        pendingAction: { id: "p1", summary: "Delete ₹220 (lunch_with *boss*)" },
      });
      const p = new AssistantProcessor(agent, messageService);
      await p.process(ctx());

      const [, body] = messageService.sendInteractiveMessage.mock.calls[0]!;
      expect(body).toContain("lunchwith boss");
    });

    it("records the confirmed body, so history matches what the user saw", async () => {
      agent.answer.mockResolvedValue(proposal);
      const p = new AssistantProcessor(agent, messageService);
      const out = await p.process(ctx());
      expect(out.response).toContain("Add ₹2,000 to Goa trip");
    });

    it("sends a plain message when there is nothing to confirm", async () => {
      const p = new AssistantProcessor(agent, messageService);
      await p.process(ctx());
      expect(messageService.sendMessage).toHaveBeenCalled();
      expect(messageService.sendInteractiveMessage).not.toHaveBeenCalled();
    });
  });

  it("shows a typing indicator before the slow call", async () => {
    const p = new AssistantProcessor(agent, messageService);
    await p.process(ctx());
    expect(messageService.sendTypingIndicator).toHaveBeenCalledWith("123");
  });

  it("passes the user's local date and cycle, not the server's", async () => {
    vi.setSystemTime(new Date("2026-08-11T20:00:00Z")); // 01:30 IST on Aug 12
    const p = new AssistantProcessor(agent, messageService);
    await p.process(ctx());

    // A UTC date here would tell the assistant it is still Aug 11.
    expect(agent.answer.mock.calls[0]![1].today).toBe("2026-08-12");
    expect(agent.answer.mock.calls[0]![1].period.end).toBe("2026-08-31");
    vi.useRealTimers();
  });

  it("gives the agent an abort signal so a hung call is cancelled, not just ignored", async () => {
    const p = new AssistantProcessor(agent, messageService);
    await p.process(ctx());
    expect(agent.answer.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("degrades to a friendly nudge when the agent fails", async () => {
    agent.answer.mockRejectedValue(new Error("provider down"));
    const p = new AssistantProcessor(agent, messageService);
    const out = await p.process(ctx());

    expect(out.response).toContain("/status");
    expect(out.turnMeta).toBeUndefined();
    expect(messageService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("still answers when the typing indicator fails", async () => {
    messageService.sendTypingIndicator.mockRejectedValue(new Error("429"));
    const p = new AssistantProcessor(agent, messageService);
    const out = await p.process(ctx());
    expect(out.response).toBe(answer.text);
  });
});
