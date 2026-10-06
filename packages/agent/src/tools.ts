import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRequire } from "node:module";
import path from "node:path";
import {
  createSentinelServer,
  TOOL_NAMES,
  type AffectedTestsResult,
  type ChangedFile,
  type OutboxEntry,
  type PullRequestInfo,
  type SentinelServerOptions
} from "@pr-sentinel/mcp-server";

/** Typed view of the PR Sentinel MCP tools, as used by the agent. */
export interface SentinelTools {
  getPrDiff(pr: string): Promise<{ pr: PullRequestInfo; diff: string; truncated: boolean; fileCount: number }>;
  listChangedFiles(pr: string): Promise<{ files: Omit<ChangedFile, "patch">[] }>;
  runAffectedTests(pr: string, files?: string[]): Promise<AffectedTestsResult & { headSha: string }>;
  postReviewComment(pr: string, c: { body: string; path?: string; line?: number }): Promise<{ posted: boolean; dryRun: boolean; url?: string; id?: string }>;
  addLabels(pr: string, labels: string[]): Promise<{ applied: string[]; dryRun: boolean }>;
}

export class ToolCallError extends Error {
  constructor(
    readonly tool: string,
    message: string
  ) {
    super(`${tool}: ${message}`);
    this.name = "ToolCallError";
  }
}

export type ToolCallListener = (e: { tool: string; args: Record<string, unknown>; durationMs: number; ok: boolean }) => void;

/** Implements SentinelTools by calling the MCP server through an MCP client. */
export class McpSentinelTools implements SentinelTools {
  callCount = 0;

  constructor(
    private readonly client: Client,
    private readonly onCall?: ToolCallListener
  ) {}

  private async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const started = Date.now();
    this.callCount++;
    let ok = false;
    try {
      const res = await this.client.callTool({ name: tool, arguments: args }, undefined, { timeout: 300_000 });
      const text = Array.isArray(res.content) ? res.content.find((c) => c.type === "text")?.text : undefined;
      if (res.isError) {
        let msg = text ?? "unknown error";
        try {
          msg = (JSON.parse(msg) as { error?: string }).error ?? msg;
        } catch {
          /* keep raw text */
        }
        throw new ToolCallError(tool, msg);
      }
      ok = true;
      if (res.structuredContent) return res.structuredContent as T;
      if (typeof text === "string") return JSON.parse(text) as T;
      throw new ToolCallError(tool, "empty tool result");
    } finally {
      this.onCall?.({ tool, args, durationMs: Date.now() - started, ok });
    }
  }

  getPrDiff(pr: string) {
    return this.call<Awaited<ReturnType<SentinelTools["getPrDiff"]>>>(TOOL_NAMES.getPrDiff, { pr });
  }
  listChangedFiles(pr: string) {
    return this.call<Awaited<ReturnType<SentinelTools["listChangedFiles"]>>>(TOOL_NAMES.listChangedFiles, { pr });
  }
  runAffectedTests(pr: string, files?: string[]) {
    return this.call<Awaited<ReturnType<SentinelTools["runAffectedTests"]>>>(TOOL_NAMES.runAffectedTests, files ? { pr, files } : { pr });
  }
  postReviewComment(pr: string, c: { body: string; path?: string; line?: number }) {
    return this.call<Awaited<ReturnType<SentinelTools["postReviewComment"]>>>(TOOL_NAMES.postReviewComment, { pr, ...c });
  }
  addLabels(pr: string, labels: string[]) {
    return this.call<Awaited<ReturnType<SentinelTools["addLabels"]>>>(TOOL_NAMES.addPrLabels, { pr, labels });
  }
}

export interface ToolsConnection {
  tools: McpSentinelTools;
  close(): Promise<void>;
  /** Present for in-process connections: writes suppressed by dry-run. */
  outbox?: OutboxEntry[];
}

const CLIENT_INFO = { name: "pr-sentinel-agent", version: "0.1.0" };

/** Runs the MCP server in-process, connected through a linked in-memory transport pair. */
export async function connectInProcess(opts: SentinelServerOptions, onCall?: ToolCallListener): Promise<ToolsConnection> {
  const { server, outbox } = createSentinelServer(opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client(CLIENT_INFO);
  await client.connect(clientTransport);
  return {
    tools: new McpSentinelTools(client, onCall),
    outbox,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

/** Spawns the MCP server as a subprocess and talks to it over stdio (the standard MCP deployment). */
export async function connectStdio(
  env: Record<string, string | undefined>,
  onCall?: ToolCallListener,
  command?: { command: string; args: string[] }
): Promise<ToolsConnection> {
  const require = createRequire(import.meta.url);
  const bin = path.join(path.dirname(require.resolve("@pr-sentinel/mcp-server")), "bin.js");
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) cleanEnv[k] = v;
  const transport = new StdioClientTransport({
    command: command?.command ?? process.execPath,
    args: command?.args ?? [bin],
    env: cleanEnv,
    stderr: "inherit"
  });
  const client = new Client(CLIENT_INFO);
  await client.connect(transport);
  return { tools: new McpSentinelTools(client, onCall), close: () => client.close() };
}
