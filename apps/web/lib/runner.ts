import "server-only";
import path from "node:path";
import { connectInProcess, createProvider, formatInlineComment, loadConfig, ReviewAgent } from "@pr-sentinel/agent";
import { serverOptionsFromEnv } from "@pr-sentinel/mcp-server";
import { store, type Escalation, type Run } from "./store";

function configPath(): string | undefined {
  return process.env.SENTINEL_CONFIG ?? path.resolve(process.cwd(), "../../sentinel.config.json");
}

async function connect(dryRun: boolean) {
  const env = { ...process.env, SENTINEL_DRY_RUN: dryRun ? "true" : process.env.SENTINEL_DRY_RUN };
  return connectInProcess(await serverOptionsFromEnv(env));
}

/** Starts a review in the background and streams its events into the store. */
export function startRun(pr: string, opts: { provider?: string; dryRun?: boolean; trigger?: Run["trigger"] } = {}): Run {
  const demo = !process.env.GITHUB_TOKEN;
  const dryRun = demo || Boolean(opts.dryRun);
  const providerKind = opts.provider ?? process.env.LLM_PROVIDER ?? "mock";
  const run = store.create({ pr, provider: providerKind, dryRun, trigger: opts.trigger ?? "dashboard" });

  void (async () => {
    run.status = "running";
    let conn: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      const config = await loadConfig(configPath());
      const provider = createProvider(providerKind);
      conn = await connect(dryRun);
      const agent = new ReviewAgent({ tools: conn.tools, provider, config, dryRun, onEvent: (e) => store.push(run.id, e) });
      const report = await agent.review(pr);
      store.finish(run.id, { status: "completed", report, outbox: conn.outbox ?? [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.push(run.id, { at: new Date().toISOString(), kind: "error", message });
      store.finish(run.id, { status: "failed", error: message, outbox: conn?.outbox ?? [] });
    } finally {
      await conn?.close().catch(() => {});
    }
  })();

  return run;
}

/** Human decision on an escalated finding. Approving posts it as a review comment (honouring dry-run). */
export async function resolveEscalation(esc: Escalation, action: "approve" | "dismiss", note?: string): Promise<Escalation> {
  if (esc.status !== "pending") throw new Error(`Escalation already ${esc.status}`);
  if (action === "approve") {
    const run = store.runs.get(esc.runId);
    const conn = await connect(run?.dryRun ?? true);
    try {
      const f = esc.finding;
      const body = `${formatInlineComment(f)}\n\n<sub>✔ Approved by a human reviewer${note ? `: ${note}` : ""}</sub>`;
      const res = await conn.tools.postReviewComment(esc.pr, { body, ...(f.anchored ? { path: f.file, line: f.line } : {}) });
      run?.outbox.push(...(conn.outbox ?? []));
      esc.resolution = res.dryRun ? "comment recorded (dry-run)" : `comment posted ${res.url ?? ""}`.trim();
    } finally {
      await conn.close();
    }
  } else {
    esc.resolution = note ? `dismissed: ${note}` : "dismissed";
  }
  esc.status = action === "approve" ? "approved" : "dismissed";
  esc.resolvedAt = new Date().toISOString();
  return esc;
}
