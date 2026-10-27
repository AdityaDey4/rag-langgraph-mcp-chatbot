// M1 (learning only): speaks raw MCP messages to a ready-made server and prints every one, in both directions.
//   npm run mcp:m1-trace
// The server is the reference filesystem server. The folder it may read is a temporary one created here.
// stdio framing: one JSON-RPC message per line on the server's standard input and output.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 1. A small folder for the server to read.
const sample = path.join(os.tmpdir(), "mcp-m1-sample").replace(/\\/g, "/");
fs.mkdirSync(sample, { recursive: true });
fs.writeFileSync(sample + "/notes.txt", "Kafka is a distributed event-streaming platform.\nRedis is an in-memory data store.\n");

// 2. Start the server as a subprocess (shell: true so that "npx" is found on Windows).
const server = spawn("npx", ["-y", "@modelcontextprotocol/server-filesystem", sample], { shell: true });

type Message = { id?: number; [key: string]: unknown };
const waiting = new Map<number, (message: Message) => void>(); // request id -> function that receives the reply
let buffer = "";

// 3. Read the server's messages: one per line.
server.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();

  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;

    console.log("  SERVER -> CLIENT ", line.length > 400 ? line.slice(0, 400) + ` … (${line.length} characters)` : line);

    const message: Message = JSON.parse(line);
    if (message.id !== undefined) waiting.get(message.id)?.(message);
  }
});

// stderr is where a stdio server may write its own log lines.
server.stderr.on("data", (chunk: Buffer) => console.log("  SERVER stderr    ", chunk.toString().trim()));

function send(message: object) {
  console.log("  CLIENT -> SERVER ", JSON.stringify(message));
  server.stdin.write(JSON.stringify(message) + "\n");
}

// A request has an id, and the server's reply carries the same id.
function request(id: number, method: string, params: object) {
  return new Promise<Message>((resolve) => {
    waiting.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

async function main() {
  console.log("\n1. The probe a 2026-07-28 client sends first:");
  await request(1, "server/discover", {});

  console.log("\n2. The older handshake: initialize");
  await request(2, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "m1-wire-trace", version: "0.0.1" },
  });

  console.log("\n3. The client says it is ready (a notification: no id, no reply)");
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  console.log("\n4. tools/list");
  await request(3, "tools/list", {});

  console.log("\n5. tools/call, a file inside the allowed folder");
  await request(4, "tools/call", { name: "read_text_file", arguments: { path: sample + "/notes.txt" } });

  console.log("\n6. tools/call, a file outside the allowed folder");
  await request(5, "tools/call", { name: "read_text_file", arguments: { path: "C:/Windows/win.ini" } });

  server.kill();
  process.exit(0);
}

setTimeout(() => {
  console.log("timeout: the server did not answer in 60 seconds");
  server.kill();
  process.exit(1);
}, 60000);

main();
