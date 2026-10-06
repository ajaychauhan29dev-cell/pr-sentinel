import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runSandboxed } from "../src/tests/sandbox.js";
import { buildCommand, parseTestOutput } from "../src/tests/runner.js";

const node = process.execPath;

describe("runSandboxed", () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN_TEST_SENTINEL;
  });

  it("captures output and exit code", async () => {
    const r = await runSandboxed({ command: node, args: ["-e", "console.log('hi'); process.exit(3)"], cwd: os.tmpdir(), timeoutMs: 5000 });
    expect(r.exitCode).toBe(3);
    expect(r.stdout.trim()).toBe("hi");
    expect(r.timedOut).toBe(false);
  });

  it("kills the process group on timeout", async () => {
    const r = await runSandboxed({ command: node, args: ["-e", "setInterval(() => {}, 1000)"], cwd: os.tmpdir(), timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.signal).toBe("SIGKILL");
    expect(r.durationMs).toBeLessThan(5000);
  });

  it("does not leak secrets from the parent environment", async () => {
    process.env.GITHUB_TOKEN_TEST_SENTINEL = "super-secret";
    const r = await runSandboxed({
      command: node,
      args: ["-e", "console.log(JSON.stringify({t: process.env.GITHUB_TOKEN_TEST_SENTINEL ?? null, ci: process.env.CI, home: process.env.HOME}))"],
      cwd: os.tmpdir(),
      timeoutMs: 5000
    });
    const out = JSON.parse(r.stdout);
    expect(out.t).toBeNull();
    expect(out.ci).toBe("1");
    expect(out.home).toContain("sentinel-home-");
  });

  it("bounds captured output", async () => {
    const r = await runSandboxed({ command: node, args: ["-e", "process.stdout.write('x'.repeat(10000))"], cwd: os.tmpdir(), timeoutMs: 5000, maxOutputBytes: 100 });
    expect(r.stdout.length).toBe(100);
    expect(r.truncated).toBe(true);
  });
});

describe("buildCommand", () => {
  it("expands {files} without a shell", () => {
    expect(buildCommand("npx vitest run {files} --reporter dot", ["a.test.ts", "b; rm -rf /"])).toEqual({
      command: "npx",
      args: ["vitest", "run", "a.test.ts", "b; rm -rf /", "--reporter", "dot"]
    });
  });
  it("appends files when no placeholder is present", () => {
    expect(buildCommand("node --test", ["x.test.js"]).args).toEqual(["--test", "x.test.js"]);
  });
});

describe("parseTestOutput", () => {
  it("parses TAP from node:test", () => {
    const out = "ok 1 - a\nnot ok 2 - bulk discount applies at exactly the threshold\n# pass 3\n# fail 1\n";
    const p = parseTestOutput(out);
    expect(p.counts).toEqual({ passed: 3, failed: 1 });
    expect(p.failures).toEqual([{ name: "bulk discount applies at exactly the threshold" }]);
  });
  it("parses vitest summaries", () => {
    const p = parseTestOutput(" FAIL  src/a.test.ts > adds\n      Tests  1 failed | 4 passed (5)\n");
    expect(p.counts).toEqual({ passed: 4, failed: 1 });
    expect(p.failures[0]).toEqual({ name: "src/a.test.ts > adds", file: "src/a.test.ts" });
  });
});
