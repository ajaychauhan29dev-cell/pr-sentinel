"use client";

import type { ReviewReport, RunEvent } from "@pr-sentinel/agent";
import type { OutboxEntry } from "@pr-sentinel/mcp-server";
import { useEffect, useState } from "react";
import { FindingCard } from "./FindingCard";

interface RunDto {
  id: string;
  pr: string;
  status: string;
  provider: string;
  dryRun: boolean;
  report?: ReviewReport;
  outbox: OutboxEntry[];
  error?: string;
}

export function RunView({ id }: { id: string }) {
  const [run, setRun] = useState<RunDto | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch(`/api/runs/${id}`).then(async (r) => {
        if (r.status === 404) return setMissing(true);
        setRun((await r.json()) as RunDto);
      });
    void load();
    const es = new EventSource(`/api/runs/${id}/events`);
    es.addEventListener("run-event", (m) => setEvents((prev) => [...prev, JSON.parse((m as MessageEvent).data) as RunEvent]));
    es.addEventListener("end", () => {
      es.close();
      void load();
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [id]);

  if (missing) return <p>Run not found (runs are kept in memory and reset when the server restarts).</p>;
  if (!run) return <p className="muted">Loading…</p>;
  const s = run.report?.summary;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>
          {run.pr} <span className={`badge ${run.status}`}>{run.status}</span>
        </h1>
        <span className="small muted">{run.provider}{run.dryRun ? " · dry-run" : ""}</span>
      </div>
      {run.report && (
        <p className="muted">
          <a href={run.report.pr.htmlUrl}>{run.report.pr.title}</a> by {run.report.pr.author}
        </p>
      )}
      {s && (
        <div className="grid">
          <div className="panel stat"><b>{s.commented}</b><span className="small muted">auto-commented</span></div>
          <div className="panel stat"><b>{s.escalated}</b><span className="small muted">escalated</span></div>
          <div className="panel stat"><b>{s.dropped}</b><span className="small muted">dropped</span></div>
          <div className="panel stat"><b>{s.testRuns}</b><span className="small muted">test runs</span></div>
        </div>
      )}

      <h2>Agent steps (live)</h2>
      <div className="panel timeline">
        {events.length === 0 && <span className="muted">Waiting for events…</span>}
        {events.map((e, i) => (
          <div key={i} className={e.kind === "error" ? "error" : undefined}>
            <span className="muted">{new Date(e.at).toLocaleTimeString()} </span>
            <span className="kind">{e.kind}</span>
            {e.message}
          </div>
        ))}
      </div>

      {run.error && <p style={{ color: "var(--red)" }}>Run failed: {run.error}</p>}

      {run.report && (
        <>
          <h2>Findings</h2>
          {run.report.findings.length === 0 && <p className="muted">No findings.</p>}
          {run.report.findings.map((f) => <FindingCard key={f.id} f={f} />)}
        </>
      )}

      {run.outbox.length > 0 && (
        <>
          <h2>Dry-run outbox ({run.outbox.length})</h2>
          {run.outbox.map((o, i) => (
            <details key={i} className="panel">
              <summary className="small">{o.action} → {o.pr}</summary>
              <pre>{JSON.stringify(o.payload, null, 2)}</pre>
            </details>
          ))}
        </>
      )}
    </>
  );
}
