// Flatten an unknown thrown value to a loggable string.
//
// For the places that want just the reason as a one-line string — a user-facing
// message, a `ParseLog` row, a short field on an otherwise-structured record.
//
// It is NOT the way to log a failure any more: the logger serializes Error
// fields itself (name, message, stack, cause, and the SDK's status/request_id),
// so pass the error object straight through as `{ err: error }` when you want
// something debuggable. This flattens it to the message and loses the rest.
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
