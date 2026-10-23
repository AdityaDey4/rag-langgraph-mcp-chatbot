// Logging for the MCP server. It writes to stderr, because stdout carries the protocol messages
// and any other text on stdout would break the connection.

// Example: log("tool search_documents took 1200 ms") prints "[mcp] tool search_documents took 1200 ms" on stderr
export function log(text: string) {
  console.error(`[mcp] ${text}`);
}
