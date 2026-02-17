#!/usr/bin/env node

/**
 * Kroger API MCP Server
 *
 * An MCP server that exposes Kroger grocery store API operations as tools.
 * Communicates over stdio using the Model Context Protocol.
 *
 * Required environment variables:
 *   KROGER_CLIENT_ID       - Kroger API client ID
 *   KROGER_CLIENT_SECRET   - Kroger API client secret
 *
 * Optional environment variables:
 *   KROGER_USER_ACCESS_TOKEN  - User OAuth access token (for cart operations)
 *   KROGER_USER_REFRESH_TOKEN - User OAuth refresh token (for cart operations)
 *
 * Usage:
 *   npx tsx src/mcp/index.ts
 *
 * Or configure in Claude Code's MCP settings:
 *   {
 *     "mcpServers": {
 *       "kroger": {
 *         "command": "npx",
 *         "args": ["tsx", "src/mcp/index.ts"],
 *         "env": {
 *           "KROGER_CLIENT_ID": "your-client-id",
 *           "KROGER_CLIENT_SECRET": "your-client-secret"
 *         }
 *       }
 *     }
 *   }
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KrogerClient } from "../lib/kroger/client.js";
import { createKrogerMcpServer } from "./server.js";

function main() {
  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "Error: KROGER_CLIENT_ID and KROGER_CLIENT_SECRET environment variables are required."
    );
    console.error(
      "Get your credentials at https://developer.kroger.com"
    );
    process.exit(1);
  }

  const client = new KrogerClient({
    clientId,
    clientSecret,
    userAccessToken: process.env.KROGER_USER_ACCESS_TOKEN,
    userRefreshToken: process.env.KROGER_USER_REFRESH_TOKEN,
  });

  const mcpServer = createKrogerMcpServer(client);
  const transport = new StdioServerTransport();

  mcpServer.connect(transport).catch((error) => {
    console.error("Failed to start Kroger MCP server:", error);
    process.exit(1);
  });
}

main();
