import type { SupabaseClient } from "@supabase/supabase-js";

export const ASSET_BUCKET = "project-assets";
/** Total upload allowance per project. There is no limit on the number of files. */
export const MAX_PROJECT_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type StoredAsset = { name: string; size: number; created_at?: string | null };

/** Every uploaded file in a project, paging through storage so no file is missed. */
export async function listProjectAssets(db: SupabaseClient, projectId: string): Promise<StoredAsset[]> {
  const out: StoredAsset[] = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const { data, error } = await db.storage.from(ASSET_BUCKET).list(projectId, { limit: 1000, offset, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw error;
    const page = (data || []).filter((item) => item.id);
    out.push(...page.map((item) => ({ name: item.name, size: Number((item.metadata as { size?: number } | null)?.size || 0), created_at: item.created_at })));
    if ((data || []).length < 1000) break;
  }
  return out;
}
