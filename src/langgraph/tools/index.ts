// The agent's toolbox: the list handed to the model and to the graph's tool node.
import { calculate } from "./calculate";
import { getChunk } from "./get-chunk";
import { getCurrentDatetime } from "./get-current-datetime";
import { listDocuments } from "./list-documents";
import { searchDocuments } from "./search-documents";

export const tools = [searchDocuments, getChunk, listDocuments, calculate, getCurrentDatetime];
