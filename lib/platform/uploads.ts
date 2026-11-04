/**
 * Upload content checks. The browser-declared MIME type is not trusted: the
 * leading bytes must match the declared type, text formats must be valid
 * UTF-8 without NUL bytes, and SVG must not contain active content (scripts,
 * event handlers, external references or embedded documents).
 */
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  "image/webp": (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  "application/pdf": (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  "font/woff": (b) => b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x46,
  "font/woff2": (b) => b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32,
  "font/ttf": (b) => (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) || (b[0] === 0x74 && b[1] === 0x72 && b[2] === 0x75 && b[3] === 0x65),
};
const TEXT = new Set(["text/plain", "text/csv", "application/json", "image/svg+xml"]);
export const ALLOWED_UPLOAD_TYPES = new Set([...Object.keys(SIGNATURES), ...TEXT]);

const ACTIVE_SVG = /<\s*script|\bon[a-z]+\s*=|javascript:|<\s*foreignObject|<\s*iframe|<\s*embed|<\s*object|xlink:href\s*=\s*["']\s*(?!#)|href\s*=\s*["']\s*(?!#|data:image\/)|<!ENTITY|<\?xml-stylesheet/i;

export function checkUpload(type: string, bytes: Uint8Array): string | null {
  if (!ALLOWED_UPLOAD_TYPES.has(type)) return "Use an image, font, PDF, text, CSV or JSON file";
  if (SIGNATURES[type]) return SIGNATURES[type](bytes) ? null : "The file contents do not match its type";
  if (bytes.includes(0)) return "The file contents do not match its type";
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return "Text files must be UTF-8"; }
  if (type === "application/json") { try { JSON.parse(text); } catch { return "This JSON file is not valid"; } }
  if (type === "image/svg+xml") {
    if (!/<svg[\s>]/i.test(text)) return "This SVG file is not valid";
    if (ACTIVE_SVG.test(text)) return "SVG files with scripts, event handlers or external links are not allowed";
  }
  return null;
}
