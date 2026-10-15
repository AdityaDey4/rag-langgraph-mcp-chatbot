"use client";

import { useState } from "react";
import type { SourceRef } from "@/lib/agent/types";

export function CitationChips({ citations }: { citations: SourceRef[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (citations.length === 0) return null;

  const open = citations.find((citation) => citation.chunkId === openId);

  return (
    <div className="mt-3">
      <ul className="flex flex-wrap gap-2" aria-label="Sources">
        {citations.map((citation, index) => {
          const selected = citation.chunkId === openId;
          return (
            <li key={citation.chunkId}>
              <button
                type="button"
                aria-expanded={selected}
                onClick={() => setOpenId(selected ? null : citation.chunkId)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  selected
                    ? "border-blue-400 bg-blue-500/20 text-blue-200"
                    : "border-gray-600 bg-gray-900 text-gray-300 hover:border-gray-400"
                }`}
              >
                [{index + 1}] {label(citation)}
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <blockquote className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border-l-2 border-blue-400 bg-gray-900 p-3 text-xs leading-5 text-gray-300">
          {open.snippet}
        </blockquote>
      )}
    </div>
  );
}

function label(citation: SourceRef): string {
  const parts = [citation.filename, citation.section].filter(Boolean);
  if (citation.pages.length > 0) parts.push(`p.${citation.pages.join(",")}`);
  return parts.join(" · ") || "source";
}
