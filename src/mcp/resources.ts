// The resources of the MCP server: data that a host can read, as opposed to tools that a model calls.
//   rag://documents            one fixed resource: the list of documents
//   rag://sections/{section}   a template: one resource for every section, for example rag://sections/Kafka
import { getSectionChunks, listDocuments, type Chunk } from "./retrieval";

export const documentsUri = "rag://documents";
export const sectionUriTemplate = "rag://sections/{section}";

// Example: readDocumentsResource(new URL("rag://documents")) returns { contents: [{ uri: "rag://documents", mimeType: "application/json", text: "[ { documentId: …, filename: school.pdf, sections: […], chunkCount: 9 } ]" }] }
export async function readDocumentsResource(uri: URL, fetchAll: typeof listDocuments = listDocuments) {
  const documents = await fetchAll();

  return {
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(documents, null, 2) }],
  };
}

// Example: listSectionResources() returns { resources: [ { uri: "rag://sections/Kafka", name: "Kafka (school.pdf)", mimeType: "text/plain" }, … ] }
// This is the list a host shows to its user ("which sections can I attach?").
export async function listSectionResources(fetchAll: typeof listDocuments = listDocuments) {
  const documents = await fetchAll();

  const resources = documents.flatMap((document) =>
    document.sections.map((section) => ({
      uri: `rag://sections/${encodeURIComponent(section)}`,
      name: `${section} (${document.filename ?? document.documentId})`,
      description: `The text of the section ${section}.`,
      mimeType: "text/plain",
    })),
  );

  return { resources };
}

// Example: readSectionResource(new URL("rag://sections/DBMS"), "DBMS") returns { contents: [{ uri: "rag://sections/DBMS", mimeType: "text/plain", text: "DBMS\n\nA Database Management System … \n\nDBMS\n\nFor system design, …" }] }
// An unknown section throws. For a resource that is a protocol error, not a result with isError (that is only for tools).
export async function readSectionResource(
  uri: URL,
  section: string,
  fetchSection: (section: string) => Promise<Chunk[]> = getSectionChunks,
) {
  const chunks = await fetchSection(section);

  if (chunks.length === 0) {
    throw new Error(`No section called "${section}".`);
  }

  return {
    contents: [{ uri: uri.href, mimeType: "text/plain", text: chunks.map((chunk) => chunk.text).join("\n\n") }],
  };
}
