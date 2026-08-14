import {
  MessageProcessor,
  ProcessContext,
  ProcessOutput,
} from "./MessageProcessor";
import { IAssistantAgent } from "../../../domain/services/IAssistantAgent";
import { IMessagingPlatform } from "../../interfaces/IMessagingPlatform";
import {
  currentBudgetPeriod,
  formatMoney,
  periodDayInfo,
  sanitizeMd,
} from "../budgetMath";
import { zonedYmd } from "../../../utils/time";
import { actCb } from "../actCallback";
import { logger } from "../../../utils/logger";

const FALLBACK =
  "I couldn't work that out right now — try /status, or rephrase your question.";

// Five rounds of a frontier model plus tool queries. Generous enough not to cut
// off a real multi-step answer, bounded so a hung provider can't hold the
// Telegram webhook open indefinitely.
const ASSISTANT_TIMEOUT_MS = 25_000;

// Handles free-form questions with a tool-calling assistant over the user's own
// data. Every figure it states is fetched and pre-computed by the tool layer.
//
// Gated: when no agent is configured this yields, and QueryProcessor answers as
// before. Enabling the lane is a config change, not a code change.
export class AssistantProcessor implements MessageProcessor {
  constructor(
    private readonly agent: IAssistantAgent | null,
    private readonly messageService: IMessagingPlatform,
    private readonly webAppUrl: string,
  ) {}

  canHandle(context: ProcessContext): boolean {
    if (this.agent === null) return false;
    const intent = context.parsed?.intent;
    // ESCALATE is what the log-or-escalate parser emits for everything that is
    // not a clear spend; QUERY is the same thing from the legacy prompt.
    return intent === "ESCALATE" || intent === "QUERY";
  }

  async process(context: ProcessContext): Promise<ProcessOutput> {
    const { user, platformUserId, textMessage } = context;
    const agent = this.agent!;
    const now = new Date();
    const tz = user.timezone;
    const { start, end } = currentBudgetPeriod(user.payday, now, tz);
    const { day, daysInPeriod, remainingDays } = periodDayInfo(
      user.payday,
      now,
      tz,
    );

    // An agent turn takes seconds, not milliseconds — show the user something
    // is happening rather than leaving the chat silent.
    void this.messageService
      .sendTypingIndicator(platformUserId)
      .catch(() => {});

    // A real abort, not just an unblocked promise: withTimeout races but leaves
    // the underlying request running, so a hung provider call leaks.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);

    try {
      const answer = await agent.answer(textMessage, {
        userId: user.id,
        currency: user.currency,
        payday: user.payday,
        monthlyIncome: formatMoney(Number(user.monthlyIncome ?? 0)),
        today: zonedYmd(now, tz),
        dashboardUrl: this.webAppUrl,
        period: {
          start: zonedYmd(start, tz),
          end: zonedYmd(new Date(end.getTime() - 1), tz),
          day,
          daysInPeriod,
          remainingDays,
        },
        history: context.conversationHistory,
        signal: controller.signal,
      });

      // A proposed write is shown with its confirm buttons; nothing has been
      // changed yet, so the user's tap is what commits it.
      //
      // The body carries `summary`, NOT just the model's prose. The summary is
      // built from the rows the write will actually touch (resolved box name,
      // the expense's real amount), so the user is confirming what will happen
      // rather than what the model said would happen. Showing only the prose
      // would make this a confirmation in name and a rubber stamp in fact.
      const body = answer.pendingAction
        ? `${answer.text}\n\n➡️ *${sanitizeMd(answer.pendingAction.summary)}*`
        : answer.text;

      if (answer.pendingAction) {
        await this.messageService.sendInteractiveMessage(platformUserId, body, [
          [
            { id: actCb.confirm(answer.pendingAction.id), title: "✅ Confirm" },
            { id: actCb.cancel(answer.pendingAction.id), title: "✖️ Cancel" },
          ],
        ]);
      } else if (answer.dashboardUrl) {
        // A pending write takes precedence: an unanswered "confirm?" must not
        // be buried under a link to somewhere else.
        await this.messageService.sendInteractiveMessage(platformUserId, body, [
          [
            {
              id: "dashboard",
              title: "🔗 Open dashboard",
              url: answer.dashboardUrl,
            },
          ],
        ]);
      } else {
        await this.messageService.sendMessage({
          to: platformUserId,
          body,
        });
      }

      return {
        response: body,
        parsed: { intent: "QUERY", confidence: 1 },
        turnMeta: {
          intent: "QUERY",
          toolCalls: answer.toolCalls,
          provider: answer.provider,
          model: answer.model,
          latencyMs: answer.latencyMs,
          inputTokens: answer.inputTokens,
          outputTokens: answer.outputTokens,
        },
      };
    } catch (error) {
      logger.error("Assistant failed", {
        component: "assistant",
        userId: user.id,
        // `timedOut` and `elapsedMs` are what separate "we cut it off at 25s"
        // from "the provider failed instantly" — indistinguishable before, and
        // the two want opposite fixes. The error object goes through whole: the
        // logger serializes name/stack/cause and the SDK's status and
        // request_id, which is what a provider-side ticket needs.
        timedOut: controller.signal.aborted,
        elapsedMs: Date.now() - now.getTime(),
        // Length, not content. The raw question is the user's financial detail,
        // and logger.ts already records that leaking exactly this at prod log
        // level was a bug worth fixing once.
        questionChars: textMessage.length,
        err: error,
      });
      await this.messageService.sendMessage({
        to: platformUserId,
        body: FALLBACK,
      });
      return {
        response: FALLBACK,
        parsed: { intent: "QUERY", confidence: 1 },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
