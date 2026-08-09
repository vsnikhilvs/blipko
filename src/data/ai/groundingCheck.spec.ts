import { describe, it, expect } from "vitest";
import { findUngroundedAmounts } from "./groundingCheck";

describe("findUngroundedAmounts", () => {
  it("passes an answer that quotes tool figures verbatim", () => {
    const results = [{ categories: [{ name: "Food", total: "₹1,200" }] }];
    expect(
      findUngroundedAmounts("You spent *₹1,200* on Food.", results),
    ).toEqual([]);
  });

  it("catches a total the model computed itself", () => {
    // The classic failure: two real figures, one invented sum.
    const results = [{ buckets: [{ total: "₹1,200" }, { total: "₹800" }] }];
    expect(
      findUngroundedAmounts(
        "Food ₹1,200 and Transport ₹800, so ₹2,000 total.",
        results,
      ),
    ).toEqual(["₹2,000"]);
  });

  it("ignores formatting differences rather than crying wolf", () => {
    const results = [{ total: "₹1,200" }];
    expect(findUngroundedAmounts("that's ₹ 1,200 so far", results)).toEqual([]);
    expect(findUngroundedAmounts("that's ₹1200 so far", results)).toEqual([]);
  });

  it("treats a trailing .00 as the same amount", () => {
    expect(findUngroundedAmounts("₹1,200.00", [{ t: "₹1,200" }])).toEqual([]);
  });

  it("reports each invented amount once", () => {
    const out = findUngroundedAmounts("₹500 then ₹500 again", [{ t: "₹10" }]);
    expect(out).toEqual(["₹500"]);
  });

  it("returns nothing when the answer states no amounts", () => {
    expect(findUngroundedAmounts("No spending recorded yet.", [])).toEqual([]);
  });

  it("flags everything when there were no tool results at all", () => {
    expect(findUngroundedAmounts("You have ₹9,000 left.", [])).toEqual([
      "₹9,000",
    ]);
  });

  it("matches a negative amount against the tool's negative figure", () => {
    expect(
      findUngroundedAmounts("over by -₹3,000", [{ remainingAfter: "-₹3,000" }]),
    ).toEqual([]);
  });
});
