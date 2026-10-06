import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent spawns test processes and resolves fixture paths relative to its own files,
  // so keep the workspace packages (and the MCP SDK) as real Node modules instead of bundling them.
  serverExternalPackages: ["@pr-sentinel/agent", "@pr-sentinel/mcp-server", "@modelcontextprotocol/sdk"]
};

export default nextConfig;
