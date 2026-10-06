import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SandboxOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** Max bytes captured per stream; the rest is discarded and `truncated` is set. */
  maxOutputBytes?: number;
  /** Extra variables to pass through (merged over the scrubbed base env). */
  env?: Record<string, string>;
}

export interface SandboxResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/** Only these variables survive from the parent environment. Secrets never do. */
const ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "TZ", "SystemRoot", "TMPDIR", "TEMP", "TMP"];

export function scrubbedEnv(extra: Record<string, string> = {}, home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  return { ...env, HOME: home, CI: "1", NODE_ENV: "test", NO_COLOR: "1", FORCE_COLOR: "0", ...extra };
}

/**
 * Runs a command as an isolated child process:
 *  - no shell (argv only, so PR content can't inject shell syntax),
 *  - scrubbed environment with a throwaway HOME (no tokens or API keys leak in),
 *  - own process group, SIGKILLed on timeout so grandchildren die too,
 *  - bounded output capture.
 *
 * This is process-level isolation, not a security boundary. Run untrusted PRs inside a
 * container / microVM (see README) in production.
 */
export async function runSandboxed(opts: SandboxOptions): Promise<SandboxResult> {
  const maxBytes = opts.maxOutputBytes ?? 64 * 1024;
  const home = await mkdtemp(path.join(os.tmpdir(), "sentinel-home-"));
  const started = Date.now();

  try {
    return await new Promise<SandboxResult>((resolve, reject) => {
      const child = spawn(opts.command, opts.args, {
        cwd: opts.cwd,
        env: scrubbedEnv(opts.env, home),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let truncated = false;
      let timedOut = false;

      const capture = (which: "stdout" | "stderr") => (chunk: Buffer) => {
        const current = which === "stdout" ? stdout : stderr;
        const room = maxBytes - Buffer.byteLength(current);
        if (room <= 0) {
          truncated = true;
          return;
        }
        let text = chunk.toString("utf8");
        if (Buffer.byteLength(text) > room) {
          text = Buffer.from(text).subarray(0, room).toString("utf8");
          truncated = true;
        }
        if (which === "stdout") stdout += text;
        else stderr += text;
      };
      child.stdout.on("data", capture("stdout"));
      child.stderr.on("data", capture("stderr"));

      const kill = () => {
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          /* already exited */
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, opts.timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode: code,
          signal,
          timedOut,
          durationMs: Date.now() - started,
          stdout,
          stderr,
          truncated
        });
      });
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
