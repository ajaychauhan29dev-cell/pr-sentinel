import { readFile } from "node:fs/promises";
import type { GitHubGateway } from "./gateway.js";
import { formatPrRef } from "./pr-ref.js";
import type { ChangedFile, PostedComment, PrRef, PullRequestInfo } from "../types.js";

export interface PullRequestFixture extends PullRequestInfo {
  files: ChangedFile[];
}

export interface RecordedWrite {
  pr: string;
  kind: "inline" | "summary" | "labels";
  body?: string;
  path?: string;
  line?: number;
  labels?: string[];
}

/**
 * Offline gateway that serves pull requests from JSON fixtures and records writes in memory.
 * Used by the demo and by tests; never touches the network.
 */
export class FixtureGateway implements GitHubGateway {
  private readonly prs = new Map<string, PullRequestFixture>();
  readonly writes: RecordedWrite[] = [];
  private nextId = 1;

  constructor(fixtures: PullRequestFixture[] = []) {
    for (const f of fixtures) this.add(f);
  }

  static async fromFiles(paths: string[]): Promise<FixtureGateway> {
    const fixtures = await Promise.all(
      paths.map(async (p) => JSON.parse(await readFile(p, "utf8")) as PullRequestFixture)
    );
    return new FixtureGateway(fixtures);
  }

  add(fixture: PullRequestFixture): void {
    this.prs.set(formatPrRef(fixture), fixture);
  }

  private get(ref: PrRef): PullRequestFixture {
    const pr = this.prs.get(formatPrRef(ref));
    if (!pr) throw new Error(`No fixture for ${formatPrRef(ref)}`);
    return pr;
  }

  async getPullRequest(ref: PrRef): Promise<PullRequestInfo> {
    const { files: _files, ...info } = this.get(ref);
    return info;
  }

  async listChangedFiles(ref: PrRef): Promise<ChangedFile[]> {
    return this.get(ref).files.map((f) => ({ ...f }));
  }

  async createReviewComment(ref: PrRef, _headSha: string, c: { body: string; path: string; line: number }): Promise<PostedComment> {
    this.get(ref);
    this.writes.push({ pr: formatPrRef(ref), kind: "inline", body: c.body, path: c.path, line: c.line });
    return { id: `fixture-${this.nextId++}`, kind: "inline" };
  }

  async createIssueComment(ref: PrRef, body: string): Promise<PostedComment> {
    this.get(ref);
    this.writes.push({ pr: formatPrRef(ref), kind: "summary", body });
    return { id: `fixture-${this.nextId++}`, kind: "summary" };
  }

  async addLabels(ref: PrRef, labels: string[]): Promise<string[]> {
    this.get(ref);
    this.writes.push({ pr: formatPrRef(ref), kind: "labels", labels });
    return labels;
  }
}
