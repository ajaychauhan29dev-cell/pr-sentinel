import type { EvaluatedFinding, ReviewReport, RunEvent } from "@pr-sentinel/agent";
import type { OutboxEntry } from "@pr-sentinel/mcp-server";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface Run {
  id: string;
  pr: string;
  provider: string;
  dryRun: boolean;
  trigger: "dashboard" | "webhook";
  status: RunStatus;
  createdAt: string;
  events: RunEvent[];
  report?: ReviewReport;
  outbox: OutboxEntry[];
  error?: string;
}

export interface Escalation {
  id: string; // `${runId}:${findingId}`
  runId: string;
  pr: string;
  finding: EvaluatedFinding;
  status: "pending" | "approved" | "dismissed";
  resolvedAt?: string;
  resolution?: string;
}

type Listener = (e: RunEvent | { kind: "__end" }) => void;

/**
 * In-memory run store (one Node process). Swap for Postgres/Redis in production;
 * pinned to globalThis so it survives Next.js dev hot reloads.
 */
class RunStore {
  runs = new Map<string, Run>();
  escalations = new Map<string, Escalation>();
  private listeners = new Map<string, Set<Listener>>();

  create(run: Omit<Run, "id" | "createdAt" | "events" | "status" | "outbox">): Run {
    const id = `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const full: Run = { ...run, id, createdAt: new Date().toISOString(), events: [], status: "queued", outbox: [] };
    this.runs.set(id, full);
    return full;
  }

  list(): Run[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  push(id: string, e: RunEvent) {
    const run = this.runs.get(id);
    if (!run) return;
    run.events.push(e);
    this.listeners.get(id)?.forEach((l) => l(e));
  }

  finish(id: string, patch: Partial<Run>) {
    const run = this.runs.get(id);
    if (!run) return;
    Object.assign(run, patch);
    if (run.report) {
      for (const f of run.report.findings.filter((x) => x.decision.action === "escalate")) {
        const eid = `${id}:${f.id}`;
        this.escalations.set(eid, { id: eid, runId: id, pr: run.pr, finding: f, status: "pending" });
      }
    }
    this.listeners.get(id)?.forEach((l) => l({ kind: "__end" }));
    this.listeners.delete(id);
  }

  subscribe(id: string, l: Listener): () => void {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    this.listeners.get(id)!.add(l);
    return () => this.listeners.get(id)?.delete(l);
  }
}

const g = globalThis as unknown as { __sentinelStore?: RunStore };
export const store = (g.__sentinelStore ??= new RunStore());
