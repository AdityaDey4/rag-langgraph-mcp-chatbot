// Logging for the MCP programs. Two programs write here, and the prefix says which one:
//   [agent]   the agent and its client (agent.ts, client.ts, adapter.ts)
//   [server]  the MCP server (server.ts and its tools)
// Everything goes to stderr, because for the server stdout carries the protocol messages
// and any other text on stdout would break the connection.
// The server is started by the agent as a subprocess and its stderr is shown in the same terminal, so both appear in one list, in order.
// Turn the logging off with MCP_LOG=off.

// Example: log("agent", "model replied: final answer") prints "[agent]  model replied: final answer" on stderr
export function log(who: "agent" | "server", text: string) {
  if (process.env.MCP_LOG === "off") return;

  console.error(`[${who}]`.padEnd(9) + text);
}
