/**
 * Resume PDF text with unpdf (SEA-81). Imported only by the Node action in
 * `convex/evidenceNode.ts`: pdf.js fails in the default Convex runtime
 * ("structuredClone with transfer not supported").
 */

import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
