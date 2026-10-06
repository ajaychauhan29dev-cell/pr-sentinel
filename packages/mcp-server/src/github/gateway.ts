import type { ChangedFile, PostedComment, PrRef, PullRequestInfo, ReviewCommentInput } from "../types.js";

/**
 * Narrow GitHub surface used by the MCP tools. Keeping it behind an interface lets the
 * server run against the real API (Octokit) or offline fixtures (demo + tests).
 */
export interface GitHubGateway {
  getPullRequest(ref: PrRef): Promise<PullRequestInfo>;
  listChangedFiles(ref: PrRef): Promise<ChangedFile[]>;
  /** Inline review comment anchored to a line of the head commit. */
  createReviewComment(ref: PrRef, headSha: string, comment: Required<Pick<ReviewCommentInput, "path" | "line">> & { body: string }): Promise<PostedComment>;
  /** Top-level PR conversation comment. */
  createIssueComment(ref: PrRef, body: string): Promise<PostedComment>;
  addLabels(ref: PrRef, labels: string[]): Promise<string[]>;
}
