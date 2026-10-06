import type { PrRef } from "../types.js";

const URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i;
const SHORT_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

/** Parses `owner/repo#123` or `https://github.com/owner/repo/pull/123`. */
export function parsePrRef(input: string): PrRef {
  const value = input.trim();
  const match = URL_RE.exec(value) ?? SHORT_RE.exec(value);
  if (!match) {
    throw new Error(`Unrecognised pull request reference: "${input}". Use owner/repo#123 or a github.com PR URL.`);
  }
  const [, owner, repo, num] = match;
  const number = Number(num);
  if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Invalid pull request reference: "${input}"`);
  }
  return { owner, repo, number };
}

export function formatPrRef(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}
