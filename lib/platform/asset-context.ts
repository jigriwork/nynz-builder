type ProjectAsset = { name: string; data: ArrayBuffer };

const TEXT_EXTENSIONS = /\.(?:txt|csv|json)$/i;
const PDF_EXTENSION = /\.pdf$/i;
const MAX_EXTRACTED_CHARS = 45_000;

function displayName(storedName: string) {
  return storedName.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}-/i, "");
}

function cleanText(value: string) {
  return value.replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

/**
 * Turns uploaded documents into model-readable reference text. Binary assets
 * remain available at /uploads; PDFs and text catalogs also contribute their
 * contents so the planner can use product names, descriptions and prices.
 */
export async function assetReferenceContext(assets: ProjectAsset[]) {
  const sections: string[] = [];
  let remaining = MAX_EXTRACTED_CHARS;
  for (const asset of assets) {
    const name = displayName(asset.name);
    const path = `/uploads/${asset.name}`;
    if (remaining > 0 && PDF_EXTENSION.test(name)) {
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(asset.data));
        const extracted = await extractText(pdf, { mergePages: true });
        const text = cleanText(Array.isArray(extracted.text) ? extracted.text.join("\n\n") : extracted.text);
        if (text) {
          const excerpt = text.slice(0, remaining);
          remaining -= excerpt.length;
          sections.push(`CATALOG PDF: ${name} (${extracted.totalPages} pages; file path ${path})\nEXTRACTED CONTENT:\n${excerpt}${text.length > excerpt.length ? "\n[Catalog text truncated to the model context limit.]" : ""}`);
        } else {
          sections.push(`CATALOG PDF: ${name} (file path ${path})\nNo selectable text could be extracted. It may be a scanned/image-only PDF; do not invent its product details.`);
        }
      } catch {
        sections.push(`CATALOG PDF: ${name} (file path ${path})\nThe PDF could not be read; do not claim that its product details were extracted.`);
      }
      continue;
    }
    if (remaining > 0 && TEXT_EXTENSIONS.test(name)) {
      const text = cleanText(new TextDecoder("utf-8").decode(asset.data));
      const excerpt = text.slice(0, remaining);
      remaining -= excerpt.length;
      sections.push(`UPLOADED DATA: ${name} (file path ${path})\nCONTENT:\n${excerpt}${text.length > excerpt.length ? "\n[File text truncated to the model context limit.]" : ""}`);
      continue;
    }
    sections.push(`UPLOADED ASSET: ${name} (use at exact public path ${path})`);
  }
  return sections.join("\n\n");
}
