import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prFromWebhook, verifyGitHubSignature } from "../lib/webhook";

const sign = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyGitHubSignature", () => {
  const body = JSON.stringify({ action: "opened" });
  it("accepts a valid signature", () => {
    expect(verifyGitHubSignature("s3cret", body, sign("s3cret", body))).toBe(true);
  });
  it("rejects wrong secrets, tampered bodies and missing headers", () => {
    expect(verifyGitHubSignature("s3cret", body, sign("other", body))).toBe(false);
    expect(verifyGitHubSignature("s3cret", body + " ", sign("s3cret", body))).toBe(false);
    expect(verifyGitHubSignature("s3cret", body, null)).toBe(false);
    expect(verifyGitHubSignature("", body, sign("", body))).toBe(false);
  });
});

describe("prFromWebhook", () => {
  const payload = (over: object = {}) => ({ action: "opened", number: 7, pull_request: { number: 7, draft: false }, repository: { full_name: "octo/app" }, ...over });
  it("triggers on reviewable pull_request actions", () => {
    expect(prFromWebhook("pull_request", payload())).toEqual({ pr: "octo/app#7" });
    expect(prFromWebhook("pull_request", payload({ action: "synchronize" }))).toEqual({ pr: "octo/app#7" });
  });
  it("skips other events, actions and drafts", () => {
    expect(prFromWebhook("ping", {})).toEqual({ skip: "ping" });
    expect(prFromWebhook("issues", payload())).toHaveProperty("skip");
    expect(prFromWebhook("pull_request", payload({ action: "closed" }))).toHaveProperty("skip");
    expect(prFromWebhook("pull_request", payload({ pull_request: { number: 7, draft: true } }))).toEqual({ skip: "draft pull request" });
  });
});
