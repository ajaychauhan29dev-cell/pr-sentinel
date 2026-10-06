import { EscalationQueue } from "@/components/EscalationQueue";

export default function EscalationsPage() {
  return (
    <>
      <h1>Escalation queue</h1>
      <p className="muted">
        Findings whose post-verification confidence fell between the escalate and auto-comment thresholds (or whose category always needs a human).
        Approving posts the finding as a review comment; dismissing discards it.
      </p>
      <EscalationQueue />
    </>
  );
}
