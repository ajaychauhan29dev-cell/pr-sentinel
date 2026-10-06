import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GitHubGateway } from "./github/gateway.js";
import { formatPrRef, parsePrRef } from "./github/pr-ref.js";
import { runAffectedTests } from "./tests/runner.js";
import type { OutboxEntry, PrRef } from "./types.js";
import type { WorkspaceProvider } from "./workspace.js";

export const SERVER_NAME = "pr-sentinel";
export const SERVER_VERSION = "0.1.0";

export interface SentinelServerOptions {
  gateway: GitHubGateway;
  workspaces: WorkspaceProvider;
  /** Command template; `{files}` is replaced with the affected test files. */
  testCommand: string;
  testTimeoutMs: number;
  /** When true, write tools record to `outbox` instead of calling GitHub. */
  dryRun: boolean;
  /** Max characters of diff returned by get_pr_diff. */
  maxDiffChars?: number;
  outbox?: OutboxEntry[];
}

export const TOOL_NAMES = {
  getPrDiff: "get_pr_diff",
  listChangedFiles: "list_changed_files",
  runAffectedTests: "run_affected_tests",
  postReviewComment: "post_review_comment",
  addPrLabels: "add_pr_labels"
} as const;

function ok(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

const prArg = z.string().describe("Pull request as owner/repo#123 or https://github.com/owner/repo/pull/123");

/**
 * Builds the PR Sentinel MCP server. Transport-agnostic: connect it to stdio (bin.ts),
 * an in-memory pair (tests, Next.js) or Streamable HTTP.
 */
export function createSentinelServer(opts: SentinelServerOptions): { server: McpServer; outbox: OutboxEntry[] } {
  const outbox = opts.outbox ?? [];
  const maxDiff = opts.maxDiffChars ?? 120_000;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: "Tools for reviewing GitHub pull requests. Read tools are side-effect free; write tools honour dry-run mode." }
  );

  const record = (action: OutboxEntry["action"], ref: PrRef, payload: Record<string, unknown>) => {
    outbox.push({ at: new Date().toISOString(), action, pr: formatPrRef(ref), payload });
  };

  server.registerTool(
    TOOL_NAMES.getPrDiff,
    {
      title: "Get PR diff",
      description: "Returns pull request metadata and the unified diff of all changed files.",
      inputSchema: { pr: prArg },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ pr }) => {
      try {
        const ref = parsePrRef(pr);
        const [info, files] = await Promise.all([opts.gateway.getPullRequest(ref), opts.gateway.listChangedFiles(ref)]);
        let diff = files
          .map((f) => `diff --git a/${f.previousFilename ?? f.filename} b/${f.filename}\n--- a/${f.previousFilename ?? f.filename}\n+++ b/${f.filename}\n${f.patch ?? "(binary or too large to display)"}`)
          .join("\n");
        const truncated = diff.length > maxDiff;
        if (truncated) diff = diff.slice(0, maxDiff);
        return ok({ pr: info, diff, truncated, fileCount: files.length });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.listChangedFiles,
    {
      title: "List changed files",
      description: "Lists files changed by the pull request with status and line counts.",
      inputSchema: { pr: prArg },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ pr }) => {
      try {
        const files = await opts.gateway.listChangedFiles(parsePrRef(pr));
        return ok({
          files: files.map(({ patch: _patch, ...rest }) => rest)
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.runAffectedTests,
    {
      title: "Run affected tests",
      description:
        "Maps changed files to their test files and runs them against the PR head in a sandboxed child process with a timeout. " +
        "Pass `files` to restrict to a subset of the changed files.",
      inputSchema: {
        pr: prArg,
        files: z.array(z.string()).optional().describe("Subset of changed file paths to target")
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ pr, files }) => {
      try {
        const ref = parsePrRef(pr);
        const [info, changed] = await Promise.all([opts.gateway.getPullRequest(ref), opts.gateway.listChangedFiles(ref)]);
        const targets = files?.length ? changed.filter((f) => files.includes(f.filename)) : changed;
        const workspaceDir = await opts.workspaces.prepare(info);
        const result = await runAffectedTests({
          workspaceDir,
          changedFiles: targets,
          testCommand: opts.testCommand,
          timeoutMs: opts.testTimeoutMs
        });
        return ok({ ...result, headSha: info.headSha });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.postReviewComment,
    {
      title: "Post review comment",
      description:
        "Posts a review comment. With `path` and `line` it is an inline comment on the PR head; otherwise a top-level summary comment. " +
        "In dry-run mode nothing is sent to GitHub and the comment is recorded instead.",
      inputSchema: {
        pr: prArg,
        body: z.string().min(1).max(65_000),
        path: z.string().optional(),
        line: z.number().int().positive().optional(),
        dryRun: z.boolean().optional().describe("Force dry-run for this call")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async ({ pr, body, path, line, dryRun }) => {
      try {
        const ref = parsePrRef(pr);
        const inline = Boolean(path && line);
        if (opts.dryRun || dryRun) {
          record(inline ? "review_comment" : "issue_comment", ref, { body, path, line });
          return ok({ posted: false, dryRun: true, kind: inline ? "inline" : "summary" });
        }
        if (inline) {
          const info = await opts.gateway.getPullRequest(ref);
          const c = await opts.gateway.createReviewComment(ref, info.headSha, { body, path: path!, line: line! });
          return ok({ posted: true, dryRun: false, ...c });
        }
        const c = await opts.gateway.createIssueComment(ref, body);
        return ok({ posted: true, dryRun: false, ...c });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.addPrLabels,
    {
      title: "Add PR labels",
      description: "Adds labels to the pull request (used to flag reviews that need a human). Honours dry-run mode.",
      inputSchema: { pr: prArg, labels: z.array(z.string().min(1)).min(1), dryRun: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ pr, labels, dryRun }) => {
      try {
        const ref = parsePrRef(pr);
        if (opts.dryRun || dryRun) {
          record("labels", ref, { labels });
          return ok({ applied: labels, dryRun: true });
        }
        const applied = await opts.gateway.addLabels(ref, labels);
        return ok({ applied, dryRun: false });
      } catch (err) {
        return fail(err);
      }
    }
  );

  return { server, outbox };
}
