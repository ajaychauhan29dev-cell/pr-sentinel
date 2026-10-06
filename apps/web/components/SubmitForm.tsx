"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SubmitForm({ demoPr, demoMode }: { demoPr: string; demoMode: boolean }) {
  const router = useRouter();
  const [pr, setPr] = useState(demoPr);
  const [provider, setProvider] = useState("mock");
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pr, provider, dryRun })
    });
    const json = (await res.json()) as { id?: string; error?: string };
    setBusy(false);
    if (!res.ok || !json.id) return setError(json.error ?? `HTTP ${res.status}`);
    router.push(`/runs/${json.id}`);
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="row">
        <input type="text" value={pr} onChange={(e) => setPr(e.target.value)} placeholder="https://github.com/owner/repo/pull/123 or owner/repo#123" aria-label="Pull request" />
        <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="LLM provider">
          <option value="mock">mock (offline)</option>
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <label className="row small muted">
          <input type="checkbox" checked={dryRun || demoMode} disabled={demoMode} onChange={(e) => setDryRun(e.target.checked)} /> dry-run
        </label>
        <button disabled={busy || !pr}>{busy ? "Starting…" : "Review PR"}</button>
      </div>
      {demoMode && (
        <p className="small muted">
          Demo mode: no <code>GITHUB_TOKEN</code> set, so the bundled fixture PR <code>{demoPr}</code> is served offline and all writes are dry-run.
        </p>
      )}
      {error && <p className="small" style={{ color: "var(--red)" }}>{error}</p>}
    </form>
  );
}
