import { describe, expect, it } from "vitest";
import { candidateTestPaths, mapChangedFilesToTests, safeRelativePath } from "../src/tests/test-mapper.js";

const fs = (files: string[]) => (p: string) => files.includes(p);

describe("safeRelativePath", () => {
  it("normalises safe paths", () => {
    expect(safeRelativePath("src/./a/../b.ts")).toBe("src/b.ts");
  });
  it("rejects traversal and absolute paths", () => {
    expect(safeRelativePath("../etc/passwd")).toBeNull();
    expect(safeRelativePath("src/../../x.ts")).toBeNull();
    expect(safeRelativePath("/etc/passwd")).toBeNull();
    expect(safeRelativePath("C:\\x.ts")).toBeNull();
  });
});

describe("candidateTestPaths", () => {
  it("covers co-located, __tests__ and mirrored layouts", () => {
    const c = candidateTestPaths("src/lib/pricing.ts");
    expect(c).toContain("src/lib/pricing.test.ts");
    expect(c).toContain("src/lib/__tests__/pricing.test.ts");
    expect(c).toContain("test/lib/pricing.test.ts");
    expect(c).toContain("tests/pricing.spec.ts");
    // same extension preferred first
    expect(c[0]).toBe("src/lib/pricing.test.ts");
  });
});

describe("mapChangedFilesToTests", () => {
  it("maps sources to existing tests and reports unmapped files", () => {
    const m = mapChangedFilesToTests(
      [{ filename: "src/pricing.js" }, { filename: "src/webhooks.js" }, { filename: "README.md" }],
      fs(["test/pricing.test.js"])
    );
    expect(m.testFiles).toEqual(["test/pricing.test.js"]);
    expect(m.bySource["src/pricing.js"]).toEqual(["test/pricing.test.js"]);
    expect(m.unmapped).toEqual(["src/webhooks.js"]);
    expect(m.skipped).toEqual([{ file: "README.md", reason: "not a code file" }]);
  });

  it("runs changed test files directly and de-duplicates", () => {
    const m = mapChangedFilesToTests(
      [{ filename: "src/a.ts" }, { filename: "src/a.test.ts" }],
      fs(["src/a.test.ts"])
    );
    expect(m.testFiles).toEqual(["src/a.test.ts"]);
  });

  it("skips removed files and unsafe paths", () => {
    const m = mapChangedFilesToTests(
      [{ filename: "src/gone.ts", status: "removed" }, { filename: "../../evil.ts" }],
      fs([])
    );
    expect(m.testFiles).toEqual([]);
    expect(m.skipped.map((s) => s.reason)).toEqual(["file removed", "unsafe path"]);
  });
});
