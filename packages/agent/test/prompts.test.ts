import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/diff.js";
import { extractJson, parseAdjudication, parseFindings } from "../src/prompts.js";
import { heuristicReview } from "../src/providers/mock.js";

const DIFF = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,4 +1,5 @@
 export function f(items, n) {
-  if (n >= 10) return 1;
-  return (items ?? []).length;
+  if (n > 10) return 1;
+  console.log("debug", n);
+  return items.length;
 }`;

describe("parseUnifiedDiff", () => {
  it("tracks right-side line numbers", () => {
    const fd = parseUnifiedDiff(DIFF).get("src/a.js")!;
    expect([...fd.rightLines]).toEqual([1, 2, 3, 4, 5]);
    expect(fd.hunks[0]!.lines.filter((l) => l.type === "add").map((l) => l.newLine)).toEqual([2, 3, 4]);
  });
});

describe("model output parsing", () => {
  it("extracts JSON from fenced, chatty responses", () => {
    expect(extractJson('Sure! ```json\n{"a": 1}\n``` hope that helps')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("keeps valid findings, coerces sloppy fields and rejects malformed ones", () => {
    const { findings, rejected } = parseFindings(
      JSON.stringify({
        findings: [
          { file: "a.ts", line: "3", severity: "HUGE", category: "bug", kind: "behavioral", title: "t", rationale: "r", confidence: 1.4 },
          { file: "a.ts", title: "missing line" }
        ]
      })
    );
    expect(rejected).toBe(1);
    expect(findings[0]).toMatchObject({ line: 3, severity: "minor", confidence: 1 });
  });

  it("parses adjudication results", () => {
    expect(parseAdjudication('{"supports": true, "explanation": "x"}')).toEqual({ supports: true, explanation: "x" });
  });
});

describe("mock provider heuristics", () => {
  it("flags boundary changes, removed guards and debug logs", () => {
    const titles = heuristicReview(DIFF).map((f) => f.title);
    expect(titles).toEqual(
      expect.arrayContaining(["Boundary condition changed from `>=` to `>`", "Defensive default removed", "Debug logging left in production code"])
    );
  });

  it("flags hard-coded secrets as security findings", () => {
    const d = `diff --git a/c.ts b/c.ts\n--- a/c.ts\n+++ b/c.ts\n@@ -1,1 +1,2 @@\n const x = 1;\n+const API_KEY = "sk_live_abcdef123456";`;
    expect(heuristicReview(d)[0]).toMatchObject({ category: "security", severity: "critical", line: 2 });
  });
});
