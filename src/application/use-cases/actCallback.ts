// callback_data grammar for assistant-proposed actions (namespace "act:").
//
//   act:<pendingActionId>:<y|n>
//
// Kept dependency-free so the processor and the button builder can share it
// without a cycle, matching the txn: grammar next door. cuids never contain ":".

export interface ActCallback {
  pendingId: string;
  yes: boolean;
}

export const actCb = {
  confirm: (pendingId: string) => `act:${pendingId}:y`,
  cancel: (pendingId: string) => `act:${pendingId}:n`,
};

export function parseActCallback(data: string): ActCallback | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "act") return null;
  const [, pendingId, verdict] = parts;
  if (!pendingId || (verdict !== "y" && verdict !== "n")) return null;
  return { pendingId, yes: verdict === "y" };
}
