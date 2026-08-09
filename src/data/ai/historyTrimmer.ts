import Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.MessageParam;

// Rough token estimate: ~4 chars/token, then a safety factor because JSON tool
// payloads tokenize worse than prose. Deliberately pessimistic — overshooting
// the budget costs money and can hard-fail the request; undershooting only
// drops an extra old turn.
const CHARS_PER_TOKEN = 4;
const SAFETY_FACTOR = 1.25;

export function estimateTokens(messages: Message[]): number {
  const chars = JSON.stringify(messages).length;
  return Math.ceil((chars / CHARS_PER_TOKEN) * SAFETY_FACTOR);
}

// Drop whole exchanges from the OLDEST end until the history fits `maxTokens`.
//
// The invariant that matters: an assistant message containing `tool_use` blocks
// and the user message carrying the matching `tool_result` blocks are one
// indivisible unit. Splitting them leaves an orphan that the API rejects
// outright, so the trimmer moves in groups, never individual messages.
export function trimHistory(messages: Message[], maxTokens: number): Message[] {
  if (maxTokens <= 0) return [];

  const groups = groupIndivisible(messages);
  const kept: Message[][] = [];

  // Walk newest-first so the most recent context always survives.
  for (let i = groups.length - 1; i >= 0; i--) {
    const candidate = [groups[i]!, ...kept];
    if (estimateTokens(candidate.flat()) > maxTokens) break;
    kept.unshift(groups[i]!);
  }

  // A conversation must open on a user turn. Drop leading groups until it does
  // — a whole group at a time, because slicing off just the first MESSAGE of a
  // tool group decapitates it and leaves an orphaned tool_result behind.
  while (kept.length > 0 && kept[0]![0]!.role === "assistant") kept.shift();

  return kept.flat();
}

// Bundle each tool-using assistant message with the tool_result message that
// answers it, so the two can only ever be dropped together.
function groupIndivisible(messages: Message[]): Message[][] {
  const groups: Message[][] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === "assistant" && hasBlock(msg, "tool_use")) {
      const group = [msg];
      // Consume every following message that is purely tool results.
      while (i + 1 < messages.length && isToolResultMessage(messages[i + 1]!)) {
        group.push(messages[++i]!);
      }
      // A follow-up assistant turn that also calls tools chains onto the same
      // group — the whole multi-round exchange stands or falls together.
      while (
        i + 1 < messages.length &&
        messages[i + 1]!.role === "assistant" &&
        hasBlock(messages[i + 1]!, "tool_use")
      ) {
        group.push(messages[++i]!);
        while (
          i + 1 < messages.length &&
          isToolResultMessage(messages[i + 1]!)
        ) {
          group.push(messages[++i]!);
        }
      }
      groups.push(group);
      continue;
    }
    groups.push([msg]);
  }

  return groups;
}

function hasBlock(msg: Message, type: "tool_use" | "tool_result"): boolean {
  return (
    Array.isArray(msg.content) &&
    msg.content.some((b) => typeof b === "object" && b.type === type)
  );
}

function isToolResultMessage(msg: Message): boolean {
  return msg.role === "user" && hasBlock(msg, "tool_result");
}
