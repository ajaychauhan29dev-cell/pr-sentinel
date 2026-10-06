"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface RunRow {
  id: string;
  pr: string;
  status: string;
  createdAt: string;
  provider: string;
  dryRun: boolean;
  trigger: string;
  summary?: { commented: number; escalated: number; dropped: number };
}

export function RunList() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/runs").then((r) => r.json()).then((d: RunRow[]) => alive && setRuns(d)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!runs.length) return <p className="muted">No runs yet.</p>;
  return (
    <div className="panel">
      <table>
        <thead>
          <tr><th>PR</th><th>Status</th><th>Result</th><th>Provider</th><th>Started</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/runs/${r.id}`}>{r.pr}</Link> {r.trigger === "webhook" && <span className="badge">webhook</span>}</td>
              <td><span className={`badge ${r.status}`}>{r.status}</span></td>
              <td className="small">{r.summary ? `${r.summary.commented} commented · ${r.summary.escalated} escalated · ${r.summary.dropped} dropped` : "—"}</td>
              <td className="small">{r.provider}{r.dryRun ? " · dry-run" : ""}</td>
              <td className="small muted">{new Date(r.createdAt).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
