import {
  MessageProcessor,
  ProcessContext,
  ProcessOutput,
} from "./MessageProcessor";
import { IFinancialQueryAgent } from "../../../domain/services/IFinancialQueryAgent";
import { IMessagingPlatform } from "../../interfaces/IMessagingPlatform";
import { currentBudgetPeriod, formatMoney, periodDayInfo } from "../budgetMath";
import { zonedYmd } from "../../../utils/time";
import { withTimeout } from "../../../utils/withTimeout";
import { logger } from "../../../utils/logger";
import { describeError } from "../../../utils/describeError";

const FALLBACK =
  "I couldn't work that out right now — try /status, or rephrase your question.";

// Upper bound on the tool-calling agent so a hung OpenAI call can't block the webhook.
const QUERY_TIMEOUT_MS = 15_000;

// Handles the QUERY intent: free-form questions about the user's spending,
// income, or budget. Delegates to a read-only tool-calling agent that fetches
// real figures and composes the answer. On any agent failure it degrades to a
// friendly nudge rather than crashing the webhook.
export class QueryProcessor implements MessageProcessor {
  constructor(
    private readonly queryAgent: IFinancialQueryAgent,
    private readonly messageService: IMessagingPlatform,
  ) {}

  canHandle(context: ProcessContext): boolean {
    return context.parsed?.intent === "QUERY";
  }

  async process(context: ProcessContext): Promise<ProcessOutput> {
    const { user, platformUserId, textMessage } = context;
    const now = new Date();
    const tz = user.timezone;
    const { start, end } = currentBudgetPeriod(user.payday, now, tz);
    const { day, daysInPeriod, remainingDays } = periodDayInfo(
      user.payday,
      now,
      tz,
    );

    let body: string;
    try {
      body = await withTimeout(
        this.queryAgent.answer(textMessage, {
          userId: user.id,
          currency: user.currency,
          locale: user.locale,
          payday: user.payday,
          monthlyIncome: formatMoney(Number(user.monthlyIncome ?? 0)),
          today: zonedYmd(now, tz),
          period: {
            start: zonedYmd(start, tz),
            // `end` is exclusive internally; the agent is told the inclusive
            // last day so it never reports a cycle as one day longer.
            end: zonedYmd(new Date(end.getTime() - 1), tz),
            day,
            daysInPeriod,
            remainingDays,
          },
          history: context.conversationHistory,
        }),
        QUERY_TIMEOUT_MS,
        "query agent",
      );
    } catch (error) {
      logger.error("Query agent failed", {
        component: "query",
        userId: user.id,
        question: textMessage,
        err: describeError(error),
      });
      body = FALLBACK;
    }

    await this.messageService.sendMessage({ to: platformUserId, body });
    return { response: body, parsed: { intent: "QUERY", confidence: 1 } };
  }
}
