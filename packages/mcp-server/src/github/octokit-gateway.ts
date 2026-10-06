import { Octokit } from "@octokit/rest";
import type { GitHubGateway } from "./gateway.js";
import type { ChangedFile, FileStatus, PostedComment, PrRef, PullRequestInfo } from "../types.js";

export interface OctokitGatewayOptions {
  token: string;
  baseUrl?: string;
  userAgent?: string;
}

/** GitHub REST implementation backed by Octokit. */
export class OctokitGateway implements GitHubGateway {
  private readonly octokit: Octokit;

  constructor(opts: OctokitGatewayOptions | Octokit) {
    this.octokit =
      opts instanceof Octokit
        ? opts
        : new Octokit({ auth: opts.token, baseUrl: opts.baseUrl, userAgent: opts.userAgent ?? "pr-sentinel" });
  }

  async getPullRequest(ref: PrRef): Promise<PullRequestInfo> {
    const { data } = await this.octokit.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number });
    return {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      title: data.title,
      body: data.body ?? "",
      author: data.user?.login ?? "unknown",
      state: data.state,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      baseSha: data.base.sha,
      headSha: data.head.sha,
      htmlUrl: data.html_url,
      headCloneUrl: data.head.repo?.clone_url
    };
  }

  async listChangedFiles(ref: PrRef): Promise<ChangedFile[]> {
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: 100
    });
    return files.map((f) => ({
      filename: f.filename,
      status: f.status as FileStatus,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
      previousFilename: f.previous_filename
    }));
  }

  async createReviewComment(
    ref: PrRef,
    headSha: string,
    comment: { body: string; path: string; line: number }
  ): Promise<PostedComment> {
    const { data } = await this.octokit.pulls.createReviewComment({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      commit_id: headSha,
      body: comment.body,
      path: comment.path,
      line: comment.line,
      side: "RIGHT"
    });
    return { id: String(data.id), url: data.html_url, kind: "inline" };
  }

  async createIssueComment(ref: PrRef, body: string): Promise<PostedComment> {
    const { data } = await this.octokit.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      body
    });
    return { id: String(data.id), url: data.html_url, kind: "summary" };
  }

  async addLabels(ref: PrRef, labels: string[]): Promise<string[]> {
    const { data } = await this.octokit.issues.addLabels({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      labels
    });
    return data.map((l) => l.name);
  }
}
