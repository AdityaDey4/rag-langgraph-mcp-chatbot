// How much time does it cost to reach a tool through MCP? The same tool (list_documents) is called many times in three ways:
//   1. directly, as a function in this program
//   2. through the MCP client, with our server started as a subprocess (stdio)
//   3. through the MCP client, with our server reached over HTTP with a token
//   npm run mcp:overhead
// The difference between the ways is the price of the protocol, the process and the HTTP hop (the work of the tool is the same).
import { randomUUID } from "node:crypto";
import "./config"; // loads .env (Qdrant)
import { connectToServer, ownServer } from "./client";
import { startHttpServer } from "./http-server";
import { listDocuments } from "./tools/list-documents";

const CALLS = 30;

// Example: summarise([12, 10, 40, 11]) returns { median: 11.5, mean: 18.3, max: 40 } (milliseconds)
function summarise(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
  const mean = times.reduce((sum, time) => sum + time, 0) / times.length;

  return { median: Number(median.toFixed(1)), mean: Number(mean.toFixed(1)), max: Number(sorted[sorted.length - 1].toFixed(1)) };
}

// Example: timeCalls(async () => { … }) runs the function 30 times and returns how long each run took, in milliseconds
async function timeCalls(call: () => Promise<unknown>) {
  await call(); // the first call is not counted (it warms up connections)

  const times: number[] = [];
  for (let i = 0; i < CALLS; i++) {
    const startedAt = performance.now();
    await call();
    times.push(performance.now() - startedAt);
  }
  return times;
}

async function main() {
  process.env.MCP_LOG = "off";

  // 1. Directly.
  const direct = summarise(await timeCalls(() => listDocuments()));

  // 2. Over stdio.
  const stdioStartedAt = performance.now();
  // The server subprocess does not inherit our environment (see fact 45), so its logging is switched off with its own env.
  const stdioClient = await connectToServer({ ...ownServer, env: { MCP_LOG: "off" } });
  const stdioStartMs = Math.round(performance.now() - stdioStartedAt);
  const stdio = summarise(await timeCalls(() => stdioClient.callTool({ name: "list_documents", arguments: {} })));
  await stdioClient.close();

  // 3. Over HTTP.
  const token = randomUUID() + randomUUID();
  const server = await startHttpServer({ port: 0, token });
  const httpStartedAt = performance.now();
  const httpClient = await connectToServer({ url: server.url, token });
  const httpStartMs = Math.round(performance.now() - httpStartedAt);
  const http = summarise(await timeCalls(() => httpClient.callTool({ name: "list_documents", arguments: {} })));
  await httpClient.close();
  await server.close();

  console.log(`list_documents, ${CALLS} calls each (milliseconds)`);
  console.log("  directly       ", direct);
  console.log("  stdio          ", stdio, `  (starting the server took ${stdioStartMs} ms)`);
  console.log("  http, with token", http, `  (connecting took ${httpStartMs} ms)`);
  console.log(`\nExtra time per call over a direct call (median): stdio +${(stdio.median - direct.median).toFixed(1)} ms, http +${(http.median - direct.median).toFixed(1)} ms`);
}

main().catch((error) => {
  console.error("Overhead check failed:", error);
  process.exitCode = 1;
});
