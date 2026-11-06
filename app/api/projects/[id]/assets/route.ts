import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/supabase/auth";
import { ALLOWED_UPLOAD_TYPES, checkUpload } from "@/lib/platform/uploads";
import { rateLimit } from "@/lib/platform/rate-limit";
import { ASSET_BUCKET as bucket, MAX_FILE_BYTES, MAX_PROJECT_BYTES, listProjectAssets } from "@/lib/platform/project-assets";

const uploadRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), name: z.string().min(1).max(255), type: z.string().min(1).max(100), size: z.number().int().positive().max(MAX_FILE_BYTES) }),
  z.object({ action: z.literal("complete"), storageName: z.string().regex(/^[A-Za-z0-9._-]+$/).max(150) }),
]);

function safeName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100);
  return cleaned || "asset";
}

function publicAsset(name: string) {
  return { name: name.replace(/^[0-9a-f-]{36}-/, ""), storageName: name, appPath: `/uploads/${name}` };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const stored = await listProjectAssets(auth.supabase, id).catch(() => null);
  if (!stored) return NextResponse.json({ error: "Could not load project assets" }, { status: 400 });
  const files = stored.map((item) => publicAsset(item.name));
  const paths = files.map((file) => `${id}/${file.storageName}`);
  const { data: signed } = paths.length ? await auth.supabase.storage.from(bucket).createSignedUrls(paths, 3_600) : { data: [] };
  return NextResponse.json({ assets: files.map((file, index) => ({ ...file, previewUrl: signed?.[index]?.signedUrl || null })) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const parsed = uploadRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: `Choose a supported file smaller than ${MAX_FILE_BYTES / 1024 / 1024} MB` }, { status: 400 });
    const input = parsed.data;
    if (input.action === "prepare") {
      if (!ALLOWED_UPLOAD_TYPES.has(input.type)) {
        return NextResponse.json({ error: "Use an image, font, PDF, text, CSV or JSON file" }, { status: 400 });
      }
      const limited = await rateLimit(`upload:${auth.user.id}`, 60, 3600);
      if (limited) return limited;
      const stored = await listProjectAssets(auth.supabase, id).catch(() => null);
      if (!stored) return NextResponse.json({ error: "Could not check this project's uploads" }, { status: 400 });
      const used = stored.reduce((sum, item) => sum + item.size, 0);
      if (used + input.size > MAX_PROJECT_BYTES) return NextResponse.json({ error: "This project has reached its 50 MB upload limit" }, { status: 400 });
      const storageName = `${randomUUID()}-${safeName(input.name)}`;
      const { data, error } = await auth.supabase.storage.from(bucket).createSignedUploadUrl(`${id}/${storageName}`);
      if (error || !data?.token) return NextResponse.json({ error: "Could not authorize this upload" }, { status: 400 });
      return NextResponse.json({ upload: { path: `${id}/${storageName}`, token: data.token, storageName } });
    }

    const path = `${id}/${input.storageName}`;
    const { data: file, error: downloadError } = await auth.supabase.storage.from(bucket).download(path);
    if (downloadError || !file) return NextResponse.json({ error: "The upload did not finish. Please try again." }, { status: 400 });
    const reject = async (message: string) => {
      await auth.supabase.storage.from(bucket).remove([path]);
      return NextResponse.json({ error: message }, { status: 400 });
    };
    if (file.size < 1 || file.size > MAX_FILE_BYTES) return reject(`Files must be smaller than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = checkUpload(file.type, bytes);
    if (problem) return reject(problem);
    const stored = await listProjectAssets(auth.supabase, id).catch(() => null);
    if (!stored || stored.reduce((sum, item) => sum + item.size, 0) > MAX_PROJECT_BYTES) return reject("This project has reached its 50 MB upload limit");
    const { data: signed } = await auth.supabase.storage.from(bucket).createSignedUrl(path, 3_600);
    return NextResponse.json({ asset: { ...publicAsset(input.storageName), previewUrl: signed?.signedUrl || null } }, { status: 201 });
  }

  // Legacy small multipart uploads remain available for operational checks.
  // Large browser uploads use the signed direct-to-storage flow above and do
  // not pass through Vercel's 4.5 MB request-body ceiling.
  const tooLarge = () => NextResponse.json({ error: `Files must be smaller than ${MAX_FILE_BYTES / 1024 / 1024} MB` }, { status: 413 });
  if (Number(request.headers.get("content-length") || 0) > MAX_FILE_BYTES + 64 * 1024) return tooLarge();
  const form = await request.formData().catch(() => null);
  if (!form) return tooLarge();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload" }, { status: 400 });
  if (file.size < 1 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `Files must be smaller than ${MAX_FILE_BYTES / 1024 / 1024} MB` }, { status: 400 });
  const limited = await rateLimit(`upload:${auth.user.id}`, 60, 3600);
  if (limited) return limited;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkUpload(file.type, bytes);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  // No limit on the number of files: only the 50 MB project total applies.
  const stored = await listProjectAssets(auth.supabase, id).catch(() => null);
  if (!stored) return NextResponse.json({ error: "Could not check this project's uploads" }, { status: 400 });
  const used = stored.reduce((sum, item) => sum + item.size, 0);
  if (used + file.size > MAX_PROJECT_BYTES) return NextResponse.json({ error: "This project has reached its 50 MB upload limit" }, { status: 400 });
  const storageName = `${randomUUID()}-${safeName(file.name)}`;
  const { error } = await auth.supabase.storage.from(bucket).upload(`${id}/${storageName}`, bytes, { contentType: file.type, upsert: false });
  if (error) return NextResponse.json({ error: "Could not upload this file" }, { status: 400 });
  const { data: signed } = await auth.supabase.storage.from(bucket).createSignedUrl(`${id}/${storageName}`, 3_600);
  return NextResponse.json({ asset: { ...publicAsset(storageName), previewUrl: signed?.signedUrl || null } }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ storageName: z.string().regex(/^[A-Za-z0-9._-]+$/).max(150) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid asset" }, { status: 400 });
  const { error } = await auth.supabase.storage.from(bucket).remove([`${id}/${parsed.data.storageName}`]);
  return error ? NextResponse.json({ error: "Could not remove this file" }, { status: 400 }) : new NextResponse(null, { status: 204 });
}
