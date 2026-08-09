import { ConversationTurn } from "./IAiParser";

// Context the query agent needs to ground its answer. The agent itself is
// read-only: it calls IFinancialDataTools to fetch real numbers and composes a
// natural-language reply. It never writes/edits/deletes.
// Dates here are YYYY-MM-DD in the USER'S timezone, never the server's — the
// agent resolves "yesterday" against `today`, so a UTC date would put an IST
// user a day behind every evening.
export interface QueryAgentContext {
  userId: string;
  currency: string;
  locale: string;
  payday: number;
  monthlyIncome: string; // formatted; expected salary (a floor), actual may exceed it
  today: string;
  period: {
    start: string;
    end: string; // inclusive last day of the cycle
    day: number;
    daysInPeriod: number;
    remainingDays: number;
  };
  history?: ConversationTurn[] | undefined;
}

export interface IFinancialQueryAgent {
  // Returns a Telegram-Markdown answer. Throws on provider/loop failure so the
  // caller can degrade to a friendly fallback.
  answer(question: string, ctx: QueryAgentContext): Promise<string>;
}
