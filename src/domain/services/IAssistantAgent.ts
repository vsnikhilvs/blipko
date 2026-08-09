import { ConversationTurn } from "./IAiParser";

// Context the assistant needs to ground an answer. Dates are YYYY-MM-DD in the
// USER'S timezone, never the server's.
export interface AssistantContext {
  userId: string;
  currency: string;
  payday: number;
  monthlyIncome: string; // formatted
  today: string;
  period: {
    start: string;
    end: string; // inclusive last day
    day: number;
    daysInPeriod: number;
    remainingDays: number;
  };
  history?: ConversationTurn[] | undefined;
  signal?: AbortSignal | undefined;
}

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
}

export interface AssistantAnswer {
  text: string;
  // The full tool trace, persisted with the turn so the next request can replay
  // it and so a wrong number can be traced back to the call that produced it.
  toolCalls: ToolCallRecord[];
  model: string;
  provider: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  // Money figures in `text` that appear in no tool result. Non-empty means the
  // model invented or recomputed a number — the thing this whole design exists
  // to prevent, so it is measured rather than assumed away.
  ungroundedAmounts: string[];
  // Set when the assistant proposed a write. Nothing has changed yet; the
  // caller renders confirm/cancel buttons against this id.
  pendingAction?: { id: string; summary: string } | undefined;
}

export interface IAssistantAgent {
  answer(question: string, ctx: AssistantContext): Promise<AssistantAnswer>;
}
