// The prompts of the MCP server: ready-made messages that the user picks in the host (for example from a menu).
import { z } from "zod";
import { getSectionChunks, type Chunk } from "./retrieval";

export const summarizeSectionDescription = "Summarise one section of the documents in three bullet points. Choose the section by its title, for example Kafka.";

export const summarizeSectionSchema = z.object({
  section: z.string().min(1).max(60).describe("The title of the section, for example Kafka or DBMS."),
});

// Example: summarizeSection({ section: "Kafka" }) returns { messages: [ the instruction as text, the section text as an attached resource ] }
// An unknown section throws (a protocol error: a prompt has no isError result).
export async function summarizeSection(
  { section }: z.infer<typeof summarizeSectionSchema>,
  fetchSection: (section: string) => Promise<Chunk[]> = getSectionChunks,
) {
  const chunks = await fetchSection(section);

  if (chunks.length === 0) {
    throw new Error(`No section called "${section}".`);
  }

  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Summarise the section "${section}" below in exactly three bullet points. Use only the text of the section.`,
        },
      },
      {
        // The text is attached as a resource (with its address), so the host knows where it came from.
        role: "user" as const,
        content: {
          type: "resource" as const,
          resource: {
            uri: `rag://sections/${encodeURIComponent(section)}`,
            mimeType: "text/plain",
            text: chunks.map((chunk) => chunk.text).join("\n\n"),
          },
        },
      },
    ],
  };
}
