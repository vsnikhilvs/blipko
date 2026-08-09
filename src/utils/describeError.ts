// Flatten an unknown thrown value to a loggable string.
//
// Necessary because the logger serializes fields with JSON.stringify, and
// Error's `message`/`stack` are NON-ENUMERABLE — passing an Error straight
// through as `{ err: error }` silently emits `{}`. Every log site that wants the
// reason an operation failed has to call this first.
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
