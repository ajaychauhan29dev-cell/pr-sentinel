import type { EvaluatedFinding } from "@pr-sentinel/agent";

export function FindingCard({ f }: { f: EvaluatedFinding }) {
  const run = f.verification.testRun;
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <b>{f.id}</b> · {f.title}
          <div className="small muted">
            <code>{f.file}:{f.line}</code> · {f.severity} · {f.category} · {f.kind}
          </div>
        </div>
        <div className="row">
          <span className={`badge ${f.verification.verdict}`}>{f.verification.verdict}</span>
          <span className={`badge ${f.decision.action}`}>{f.decision.action}</span>
        </div>
      </div>
      <p>{f.rationale}</p>
      {f.suggestion && <p className="small"><b>Suggestion:</b> {f.suggestion}</p>}
      <p className="small conf">
        Confidence: model <b>{f.initialConfidence.toFixed(2)}</b> → after verification <b>{f.confidence.toFixed(2)}</b> · {f.decision.reason}
      </p>
      <p className="small muted">Verification: {f.verification.reason}</p>
      {run && run.command && (
        <details>
          <summary className="small">
            Evidence: <code>{run.command}</code> → {run.status}
            {run.counts ? ` (${run.counts.passed} passed, ${run.counts.failed} failed)` : ""} in {run.durationMs} ms
          </summary>
          {run.failures.length > 0 && (
            <ul className="small">
              {run.failures.map((x) => <li key={x.name}>❌ {x.name}</li>)}
            </ul>
          )}
          <pre>{run.outputExcerpt}</pre>
        </details>
      )}
      {f.delivery && (
        <p className="small muted">
          Delivery: {f.delivery.error ? `failed — ${f.delivery.error}` : f.delivery.dryRun ? "recorded (dry-run)" : "posted"}
          {f.delivery.url && <> · <a href={f.delivery.url}>view on GitHub</a></>}
        </p>
      )}
    </div>
  );
}
