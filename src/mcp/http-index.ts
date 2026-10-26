// Start the MCP server over HTTP:  npm run mcp:http
// It needs a secret in .env:  MCP_HTTP_TOKEN=<at least 16 characters>   (and optionally MCP_HTTP_PORT, default 3333)
// A client must send this token as "Authorization: Bearer <token>".
import "./config"; // loads .env
import { startHttpServer } from "./http-server";
import { log } from "./log";

async function main() {
  const token = process.env.MCP_HTTP_TOKEN;

  if (!token) {
    console.error("MCP_HTTP_TOKEN is not set. Put a secret of at least 16 characters in .env, for example MCP_HTTP_TOKEN=change-me-to-a-long-random-text");
    process.exit(1);
  }

  const server = await startHttpServer({ port: Number(process.env.MCP_HTTP_PORT ?? 3333), token });
  log("server", `rag-documents server listening on ${server.url} (a bearer token is required)`);

  // Ctrl+C stops it cleanly.
  process.on("SIGINT", () => {
    void server.close().then(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error("The HTTP server failed:", error);
  process.exitCode = 1;
});
