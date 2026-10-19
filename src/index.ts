#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { createContext } from "./tools/context.js";

if (process.argv[2] === "login") {
  const { login } = await import("./login.js");
  try {
    // `login --account <name>` is the same as IG_ACCOUNT=<name>.
    const flag = process.argv.indexOf("--account");
    const env = flag > 0 && process.argv[flag + 1] ? { ...process.env, IG_ACCOUNT: process.argv[flag + 1] } : process.env;
    const config = loadConfig(env);
    const result = await login({ config });
    const who = result.username ? `@${result.username}` : result.user_id ? `Instagram user ${result.user_id}` : "Instagram";
    console.error(
      `Logged in as ${who}. Token saved to ${result.saved_to}` +
        `${result.expires_at ? `, valid until ${result.expires_at}` : ""}.\nRestart your MCP client to use it.`,
    );
    if (config.account && result.username && config.account.toLowerCase() !== result.username.toLowerCase()) {
      console.error(`Note: account name "${config.account}" differs from the connected @${result.username}. Log in again if that is not intended.`);
    }
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
