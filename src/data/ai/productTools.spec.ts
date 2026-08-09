import { describe, it, expect, vi } from "vitest";
import { buildToolCatalog, runAssistantTool } from "./assistantTools";
import { buildProductFacts } from "../../domain/productFacts";

const ctx = {
  tools: {} as never,
  userId: "u1",
  categoryNames: ["Food"],
  dashboardUrl: "https://example.test",
};

describe("product knowledge tools", () => {
  it("exposes the product tools to the read-only lane too", () => {
    // A user asking "what can you do?" gets the same answer whichever lane is
    // serving them.
    const names = buildToolCatalog([], false).map((t) => t.name);
    expect(names).toContain("get_product_info");
    expect(names).toContain("open_dashboard");
  });

  describe("get_product_info", () => {
    it("returns an overview with no topic", async () => {
      const res: any = await runAssistantTool(ctx, "get_product_info", {});
      expect(res.ok).toBe(true);
      expect(res.whatItIs).toContain("budget");
      expect(res.commands.length).toBeGreaterThan(0);
    });

    it("answers 'how does this help me' with the why, not just the what", async () => {
      const res: any = await runAssistantTool(ctx, "get_product_info", {
        topic: "features",
      });
      // Every feature carries its own reason to exist, so the model never has
      // to invent a benefit.
      expect(res.features.every((f: any) => f.why?.length > 0)).toBe(true);
    });

    it("answers who built it", async () => {
      const res: any = await runAssistantTool(ctx, "get_product_info", {
        topic: "creator",
      });
      expect(res.creator.name).toBe("Mohammed Sadik");
    });

    it("is honest that messages are processed by an AI provider", async () => {
      const res: any = await runAssistantTool(ctx, "get_product_info", {
        topic: "privacy",
      });
      expect(res.dataHandling.join(" ")).toMatch(/AI provider/i);
    });

    it("takes the dashboard URL from context, never a hardcoded domain", async () => {
      const res: any = await runAssistantTool(ctx, "get_product_info", {
        topic: "dashboard",
      });
      expect(res.dashboard.url).toBe("https://example.test");
    });

    it("needs no user data, so it cannot fail on a broken DB", async () => {
      const res: any = await runAssistantTool(
        { ...ctx, tools: null as never },
        "get_product_info",
        {},
      );
      expect(res.ok).toBe(true);
    });
  });

  describe("open_dashboard", () => {
    it("returns the URL for the caller to render as a button", async () => {
      const res: any = await runAssistantTool(ctx, "open_dashboard", {
        reason: "edit category limits",
      });
      expect(res).toMatchObject({ ok: true, url: "https://example.test" });
    });

    it("tells the model not to repeat the URL in its text", async () => {
      const res: any = await runAssistantTool(ctx, "open_dashboard", {
        reason: "x",
      });
      expect(res.instruction).toMatch(/do not repeat the URL/i);
    });
  });

  describe("the facts themselves", () => {
    const facts = buildProductFacts("https://example.test");

    it("describes /start as linking an account, not an in-chat wizard", () => {
      // README still claims /start "runs the onboarding wizard"; that wizard was
      // replaced by the dashboard hand-off. This file is the one the bot reads.
      const start = facts.commands.find((c) => c.command === "/start")!;
      expect(start.what).toMatch(/link/i);
      expect(start.what).not.toMatch(/wizard/i);
    });

    it("lists every command the bot actually handles", () => {
      const commands = facts.commands.map((c) => c.command);
      // /boxes exists in the bot but is missing from the README's table.
      expect(commands).toEqual(
        expect.arrayContaining([
          "/status",
          "/report",
          "/recurring",
          "/boxes",
          "/settings",
          "/help",
          "undo",
          "/start",
        ]),
      );
    });

    it("hardcodes no domain anywhere", () => {
      expect(JSON.stringify(buildProductFacts("https://x.test"))).not.toContain(
        "blipko.lol",
      );
    });
  });
});
