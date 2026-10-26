// The MCP client: it starts a server as a subprocess and talks to it over stdio.
// The agent (agent.ts) uses it to find out which tools the server has and to call them.
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { log } from "./log";

// 1. How to start a server: a command and its arguments, like in the host config of Claude Desktop.
export type ServerCommand = {
  command: string;
  args: string[];
  // Extra environment variables for the server. Without this the server gets only a short, safe list (PATH, TEMP, …),
  // so it cannot read our OPENAI_API_KEY or other secrets from the environment.
  env?: Record<string, string>;
};

// Our own server (server.ts). Node runs the local tsx, and tsx runs the file. Absolute paths, so the working directory does not matter.
const projectRoot = path.join(__dirname, "..", "..");

export const ownServer: ServerCommand = {
  command: process.execPath,
  args: [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(__dirname, "server.ts")],
};

// 2. Start the server and connect to it.
// The SDK client works out which protocol era the server speaks and falls back to the older one if needed (fact 14).
// If the command does not exist or the server stops at once, connect() throws.
// Example: connectToServer() returns a client that is connected to a freshly started copy of our server
export async function connectToServer(server: ServerCommand = ownServer) {
  const client = new Client({ name: "rag-agent", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: server.command, args: server.args, env: server.env });

  log("agent", `starting the server: ${path.basename(server.args.at(-1) ?? server.command)}`);
  await client.connect(transport);

  const version = client.getServerVersion();
  const features = Object.keys(client.getServerCapabilities() ?? {}).join(", ");
  log("agent", `connected to "${version?.name}" ${version?.version}, it offers: ${features}`);

  return client;
}
