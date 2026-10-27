// The rules for using an MCP server that we did not write. Everything a server says is untrusted:
// its tool list, the descriptions, the results, and how long it takes. makeSafeSource puts these rules around a client.
// The agent (agent.ts) then uses the safe source instead of the client, so no tool call can skip the rules.
import type { ToolSource } from "./adapter";
import { log } from "./log";
import { wrapToolResult } from "./prompt";

// 1. The rules for one server.
export type ServerPolicy = {
  name: string; // a short name, used in the log and in messages, for example "files"
  prefix?: string; // put before every tool name, so two servers cannot have the same name, for example "files_"
  allow: string[]; // ONLY these tools are offered and can be called (everything else is blocked)
  needsApproval?: string[]; // these tools need a person's approval before every call (they are chosen by name, not by the server's own hints)
  trusted?: boolean; // true for a server that we wrote and that already wraps its results; false wraps every result as untrusted data
  timeoutMs?: number; // a call that takes longer is stopped (default 10 seconds)
  maxOutputChars?: number; // a longer result is cut (default 6,000 characters)
  maxFailures?: number; // after this many failed calls in a row the server is not called again (default 3)
};

// What the person is asked: "this server wants to run this tool with these arguments".
export type Approve = (request: { server: string; tool: string; args: Record<string, unknown> }) => Promise<boolean>;

const MAX_DESCRIPTION_CHARS = 400;

// Example: textResult("Error: it took too long", true) returns { content: [{ type: "text", text: "Error: it took too long" }], isError: true }
function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

// Example: makeSafeSource(client, { name: "files", prefix: "files_", allow: ["read_text_file"] }, approve) returns a source that offers only "files_read_text_file"
export function makeSafeSource(source: ToolSource, policy: ServerPolicy, approve: Approve): ToolSource {
  const prefix = policy.prefix ?? "";
  const timeoutMs = policy.timeoutMs ?? 10_000;
  const maxOutputChars = policy.maxOutputChars ?? 6_000;
  const maxFailures = policy.maxFailures ?? 3;
  let failuresInARow = 0;

  return {
    // 2. Which tools does the agent get to see?
    listTools: async () => {
      const { tools } = await source.listTools();
      const offered = [];

      for (const tool of tools) {
        if (!policy.allow.includes(tool.name)) {
          log("agent", `${policy.name}: blocked the tool "${tool.name}" (not in the allowlist)`);
          continue;
        }

        // The description is written by the server, so it is cut short and its tags are removed (it goes into the model's prompt).
        const description = (tool.description ?? "").replace(/<[^>]*>/g, "").slice(0, MAX_DESCRIPTION_CHARS);

        offered.push({ ...tool, name: prefix + tool.name, description });
      }

      return { tools: offered };
    },

    // 3. What happens on every call, in this order.
    callTool: async (call) => {
      const tool = call.name.startsWith(prefix) ? call.name.slice(prefix.length) : call.name;
      const args = call.arguments;

      // 3a. Only the allowed tools. This also stops a model that invents a name.
      if (!call.name.startsWith(prefix) || !policy.allow.includes(tool)) {
        log("agent", `${policy.name}: refused a call to "${call.name}" (not in the allowlist)`);
        return textResult(`Error: the tool "${call.name}" is not available.`, true);
      }

      // 3b. A server that failed again and again is not called any more.
      if (failuresInARow >= maxFailures) {
        log("agent", `${policy.name}: not calling the server, it failed ${failuresInARow} times in a row`);
        return textResult(`Error: the server "${policy.name}" is not answering (${failuresInARow} calls failed in a row). Do not try it again.`, true);
      }

      // 3c. A tool that can change things needs a person's approval first.
      if (policy.needsApproval?.includes(tool)) {
        log("agent", `${policy.name}: waiting for approval to run ${tool} ${JSON.stringify(args)}`);

        // If asking fails (nobody is there to answer, the input is closed), that counts as "no".
        let approved = false;
        try {
          approved = await approve({ server: policy.name, tool, args });
        } catch {
          approved = false;
        }

        if (!approved) {
          log("agent", `${policy.name}: the call to ${tool} was rejected`);
          return textResult("Not run: the user rejected this step. Do not try it again; tell the user it was not done.", true);
        }
      }

      // 3d. The call, with a time limit. The real name (without the prefix) goes to the server.
      // (The call itself is not cancelled when the time is up; the agent just stops waiting for it.)
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tooSlow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the tool did not answer within ${timeoutMs / 1000} seconds`)), timeoutMs);
      });

      let result;
      try {
        result = await Promise.race([source.callTool({ name: tool, arguments: args }), tooSlow]);
      } catch (error) {
        failuresInARow++;
        const message = error instanceof Error ? error.message : String(error);
        log("agent", `${policy.name}: the call to ${tool} failed (${failuresInARow} in a row): ${message}`);
        return textResult(`Error: ${message}`, true);
      } finally {
        clearTimeout(timer); // otherwise the timer keeps the program alive until it fires
      }

      failuresInARow = 0;

      // 3e. The text of the result: cut if it is too long, wrapped as data if the server is not trusted.
      let text = (result.content ?? []).map((block) => (block.type === "text" ? (block.text ?? "") : `[${block.type} content]`)).join("\n");

      if (text.length > maxOutputChars) {
        log("agent", `${policy.name}: the result of ${tool} was ${text.length} characters, cut to ${maxOutputChars}`);
        text = text.slice(0, maxOutputChars) + "\n…[the result was cut]";
      }

      if (!policy.trusted && !result.isError) {
        text = wrapToolResult(call.name, text);
      }

      return textResult(text, result.isError ?? false);
    },
  };
}

// Two servers may not offer a tool with the same name: the model could not tell them apart.
// Example: checkNamesAreUnique(["search_documents", "files_read_text_file"]) passes; checkNamesAreUnique(["a", "a"]) throws
export function checkNamesAreUnique(names: string[]) {
  const seen = new Set<string>();

  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`Two servers offer a tool called "${name}". Give one of them a prefix.`);
    }
    seen.add(name);
  }
}
