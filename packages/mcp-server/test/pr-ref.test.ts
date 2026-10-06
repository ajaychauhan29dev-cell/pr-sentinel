import { describe, expect, it } from "vitest";
import { formatPrRef, parsePrRef } from "../src/github/pr-ref.js";

describe("parsePrRef", () => {
  it("parses short refs", () => {
    expect(parsePrRef("octo/hello-world#12")).toEqual({ owner: "octo", repo: "hello-world", number: 12 });
  });

  it("parses PR URLs, including sub-pages", () => {
    expect(parsePrRef("https://github.com/vercel/next.js/pull/123/files")).toEqual({ owner: "vercel", repo: "next.js", number: 123 });
  });

  it("rejects garbage and non-PR URLs", () => {
    expect(() => parsePrRef("not a pr")).toThrow(/Unrecognised/);
    expect(() => parsePrRef("https://github.com/a/b/issues/3")).toThrow();
    expect(() => parsePrRef("a/b#0")).toThrow();
  });

  it("round-trips", () => {
    expect(formatPrRef(parsePrRef("a/b#7"))).toBe("a/b#7");
  });
});
