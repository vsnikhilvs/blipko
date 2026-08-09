// Writes the assistant can PROPOSE. Nothing here mutates the ledger: each
// method records a PendingAction and returns its id plus the summary the user
// will be asked to confirm. The actual write happens in a deterministic
// processor after a button press.
//
// Failures are returned, never thrown, so the model can correct itself in-loop
// (an unknown box name comes back with the list of real ones).
export type ProposalResult =
  | { ok: true; pendingId: string; summary: string }
  | { ok: false; error: string; message: string; [extra: string]: unknown };

export interface IAssistantWriteTools {
  proposeRecurring(
    userId: string,
    input: {
      kind: "INCOME" | "EXPENSE";
      amount: number;
      dayOfMonth: number;
      bucket?: string | undefined;
      category?: string | undefined;
      note?: string | undefined;
    },
  ): Promise<ProposalResult>;

  proposeBoxMove(
    userId: string,
    input: {
      box: string;
      amount: number;
      direction: "IN" | "OUT";
      note?: string | undefined;
    },
  ): Promise<ProposalResult>;

  proposeDeleteExpense(
    userId: string,
    input: { expenseId: string },
  ): Promise<ProposalResult>;

  proposeExpenseEdit(
    userId: string,
    input: {
      expenseId: string;
      amount?: number | undefined;
      bucket?: string | undefined;
      category?: string | undefined;
      note?: string | undefined;
    },
  ): Promise<ProposalResult>;
}
