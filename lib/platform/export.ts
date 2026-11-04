import JSZip from "jszip";

const EXCLUDED = (path: string) => path.includes("node_modules/") || /(^|\/)\.env(\.|$)/.test(path) || path.startsWith(".git/") || path === ".nynz-preview.mjs";

/**
 * Builds the export archive. Environment files, dependencies and NYNZ's
 * internal preview launcher are excluded. A README the project already has is
 * preserved; NYNZ's export notes go to NYNZ_EXPORT.md in that case.
 */
export async function buildExportZip(input: { name: string; files: Array<{ path: string; content: string }>; assets: Array<{ name: string; data: ArrayBuffer }>; date?: Date }) {
  const zip = new JSZip();
  const included = input.files.filter((file) => !EXCLUDED(file.path));
  for (const file of included) zip.file(file.path, file.content);
  for (const asset of input.assets) zip.file(`public/uploads/${asset.name}`, asset.data);
  const notes = `# ${input.name}\n\nExported from NYNZ on ${(input.date || new Date()).toISOString().slice(0, 10)}.\n\n## Run locally\n\n\`\`\`\nnpm install\nnpm run dev\n\`\`\`\n\nEnvironment files are not included. If this app uses a Supabase backend, create \`.env.local\` with \`VITE_SUPABASE_URL\` and \`VITE_SUPABASE_PUBLISHABLE_KEY\` for that project.\n`;
  const hasReadme = included.some((file) => file.path.toLowerCase() === "readme.md");
  let notesPath = hasReadme ? "NYNZ_EXPORT.md" : "README.md";
  const usedPaths = new Set(included.map((file) => file.path.toLowerCase()));
  for (let suffix = 2; usedPaths.has(notesPath.toLowerCase()); suffix++) notesPath = `NYNZ_EXPORT-${suffix}.md`;
  zip.file(notesPath, notes);
  const fileName = `${input.name.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "nynz-project"}.zip`;
  return { body: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), fileName };
}
