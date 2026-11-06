export type ProjectAsset = { name: string; data: ArrayBuffer };

const TEXT_EXTENSIONS = /\.(?:txt|csv|json)$/i;
const PDF_EXTENSION = /\.pdf$/i;
const MAX_EXTRACTED_CHARS = 45_000;
const DERIVED_IMAGE = /^catalog-([0-9a-f]{8})-page-(\d{2})-image-(\d{2})\.webp$/i;

function displayName(storedName: string) {
  return storedName.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}-/i, "");
}

function cleanText(value: string) {
  return value.replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

/**
 * Converts substantial embedded PDF images (this includes flattened catalogue
 * pages) into compact browser-ready assets. The result is deterministic, so a
 * worker can persist it once and every later build can use the same exact
 * /uploads path. Small logos and decorative fragments are skipped.
 */
export async function extractPdfImageAssets(assets: ProjectAsset[], options: { maxBytes?: number; maxImages?: number } = {}) {
  const output: ProjectAsset[] = [];
  let remaining = Math.max(0, options.maxBytes ?? 18 * 1024 * 1024);
  const maxImages = Math.max(0, options.maxImages ?? 60);
  const existing = new Set(assets.map((asset) => asset.name));
  const { extractImages, getDocumentProxy } = await import("unpdf");
  const { default: sharp } = await import("sharp");
  for (const asset of assets) {
    if (!PDF_EXTENSION.test(asset.name) || output.length >= maxImages || remaining < 1024) continue;
    const source = asset.name.match(/^([0-9a-f]{8})/i)?.[1]?.toLowerCase();
    if (!source) continue;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(asset.data.slice(0)));
      for (let page = 1; page <= Math.min(pdf.numPages, 60) && output.length < maxImages; page += 1) {
        const images = await extractImages(pdf, page);
        for (let index = 0; index < images.length && output.length < maxImages; index += 1) {
          const image = images[index];
          if (image.width < 240 || image.height < 240 || image.width * image.height > 20_000_000) continue;
          const name = `catalog-${source}-page-${String(page).padStart(2, "0")}-image-${String(index + 1).padStart(2, "0")}.webp`;
          if (existing.has(name)) continue;
          const encoded = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: image.channels } })
            .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 78, effort: 4 })
            .toBuffer();
          if (encoded.byteLength > remaining) break;
          const copy = Uint8Array.from(encoded);
          output.push({ name, data: copy.buffer });
          existing.add(name);
          remaining -= encoded.byteLength;
        }
      }
    } catch {
      // Text extraction below still explains that the PDF was unreadable; a
      // malformed image must not make an otherwise useful text catalog fail.
    }
  }
  return output;
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
    const derived = asset.name.match(DERIVED_IMAGE);
    if (derived) {
      sections.push(`CATALOG IMAGE: PDF page ${Number(derived[2])}, image ${Number(derived[3])} (use at exact public path ${path})`);
      continue;
    }
    if (remaining > 0 && PDF_EXTENSION.test(name)) {
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        // PDF.js may transfer (and therefore detach) the buffer it receives.
        // Parse a copy because the original is reused later when the same asset
        // is written into the preview sandbox.
        const pdf = await getDocumentProxy(new Uint8Array(asset.data.slice(0)));
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
