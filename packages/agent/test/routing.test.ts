import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.js";
import { routeAll, routeFinding } from "../src/routing.js";

const cfg = DEFAULT_CONFIG; // autoComment 0.8, escalate 0.5

describe("routeFinding (threshold policy)", () => {
  it.each([
    [0.95, "comment"],
    [0.8, "comment"], // inclusive lower bound
    [0.79, "escalate"],
    [0.5, "escalate"], // inclusive lower bound
    [0.49, "drop"],
    [0, "drop"]
  ])("confidence %s -> %s", (confidence, action) => {
    expect(routeFinding({ id: "x", confidence, category: "bug" }, cfg).action).toBe(action);
  });

  it("always escalates configured categories, even when highly confident", () => {
    expect(routeFinding({ id: "x", confidence: 0.99, category: "security" }, cfg)).toEqual({
      action: "escalate",
      reason: 'category "security" always requires human review'
    });
  });

  it("still drops low-confidence findings in always-escalate categories", () => {
    expect(routeFinding({ id: "x", confidence: 0.2, category: "security" }, cfg).action).toBe("drop");
  });

  it("respects custom thresholds", () => {
    const custom = parseConfig({ thresholds: { autoComment: 0.9, escalate: 0.7 } });
    expect(routeFinding({ id: "x", confidence: 0.85, category: "bug" }, custom).action).toBe("escalate");
    expect(routeFinding({ id: "x", confidence: 0.65, category: "bug" }, custom).action).toBe("drop");
  });
});

describe("routeAll", () => {
  it("escalates overflow beyond maxComments, keeping the most confident", () => {
    const c = parseConfig({ limits: { maxComments: 1 } });
    const out = routeAll(
      [
        { id: "a", confidence: 0.85, category: "bug" as const },
        { id: "b", confidence: 0.95, category: "bug" as const },
        { id: "c", confidence: 0.1, category: "bug" as const }
      ],
      c
    );
    expect(out.get("b")?.action).toBe("comment");
    expect(out.get("a")).toEqual({ action: "escalate", reason: "comment cap (1) reached" });
    expect(out.get("c")?.action).toBe("drop");
  });
});
