import { ToolRegistry } from "../registry";
import { calculate } from "./calculate";
import { getChunk } from "./get-chunk";
import { getCurrentDatetime } from "./get-current-datetime";
import { listDocuments } from "./list-documents";
import { searchDocuments } from "./search-documents";

export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(searchDocuments)
    .register(getChunk)
    .register(listDocuments)
    .register(calculate)
    .register(getCurrentDatetime);
}
