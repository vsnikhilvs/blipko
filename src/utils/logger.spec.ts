import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// The logger reads env at import time, so each case needs a fresh module.
async function freshLogger(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return (await import("./logger")).logger;
}

function captureStdout() {
  const lines: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: any) => (lines.push(String(chunk)), true));
  return { lines, spy };
}

describe("logger", () => {
  const original = { ...process.env };

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...original };
  });

  it("defaults to info in production, not debug", async () => {
    // The old threshold expression made this branch unreachable, so production
    // logged at debug — dumping every raw parser response, which carries the
    // user's message text and their parsed financial data.
    const log = await freshLogger({
      NODE_ENV: "production",
      LOG_LEVEL: undefined,
      LOG_FORMAT: undefined,
    });
    const { lines } = captureStdout();

    log.debug("should be suppressed", {});
    log.info("should appear", {});

    expect(lines.join("")).not.toContain("should be suppressed");
    expect(lines.join("")).toContain("should appear");
  });

  it("keeps debug in development", async () => {
    const log = await freshLogger({
      NODE_ENV: "development",
      LOG_LEVEL: undefined,
      LOG_FORMAT: undefined,
    });
    const { lines } = captureStdout();

    log.debug("visible in dev", {});
    expect(lines.join("")).toContain("visible in dev");
  });

  it("still honours an explicit LOG_LEVEL", async () => {
    const log = await freshLogger({
      NODE_ENV: "development",
      LOG_LEVEL: "warn",
      LOG_FORMAT: undefined,
    });
    const { lines } = captureStdout();

    log.info("suppressed by level", {});
    expect(lines.join("")).not.toContain("suppressed by level");
  });

  it("emits JSON in production so aggregators can parse it", async () => {
    const log = await freshLogger({
      NODE_ENV: "production",
      LOG_LEVEL: undefined,
      LOG_FORMAT: undefined,
    });
    const { lines } = captureStdout();

    log.info("hello", { port: 4000 });
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: "info",
      msg: "hello",
      port: 4000,
    });
  });

  describe("pretty mode", () => {
    it("renders one readable line instead of escaped JSON", async () => {
      const log = await freshLogger({
        NODE_ENV: "development",
        LOG_LEVEL: undefined,
        LOG_FORMAT: "pretty",
      });
      const { lines } = captureStdout();

      log.info("Assistant failed", { userId: "u1", err: "fetch failed" });

      expect(lines[0]).toContain("INFO");
      expect(lines[0]).toContain("Assistant failed");
      expect(lines[0]).toContain("userId=u1");
      expect(lines[0]).toContain("err=fetch failed");
      expect(lines[0]).not.toContain('\\"');
    });

    it("truncates a long value rather than flooding the terminal", async () => {
      const log = await freshLogger({
        NODE_ENV: "development",
        LOG_LEVEL: undefined,
        LOG_FORMAT: "pretty",
      });
      const { lines } = captureStdout();

      log.debug("parser response", { responseText: "x".repeat(1000) });

      expect(lines[0]!.length).toBeLessThan(400);
      expect(lines[0]).toContain("chars)");
    });

    it("omits undefined fields", async () => {
      const log = await freshLogger({
        NODE_ENV: "development",
        LOG_LEVEL: undefined,
        LOG_FORMAT: "pretty",
      });
      const { lines } = captureStdout();

      log.info("msg", { present: 1, missing: undefined });
      expect(lines[0]).toContain("present=1");
      expect(lines[0]).not.toContain("missing");
    });
  });

  it("lets LOG_FORMAT=json force JSON in development", async () => {
    const log = await freshLogger({
      NODE_ENV: "development",
      LOG_LEVEL: undefined,
      LOG_FORMAT: "json",
    });
    const { lines } = captureStdout();

    log.info("hello", {});
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });
});
