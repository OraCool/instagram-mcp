#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { createContext } from "./tools/context.js";

if (process.argv[2] === "login") {
  const { login } = await import("./login.js");
  try {
    const result = await login({ config: loadConfig() });
    console.error(
      `Logged in${result.user_id ? ` (Instagram user ${result.user_id})` : ""}. Token saved to ${result.saved_to}` +
        `${result.expires_at ? `, valid until ${result.expires_at}` : ""}.\nRestart your MCP client to use it.`,
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else {
  const server = createServer(createContext(loadConfig()));
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol; diagnostics go to stderr.
  console.error("instagram-mcp running on stdio");
}
