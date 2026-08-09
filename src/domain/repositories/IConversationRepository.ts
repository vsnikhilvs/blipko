// What a turn resolved to. Lets a follow-up ("make it 50", "delete that")
// target a real row instead of re-parsing the rendered reply text.
export interface TurnEntityRefs {
  expenseId?: string;
  incomeId?: string;
  categoryId?: string;
  boxId?: string;
  batchId?: string;
}

export interface ToolCallTrace {
  name: string;
  args: unknown;
  result: unknown;
}

// Everything known about the bot's half of an exchange beyond its text.
export interface TurnMeta {
  intent?: string | undefined;
  entityRefs?: TurnEntityRefs | undefined;
  toolCalls?: ToolCallTrace[] | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  latencyMs?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  costUsd?: number | undefined;
}

export interface ConversationTurn {
  role: string;
  content: string;
  createdAt: Date;
  intent?: string | null;
  entityRefs?: TurnEntityRefs | null;
}

export interface IConversationRepository {
  getRecent(userId: string, limit: number): Promise<ConversationTurn[]>;
  // Writes both halves of one exchange with explicit, strictly ordered
  // timestamps. Two independent creates can land with equal or reversed
  // createdAt, which silently scrambles the history the model reads back.
  appendExchange(
    userId: string,
    userText: string,
    modelText: string,
    meta?: TurnMeta,
  ): Promise<void>;
}
