import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/config.js";

describe("config", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_CONFIG.thresholds).toEqual({ autoComment: 0.8, escalate: 0.5 });
    expect(DEFAULT_CONFIG.verification.enabled).toBe(true);
    expect(DEFAULT_CONFIG.escalation.label).toBe("needs-human-review");
  });

  it("merges partial nested config with defaults", () => {
    const c = parseConfig({ verification: { maxTestRuns: 2 } });
    expect(c.verification.maxTestRuns).toBe(2);
    expect(c.verification.confirmBoost).toBe(0.6);
  });

  it("rejects inverted thresholds, out-of-range values and unknown keys", () => {
    expect(() => parseConfig({ thresholds: { autoComment: 0.4, escalate: 0.6 } })).toThrow(/escalate must be <=/);
    expect(() => parseConfig({ thresholds: { autoComment: 1.5 } })).toThrow(/Invalid sentinel config/);
    expect(() => parseConfig({ thresholdz: {} })).toThrow(/Invalid sentinel config/);
  });

  it("loads sentinel.config.json from disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sentinel-cfg-"));
    const file = path.join(dir, "sentinel.config.json");
    await writeFile(file, JSON.stringify({ thresholds: { autoComment: 0.9, escalate: 0.6 } }));
    expect((await loadConfig(file)).thresholds.autoComment).toBe(0.9);
    await expect(loadConfig(path.join(dir, "missing.json"))).rejects.toThrow(/not found/);
  });
});
