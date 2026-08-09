// Tiny zero-dependency structured logger. Emits one JSON object per line with a
// level, timestamp, message, and any bound/contextual fields — so logs are
// greppable/queryable instead of free-form console output. Bind request or job
// context with `logger.child({ ... })`.

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const isProduction = process.env["NODE_ENV"] === "production";

// `LEVELS[configured ?? "debug"]` would resolve for the unset case too, so the
// production default below was unreachable and prod logged at debug — dumping
// every raw parser response, which carries the user's message and their parsed
// financial data.
const configured = process.env["LOG_LEVEL"] as Level | undefined;
const threshold =
  (configured ? LEVELS[configured] : undefined) ??
  (isProduction ? LEVELS.info : LEVELS.debug);

// JSON is for log aggregators; a human reading a terminal wants columns. Pretty
// in dev, JSON in production, `LOG_FORMAT` overrides either way.
const format = process.env["LOG_FORMAT"];
const pretty = format ? format === "pretty" : !isProduction;

// Long values (a whole parser response) destroy readability. Truncate in pretty
// mode only — JSON output stays complete so nothing is lost for real debugging.
const MAX_VALUE_CHARS = 180;

type Fields = Record<string, unknown>;

const LEVEL_COLOR: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function color(text: string, code: string, tty: boolean): string {
  return tty ? `${code}${text}${RESET}` : text;
}

function renderValue(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const text = raw ?? String(value);
  return text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS)}… (+${text.length - MAX_VALUE_CHARS} chars)`
    : text;
}

function formatPretty(
  level: Level,
  msg: string,
  fields: Fields,
  tty: boolean,
): string {
  const time = new Date().toISOString().slice(11, 19);
  const head = `${color(time, DIM, tty)} ${color(level.toUpperCase().padEnd(5), LEVEL_COLOR[level], tty)} ${msg}`;
  const rest = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${color(k + "=", DIM, tty)}${renderValue(v)}`);
  return rest.length === 0 ? head : `${head}  ${rest.join(" ")}`;
}

function emit(level: Level, msg: string, fields: Fields): void {
  if (LEVELS[level] < threshold) return;
  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;
  const line = pretty
    ? formatPretty(level, msg, fields, Boolean(stream.isTTY))
    : JSON.stringify({
        level,
        time: new Date().toISOString(),
        msg,
        ...fields,
      });
  stream.write(line + "\n");
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

export function createLogger(bindings: Fields = {}): Logger {
  return {
    debug: (msg, fields) => emit("debug", msg, { ...bindings, ...fields }),
    info: (msg, fields) => emit("info", msg, { ...bindings, ...fields }),
    warn: (msg, fields) => emit("warn", msg, { ...bindings, ...fields }),
    error: (msg, fields) => emit("error", msg, { ...bindings, ...fields }),
    child: (more) => createLogger({ ...bindings, ...more }),
  };
}

export const logger = createLogger();
