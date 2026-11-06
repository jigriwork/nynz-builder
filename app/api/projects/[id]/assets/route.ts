import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/supabase/auth";
import { checkUpload } from "@/lib/platform/uploads";
import { rateLimit } from "@/lib/platform/rate-limit";
import { ASSET_BUCKET as bucket, MAX_FILE_BYTES, MAX_PROJECT_BYTES, listProjectAssets } from "@/lib/platform/project-assets";

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
  // Refuse oversized uploads before reading them (the form adds a little overhead).
  const tooLarge = () => NextResponse.json({ error: "Files must be smaller than 10 MB" }, { status: 413 });
  if (Number(request.headers.get("content-length") || 0) > MAX_FILE_BYTES + 64 * 1024) return tooLarge();
  const form = await request.formData().catch(() => null);
  if (!form) return tooLarge();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload" }, { status: 400 });
  if (file.size < 1 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Files must be smaller than 10 MB" }, { status: 400 });
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
