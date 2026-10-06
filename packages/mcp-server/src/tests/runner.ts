import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { mapChangedFilesToTests, type TestMapping } from "./test-mapper.js";
import { runSandboxed } from "./sandbox.js";

export interface RunAffectedTestsOptions {
  workspaceDir: string;
  changedFiles: { filename: string; status?: string }[];
  /** e.g. `node --test --test-reporter=tap {files}` or `npx vitest run {files}` */
  testCommand: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface TestFailure {
  name: string;
  file?: string;
}

export interface AffectedTestsResult {
  status: "passed" | "failed" | "timed_out" | "no_tests" | "error";
  command: string;
  testFiles: string[];
  bySource: Record<string, string[]>;
  unmapped: string[];
  skipped: TestMapping["skipped"];
  exitCode: number | null;
  durationMs: number;
  counts?: { passed: number; failed: number };
  failures: TestFailure[];
  /** Combined stdout/stderr tail, bounded. */
  output: string;
  truncated: boolean;
}

/** Splits a command template into argv, expanding `{files}` (appended if absent). */
export function buildCommand(template: string, files: string[]): { command: string; args: string[] } {
  const tokens = template.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new Error("Empty test command");
  const hasPlaceholder = tokens.includes("{files}");
  const expanded = tokens.flatMap((t) => (t === "{files}" ? files : [t]));
  if (!hasPlaceholder) expanded.push(...files);
  const [command, ...args] = expanded as [string, ...string[]];
  return { command, args };
}

/** Best-effort parsing of TAP (node:test), Vitest and Jest summaries. */
export function parseTestOutput(output: string): { counts?: { passed: number; failed: number }; failures: TestFailure[] } {
  const failures: TestFailure[] = [];
  for (const m of output.matchAll(/^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/gm)) {
    if (m[1]) failures.push({ name: m[1].trim() });
  }
  for (const m of output.matchAll(/^\s*(?:FAIL|×|✕)\s+(.+?)\s*$/gm)) {
    if (m[1]) failures.push({ name: m[1].trim() });
  }
  // attach file hints to names like "src/foo.test.ts > suite > case"
  for (const f of failures) {
    const file = /([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)/.exec(f.name)?.[1];
    if (file) f.file = file;
  }

  let counts: { passed: number; failed: number } | undefined;
  const tapPass = /^# pass (\d+)/m.exec(output);
  const tapFail = /^# fail (\d+)/m.exec(output);
  if (tapPass && tapFail) counts = { passed: Number(tapPass[1]), failed: Number(tapFail[1]) };
  const vitest = /Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed/.exec(output);
  if (!counts && vitest) counts = { failed: Number(vitest[1] ?? 0), passed: Number(vitest[2]) };
  const jest = /Tests:\s+(?:(\d+) failed,\s*)?(\d+) passed/.exec(output);
  if (!counts && jest) counts = { failed: Number(jest[1] ?? 0), passed: Number(jest[2]) };

  return { counts, failures };
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - max)}`;
}

/** Maps changed files to tests, then runs them in the sandbox. */
export async function runAffectedTests(opts: RunAffectedTestsOptions): Promise<AffectedTestsResult> {
  const root = path.resolve(opts.workspaceDir);
  const exists = (rel: string) => {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) return false;
    return existsSync(abs) && statSync(abs).isFile();
  };
  const mapping = mapChangedFilesToTests(opts.changedFiles, exists);
  const base = {
    testFiles: mapping.testFiles,
    bySource: mapping.bySource,
    unmapped: mapping.unmapped,
    skipped: mapping.skipped
  };

  if (mapping.testFiles.length === 0) {
    return { ...base, status: "no_tests", command: "", exitCode: null, durationMs: 0, failures: [], output: "", truncated: false };
  }

  const { command, args } = buildCommand(opts.testCommand, mapping.testFiles);
  const printable = [command, ...args].join(" ");
  try {
    const res = await runSandboxed({
      command,
      args,
      cwd: root,
      timeoutMs: opts.timeoutMs,
      maxOutputBytes: opts.maxOutputBytes
    });
    const combined = `${res.stdout}${res.stderr ? `\n${res.stderr}` : ""}`;
    const parsed = parseTestOutput(combined);
    const status = res.timedOut ? "timed_out" : res.exitCode === 0 ? "passed" : "failed";
    return {
      ...base,
      status,
      command: printable,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      counts: parsed.counts,
      failures: parsed.failures,
      output: tail(combined, 8000),
      truncated: res.truncated
    };
  } catch (err) {
    return {
      ...base,
      status: "error",
      command: printable,
      exitCode: null,
      durationMs: 0,
      failures: [],
      output: err instanceof Error ? err.message : String(err),
      truncated: false
    };
  }
}
