import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_PARSER_MODEL: z.string().default("gpt-4o-mini"),
  SARVAM_API_KEY: z.string().default(""),
  // Assistant lane. Blank key / flag off keeps the bot on the existing
  // deterministic path, so a missing key degrades instead of failing at boot
  // the way the required keys above do.
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  ASSISTANT_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  TELEGRAM_BOT_TOKEN: z.string(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  // Public URL of the web dashboard, used in the bot's onboarding hand-off.
  WEB_APP_URL: z.string().url().default("https://blipko.lol"),
  // Shared secret guarding the scheduled-jobs endpoint (POST /api/cron/tick).
  CRON_SECRET: z.string().min(1).default("dev-cron-secret"),
});

export const env = envSchema.parse(process.env);
