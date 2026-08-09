import { describe, it, expect } from "vitest";
import { describeError } from "./describeError";

describe("describeError", () => {
  it("extracts the message from an Error", () => {
    expect(describeError(new Error("db is down"))).toBe("db is down");
  });

  it("survives JSON.stringify, which a raw Error does not", () => {
    // This is the whole reason the helper exists. The logger serializes its
    // fields with JSON.stringify, and Error's `message`/`stack` are
    // non-enumerable — so `{ err: someError }` silently emits `{"err":{}}` and
    // every server-side error log becomes useless.
    const error = new Error("connection refused");

    expect(JSON.stringify({ err: error })).toBe('{"err":{}}');
    expect(JSON.stringify({ err: describeError(error) })).toBe(
      '{"err":"connection refused"}',
    );
  });

  it("handles a subclassed error", () => {
    class Prismaish extends Error {}
    expect(describeError(new Prismaish("P1001"))).toBe("P1001");
  });

  it("stringifies non-Error throws", () => {
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError(undefined)).toBe("undefined");
    expect(describeError({ code: 500 })).toBe("[object Object]");
  });
});
