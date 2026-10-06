import path from "node:path";
import { fileURLToPath } from "node:url";
import { FixtureGateway } from "./github/fixture-gateway.js";
import type { GitHubGateway } from "./github/gateway.js";
import { OctokitGateway } from "./github/octokit-gateway.js";
import type { SentinelServerOptions } from "./server.js";
import { GitWorkspaceProvider, StaticWorkspaceProvider, type WorkspaceProvider } from "./workspace.js";

export const DEFAULT_TEST_COMMAND = "node --test --test-reporter=tap {files}";

/** Repo root `examples/` directory (works from both src/ and dist/). */
export const EXAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples");
export const DEMO_PR = "demo/acme-shop#42";

export interface ServerEnv {
  GITHUB_TOKEN?: string;
  GITHUB_API_URL?: string;
  SENTINEL_DRY_RUN?: string;
  SENTINEL_DEMO?: string;
  SENTINEL_TEST_COMMAND?: string;
  SENTINEL_TEST_TIMEOUT_MS?: string;
  SENTINEL_WORKSPACE_DIR?: string;
  SENTINEL_INSTALL_COMMAND?: string;
}

const truthy = (v?: string) => v !== undefined && ["1", "true", "yes", "on"].includes(v.toLowerCase());

/** Gateway + workspace for the bundled offline demo PR. */
export async function demoDependencies(): Promise<{ gateway: FixtureGateway; workspaces: WorkspaceProvider }> {
  const gateway = await FixtureGateway.fromFiles([path.join(EXAMPLES_DIR, "fixtures/demo-pr.json")]);
  const workspaces = new StaticWorkspaceProvider({ [DEMO_PR]: path.join(EXAMPLES_DIR, "demo-repo") });
  return { gateway, workspaces };
}

/**
 * Resolves server options from environment variables. Demo mode (no token, or
 * SENTINEL_DEMO=true) serves the bundled fixture PR and forces dry-run.
 */
export async function serverOptionsFromEnv(env: ServerEnv = process.env): Promise<SentinelServerOptions> {
  const demo = truthy(env.SENTINEL_DEMO) || !env.GITHUB_TOKEN;
  let gateway: GitHubGateway;
  let workspaces: WorkspaceProvider;
  if (demo) {
    ({ gateway, workspaces } = await demoDependencies());
  } else {
    gateway = new OctokitGateway({ token: env.GITHUB_TOKEN!, baseUrl: env.GITHUB_API_URL });
    workspaces = new GitWorkspaceProvider({
      rootDir: env.SENTINEL_WORKSPACE_DIR ?? path.resolve(".sentinel-workspaces"),
      token: env.GITHUB_TOKEN,
      installCommand: env.SENTINEL_INSTALL_COMMAND
    });
  }
  return {
    gateway,
    workspaces,
    dryRun: demo || truthy(env.SENTINEL_DRY_RUN),
    testCommand: env.SENTINEL_TEST_COMMAND ?? DEFAULT_TEST_COMMAND,
    testTimeoutMs: Number(env.SENTINEL_TEST_TIMEOUT_MS ?? 120_000)
  };
}
