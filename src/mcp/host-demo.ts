// What a host (Claude Desktop, Claude Code) does when you click a resource or a prompt, done by hand:
//   npm run mcp:host                    (resource: Kafka, prompt: n8n)
//   npm run mcp:host -- DBMS Redis      (resource: DBMS, prompt: Redis)
// The server only supplies text. The host puts that text in front of the model, and the model answers.
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { connectToServer } from "./client";
import { CHAT_MODEL } from "./config";

const resourceSection = process.argv[2] ?? "Kafka";
const promptSection = process.argv[3] ?? "n8n";

async function main() {
  const client = await connectToServer();
  const model = new ChatOpenAI({ model: CHAT_MODEL, temperature: 0, maxRetries: 2 });

  try {
    // 1. What the host shows in its menu: the resources and the prompts of the server.
    const { resources } = await client.listResources();
    console.log("\n1. Resources in the menu:");
    for (const resource of resources) console.log(`   ${resource.uri}   (${resource.name})`);

    const { prompts } = await client.listPrompts();
    console.log("\n   Prompts in the menu:");
    for (const prompt of prompts) {
      console.log(`   ${prompt.name}   arguments: ${prompt.arguments?.map((argument) => argument.name).join(", ")}`);
    }

    // 2. A resource: you pick a section, the host reads it and attaches the text to your message.
    const uri = `rag://sections/${encodeURIComponent(resourceSection)}`;
    console.log(`\n2. You attach the resource ${uri}, then type: "Explain this in two sentences."`);

    const read = await client.readResource({ uri });
    const attached = "text" in read.contents[0] ? read.contents[0].text : "";
    console.log(`   The server returned ${attached.length} characters of text: "${attached.slice(0, 90).replace(/\s+/g, " ")}…"`);

    const explained = await model.invoke([
      new HumanMessage(`[attached resource ${uri}]\n${attached}`),
      new HumanMessage("Explain this in two sentences."),
    ]);
    console.log(`   The model answers (no search tool was used):\n   ${String(explained.content)}`);

    // 3. A prompt: you pick it and fill in its argument, the host asks the server for its messages.
    console.log(`\n3. You pick the prompt summarize_section with section = ${promptSection}`);

    const prompt = await client.getPrompt({ name: "summarize_section", arguments: { section: promptSection } });

    // Each message of the prompt becomes a message for the model. A resource block is turned into its text.
    const messages = prompt.messages.map((message) => {
      const content = message.content;
      if (content.type === "text") {
        console.log(`   message (${message.role}, text): ${content.text}`);
        return new HumanMessage(content.text);
      }
      if (content.type === "resource" && "text" in content.resource) {
        console.log(`   message (${message.role}, attached resource ${content.resource.uri}): ${content.resource.text.length} characters`);
        return new HumanMessage(`[attached resource ${content.resource.uri}]\n${content.resource.text}`);
      }
      return new HumanMessage(`[${content.type} content]`);
    });

    const summary = await model.invoke(messages);
    console.log(`   The model answers:\n${String(summary.content)}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Host demo failed:", error);
  process.exitCode = 1;
});
