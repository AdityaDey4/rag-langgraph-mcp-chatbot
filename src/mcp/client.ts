// The MCP client: it starts a server as a subprocess and talks to it over stdio, or calls a server by its HTTP address.
// The agent (agent.ts) uses it to find out which tools the server has and to call them.
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
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

// 2. Or a server that is already running somewhere: its address, and the token it asks for (see http-server.ts).
export type ServerUrl = {
  url: string;
  token?: string;
};

export type ServerTarget = ServerCommand | ServerUrl;

// Our own server (server.ts). Node runs the local tsx, and tsx runs the file. Absolute paths, so the working directory does not matter.
const projectRoot = path.join(__dirname, "..", "..");

export const ownServer: ServerCommand = {
  command: process.execPath,
  args: [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(__dirname, "server.ts")],
};

// 3. Start the server (or call it) and connect to it.
// The SDK client works out which protocol era the server speaks and falls back to the older one if needed (fact 14).
// If the command does not exist or the server stops at once, connect() throws.
// Example: connectToServer() returns a client that is connected to a freshly started copy of our server
// Example: connectToServer({ url: "http://127.0.0.1:3333/mcp", token: "…" }) returns a client that is connected to the server that runs at that address
export async function connectToServer(server: ServerTarget = ownServer) {
  const client = new Client({ name: "rag-agent", version: "1.0.0" });

  if ("url" in server) {
    // The token is sent as "Authorization: Bearer <token>" with every request.
    const token = server.token;
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      authProvider: token ? { token: async () => token } : undefined,
    });

    log("agent", `connecting to the server at ${server.url}`);
    await client.connect(transport);
  } else {
    const transport = new StdioClientTransport({ command: server.command, args: server.args, env: server.env });

    log("agent", `starting the server: ${path.basename(server.args.at(-1) ?? server.command)}`);
    await client.connect(transport);
  }

  const version = client.getServerVersion();
  const features = Object.keys(client.getServerCapabilities() ?? {}).join(", ");
  log("agent", `connected to "${version?.name}" ${version?.version}, it offers: ${features}`);

  return client;
}
