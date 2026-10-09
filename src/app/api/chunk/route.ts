import { NextResponse } from "next/server";

type Chunk = {
  chunkIndex: number;
  section: string;
  text: string;
};

function markdownToChunks(markdown: string): Chunk[] {
  const lines = markdown.split("\n");

  const chunks: Chunk[] = [];

  let currentSection = "General";
  let currentText: string[] = [];

  function saveChunk() {
    const text = currentText.join("\n").trim();

    if (!text) {
      return;
    }

    chunks.push({
      chunkIndex: chunks.length + 1,
      section: currentSection,
      text,
    });

    currentText = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);

    if (headingMatch) {
      saveChunk();

      currentSection = headingMatch[1].trim();

      continue;
    }

    currentText.push(line);
  }

  saveChunk();

  return chunks;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const markdown = body.markdown;

    if (!markdown || typeof markdown !== "string") {
      return NextResponse.json(
        {
          error: "Markdown is required",
        },
        { status: 400 }
      );
    }

    const chunks = markdownToChunks(markdown);

    return NextResponse.json({
      chunks,
      count: chunks.length,
    });
  } catch (error) {
    console.error("Chunking error:", error);

    return NextResponse.json(
      {
        error: "Failed to create chunks",
      },
      { status: 500 }
    );
  }
}