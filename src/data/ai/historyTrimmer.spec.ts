import { describe, it, expect } from "vitest";
import { trimHistory, estimateTokens } from "./historyTrimmer";

const user = (text: string): any => ({ role: "user", content: text });
const assistant = (text: string): any => ({ role: "assistant", content: text });

const toolUse = (id: string, name: string): any => ({
  role: "assistant",
  content: [{ type: "tool_use", id, name, input: {} }],
});
const toolResult = (id: string, out: string): any => ({
  role: "user",
  content: [{ type: "tool_result", tool_use_id: id, content: out }],
});

// Every tool_use block must have its tool_result in a LATER message, and every
// tool_result must answer an EARLIER tool_use. An orphan is an API error.
function pairsIntact(messages: any[]): boolean {
  const uses = new Map<string, number>();
  const results = new Map<string, number>();
  messages.forEach((m, i) => {
    if (!Array.isArray(m.content)) return;
    for (const b of m.content) {
      if (b.type === "tool_use") uses.set(b.id, i);
      if (b.type === "tool_result") results.set(b.tool_use_id, i);
    }
  });
  for (const [id, at] of uses) {
    if (!results.has(id) || results.get(id)! <= at) return false;
  }
  for (const id of results.keys()) if (!uses.has(id)) return false;
  return true;
}

describe("trimHistory", () => {
  it("keeps everything when it already fits", () => {
    const history = [user("hi"), assistant("hello")];
    expect(trimHistory(history, 10_000)).toEqual(history);
  });

  it("drops from the oldest end, keeping the most recent turns", () => {
    const history = [
      user("oldest"),
      assistant("a1"),
      user("newest"),
      assistant("a2"),
    ];
    const budget = estimateTokens([user("newest"), assistant("a2")]);
    const kept = trimHistory(history, budget);

    expect(kept).toEqual([user("newest"), assistant("a2")]);
  });

  it("never splits a tool_use from its tool_result", () => {
    const history = [
      user("q1"),
      toolUse("t1", "get_period_status"),
      toolResult("t1", "{}"),
      assistant("a1"),
      user("q2"),
      toolUse("t2", "get_income"),
      toolResult("t2", "{}"),
      assistant("a2"),
    ];

    // Sweep every budget: no budget may ever produce an orphaned block.
    for (let budget = 1; budget < estimateTokens(history) + 50; budget += 3) {
      const kept = trimHistory(history, budget);
      expect(pairsIntact(kept)).toBe(true);
    }
  });

  it("keeps a multi-round tool exchange together", () => {
    const history = [
      user("q"),
      toolUse("t1", "get_categories"),
      toolResult("t1", "{}"),
      toolUse("t2", "get_spend_by_category"),
      toolResult("t2", "{}"),
      assistant("done"),
    ];
    const kept = trimHistory(history, estimateTokens(history));
    expect(pairsIntact(kept)).toBe(true);
    expect(kept).toHaveLength(6);
  });

  it("never returns a history that opens on an assistant turn", () => {
    const history = [user("q1"), assistant("a1"), user("q2"), assistant("a2")];
    for (let budget = 1; budget < estimateTokens(history) + 20; budget += 2) {
      const kept = trimHistory(history, budget);
      if (kept.length > 0) expect(kept[0]!.role).toBe("user");
    }
  });

  it("returns nothing for a zero or negative budget", () => {
    expect(trimHistory([user("q")], 0)).toEqual([]);
    expect(trimHistory([user("q")], -5)).toEqual([]);
  });

  it("drops the whole exchange when only part of it would fit", () => {
    const history = [
      user("q1"),
      toolUse("t1", "big_tool"),
      toolResult("t1", "x".repeat(2000)),
      assistant("a1"),
      user("q2"),
      assistant("a2"),
    ];
    // Enough for the last plain exchange, nowhere near the tool round.
    const kept = trimHistory(
      history,
      estimateTokens([user("q2"), assistant("a2")]),
    );
    expect(kept).toEqual([user("q2"), assistant("a2")]);
  });
});
