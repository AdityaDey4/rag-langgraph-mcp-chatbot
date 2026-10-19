// The six tools, handed to the model and to the graph's tool node.
import { calculate } from "./calculate";
import { getChunk } from "./get-chunk";
import { getCurrentDatetime } from "./get-current-datetime";
import { listDocuments } from "./list-documents";
import { searchDocuments } from "./search-documents";
import { sendEmail } from "./send-email";

export const tools = [searchDocuments, getChunk, listDocuments, calculate, getCurrentDatetime, sendEmail];
