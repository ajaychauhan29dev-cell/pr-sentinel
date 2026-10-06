import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { formatPrRef } from "./github/pr-ref.js";
import { runSandboxed } from "./tests/sandbox.js";
import type { PullRequestInfo } from "./types.js";

const exec = promisify(execFile);

/** Produces a local checkout of a PR's head commit for running tests. */
export interface WorkspaceProvider {
  prepare(pr: PullRequestInfo): Promise<string>;
}

/** Maps PR refs to pre-existing directories (fixtures / local development). */
export class StaticWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly dirs: Record<string, string>) {}

  async prepare(pr: PullRequestInfo): Promise<string> {
    const dir = this.dirs[formatPrRef(pr)];
    if (!dir) throw new Error(`No workspace configured for ${formatPrRef(pr)}`);
    return path.resolve(dir);
  }
}

export interface GitWorkspaceOptions {
  rootDir: string;
  token?: string;
  /** Optional dependency install run (sandboxed) after checkout, e.g. `npm ci --ignore-scripts`. */
  installCommand?: string;
  installTimeoutMs?: number;
}

/** Shallow-fetches the exact head SHA of the PR into `<rootDir>/<owner>__<repo>__<sha>`. */
export class GitWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly opts: GitWorkspaceOptions) {}

  async prepare(pr: PullRequestInfo): Promise<string> {
    if (!/^[0-9a-f]{7,40}$/i.test(pr.headSha)) throw new Error(`Refusing suspicious head SHA: ${pr.headSha}`);
    const dir = path.resolve(this.opts.rootDir, `${pr.owner}__${pr.repo}__${pr.headSha}`);
    if (existsSync(path.join(dir, ".sentinel-ready"))) return dir;

    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const url = pr.headCloneUrl ?? `https://github.com/${pr.owner}/${pr.repo}.git`;
    const auth = this.opts.token
      ? ["-c", `http.extraHeader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${this.opts.token}`).toString("base64")}`]
      : [];
    const git = (...args: string[]) => exec("git", args, { cwd: dir, timeout: 120_000 });
    await git("init", "-q");
    await git(...auth, "fetch", "-q", "--depth", "1", url, pr.headSha);
    await git("-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD");

    if (this.opts.installCommand) {
      const [command, ...args] = this.opts.installCommand.split(/\s+/) as [string, ...string[]];
      const res = await runSandboxed({ command, args, cwd: dir, timeoutMs: this.opts.installTimeoutMs ?? 300_000 });
      if (res.exitCode !== 0) throw new Error(`Install failed (${res.exitCode}): ${res.stderr.slice(-2000)}`);
    }
    await writeFile(path.join(dir, ".sentinel-ready"), pr.headSha);
    return dir;
  }
}
