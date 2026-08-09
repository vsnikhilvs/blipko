// Post-hoc grounding check: every rupee figure the assistant states should have
// come out of a tool result verbatim. Anything else was invented or recomputed,
// which is exactly the failure this design exists to prevent.
//
// This does not block the reply — it measures. A silent hallucination is worse
// than a logged one, and the rate is the number worth watching.

const AMOUNT = /₹\s?-?[\d,]+(?:\.\d+)?/g;

// "₹ 1,200.00" and "₹1200" are the same claim; compare on the digits alone.
function canonical(amount: string): string {
  const digits = amount.replace(/[^0-9.]/g, "").replace(/\.0+$/, "");
  return digits.replace(/^0+(?=\d)/, "");
}

export function findUngroundedAmounts(
  text: string,
  toolResults: unknown[],
): string[] {
  const stated = text.match(AMOUNT);
  if (!stated) return [];

  const grounded = new Set(
    (JSON.stringify(toolResults).match(AMOUNT) ?? []).map(canonical),
  );

  const missing = stated.filter((a) => !grounded.has(canonical(a)));
  return [...new Set(missing)];
}
