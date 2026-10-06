/** A pull request reference, e.g. `octo/repo#12`. */
export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export type FileStatus = "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";

export interface ChangedFile {
  filename: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunk(s) for this file. GitHub omits this for binary or very large files. */
  patch?: string;
  previousFilename?: string;
}

export interface PullRequestInfo {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  htmlUrl: string;
  /** Clone URL for the head repository (may be a fork). */
  headCloneUrl?: string;
}

export interface ReviewCommentInput {
  body: string;
  /** Inline comments need a path and a line on the RIGHT (new) side of the diff. */
  path?: string;
  line?: number;
}

export interface PostedComment {
  id: string;
  url?: string;
  kind: "inline" | "summary";
}

/** Record of a write that was suppressed because the server runs in dry-run mode. */
export interface OutboxEntry {
  at: string;
  action: "review_comment" | "issue_comment" | "labels";
  pr: string;
  payload: Record<string, unknown>;
}
