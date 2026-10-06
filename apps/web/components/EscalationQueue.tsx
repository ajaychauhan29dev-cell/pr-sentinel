"use client";

import type { EvaluatedFinding } from "@pr-sentinel/agent";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FindingCard } from "./FindingCard";

interface Escalation {
  id: string;
  runId: string;
  pr: string;
  finding: EvaluatedFinding;
  status: "pending" | "approved" | "dismissed";
  resolution?: string;
}

export function EscalationQueue() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/escalations").then((r) => r.json()).then(setItems), []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, action: "approve" | "dismiss") {
    setBusy(id);
    await fetch(`/api/escalations/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
    setBusy(null);
    void load();
  }

  if (!items.length) return <p className="muted">Nothing needs a human right now.</p>;
  return (
    <>
      {items.map((e) => (
        <div key={e.id}>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
            <span className="small">
              <Link href={`/runs/${e.runId}`}>{e.pr}</Link> · <span className={`badge ${e.status}`}>{e.status}</span>
              {e.resolution && <span className="muted"> · {e.resolution}</span>}
            </span>
            {e.status === "pending" && (
              <span className="row">
                <button disabled={busy === e.id} onClick={() => act(e.id, "approve")}>Approve &amp; post</button>
                <button className="secondary" disabled={busy === e.id} onClick={() => act(e.id, "dismiss")}>Dismiss</button>
              </span>
            )}
          </div>
          <FindingCard f={e.finding} />
        </div>
      ))}
    </>
  );
}
